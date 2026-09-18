// train（企画書 §11, §5.3, §4.5）: VP・回数・疲労チェック → 上昇 → 経験値 → 保存 → つぶやき。
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { STATS, loadConfig, type GrowthType, type Stats, type StatsInt, type TrainingType } from "../shared/config";
import { statCap, train as applyTraining } from "../shared/growth";
import { jstDateKey } from "../shared/jst";
import { XorShift128, seedFromParts } from "../shared/rng";
import { rollMurmur } from "../murmur/murmur";
import { grantExp } from "./progress";

export class TrainError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "stored" | "no_vp" | "daily_limit" | "tired" | "level_cap",
    message: string,
  ) {
    super(message);
  }
}

export interface TrainDeps {
  db: Firestore;
  now?: () => Date;
  murmur?: typeof rollMurmur;
}

export interface TrainResult {
  trained: boolean; // false = 上限到達で VP 未消費（「もう伸びないようだ」）
  message: string | null;
  statsDelta: Stats;
  stats: Stats;
  fatigue: number;
  exp: number;
  level: number;
  levelUps: number;
  vpBalance: number;
  trainingsToday: number;
  personalityRevealed: boolean;
  personality: number | null;
  murmurTextId: string | null;
}

export async function trainCore(deps: TrainDeps, uid: string, monsterId: string, type: TrainingType): Promise<TrainResult> {
  const { constants: C } = loadConfig();
  const now = deps.now ?? (() => new Date());
  const murmur = deps.murmur ?? rollMurmur;
  const db = deps.db;
  const today = jstDateKey(now());
  const userRef = db.collection("users").doc(uid);
  const pubRef = db.collection("monsters").doc(monsterId);
  const privRef = db.collection("monsters_private").doc(monsterId);
  const tconf = C.trainings[type];
  if (!tconf) throw new TrainError("not_found", "そのトレーニングはありません");

  return db.runTransaction(async (tx) => {
    const [userSnap, pub, priv] = await Promise.all([tx.get(userRef), tx.get(pubRef), tx.get(privRef)]);
    if (!pub.exists || !priv.exists) throw new TrainError("not_found", "モンスターが見つかりません");
    if (pub.get("ownerId") !== uid) throw new TrainError("forbidden", "自分のモンスターではありません");
    if (pub.get("status") !== "active") throw new TrainError("stored", "保管中のモンスターはトレーニングできません");

    const user = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
    const daily = (user.dailyState as Record<string, unknown> | undefined) ?? {};
    const sameDay = daily.date === today;
    const trainingsToday = sameDay ? ((daily.trainingsToday as number | undefined) ?? 0) : 0;
    const vpBalance = (user.vpBalance as number | undefined) ?? 0;
    const cost = C.trainingCostVp as number;

    const p = pub.data() as Record<string, unknown>;
    const pr = priv.data() as Record<string, unknown>;
    const stats = p.stats as Stats;
    const talent = pr.talent as StatsInt;
    const fatigue = (p.fatigue as number | undefined) ?? 0;
    const trainingCount = (p.trainingCount as number | undefined) ?? 0;

    // §4.5: 上限到達済みステータスを選んだら VP を消費せず「もう伸びないようだ」
    if (stats[tconf.main] >= statCap(talent[tconf.main])) {
      return {
        trained: false,
        message: "もう伸びないようだ",
        statsDelta: zeroStats(),
        stats,
        fatigue,
        exp: p.exp as number,
        level: p.level as number,
        levelUps: 0,
        vpBalance,
        trainingsToday,
        personalityRevealed: (p.personalityRevealed as boolean) ?? false,
        personality: (p.personalityRevealed as boolean) ? (p.personality as number) : null,
        murmurTextId: null,
      } satisfies TrainResult;
    }
    if (fatigue > (C.trainingFatigueBlock as number)) throw new TrainError("tired", "疲れている。休ませよう");
    if (trainingsToday >= (C.trainingsPerDay as number)) throw new TrainError("daily_limit", "今日のトレーニングはおしまい");
    if (vpBalance < cost) throw new TrainError("no_vp", "活力ポイントが足りない。歩いてためよう");

    const rng = new XorShift128(seedFromParts(pr.seed as string, "train", String(trainingCount), "", ""));
    const t = applyTraining(stats, talent, p.personality as number, type, fatigue, rng);
    const delta = zeroStats();
    for (const s of STATS) delta[s] = t.stats[s] - stats[s];

    const res = grantExp(
      {
        seed: pr.seed as string,
        level: p.level as number,
        exp: p.exp as number,
        stats: t.stats,
        talent,
        growth: pr.growth as GrowthType,
        personality: p.personality as number,
        statHistory: (p.statHistory as { level: number; stats: Stats }[]) ?? [],
      },
      C.expPerTraining as number,
    );
    const newCount = trainingCount + 1;
    const revealed = ((p.personalityRevealed as boolean) ?? false) || newCount >= (C.personalityRevealTrainings as number);
    const murmurTextId = murmur(
      { growth: pr.growth as GrowthType, murmurRate: pr.murmurRate as number, murmurWindowOffset: pr.murmurWindowOffset as number, level: res.level },
      1 + res.levelUps,
    );
    const newFatigue = Math.min(t.fatigue, (C.fatigueMax as number) + tconf.fatigue);

    const trainingBonus = (p.trainingBonus as Stats | undefined) ?? zeroStats();
    const newBonus = zeroStats();
    for (const s of STATS) newBonus[s] = (trainingBonus[s] ?? 0) + delta[s];

    tx.update(pubRef, {
      stats: res.stats,
      statHistory: res.statHistory,
      exp: res.exp,
      level: res.level,
      fatigue: newFatigue,
      trainingCount: newCount,
      trainingBonus: newBonus,
      personalityRevealed: revealed,
      ...(murmurTextId ? { lastMurmurTextId: murmurTextId } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      userRef,
      {
        vpBalance: vpBalance - cost,
        dailyState: { ...(sameDay ? daily : {}), date: today, trainingsToday: trainingsToday + 1 },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      trained: true,
      message: null,
      statsDelta: delta,
      stats: res.stats,
      fatigue: newFatigue,
      exp: res.exp,
      level: res.level,
      levelUps: res.levelUps,
      vpBalance: vpBalance - cost,
      trainingsToday: trainingsToday + 1,
      personalityRevealed: revealed,
      personality: revealed ? (p.personality as number) : null,
      murmurTextId,
    } satisfies TrainResult;
  });
}

function zeroStats(): Stats {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, luk: 0 };
}
