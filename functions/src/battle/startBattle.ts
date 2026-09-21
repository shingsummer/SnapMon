// startBattle / setBattleParty（企画書 §6.4, §7.1, §11）。
// - friend: フレンドの防衛パーティ（未設定なら新しい順の 3 体）と非同期対戦。1 日 10 回、報酬は先着 3 回
// - practice: 自分の別モンスターと模擬戦（報酬なし・回数制限なし）。開発とチュートリアル用
// 解決はサーバー（同シード同結果）。ログは battles/{id} に保存し、攻守どちらも読める。
import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { fillStats, loadConfig, type GrowthType, type Stats, type StatsInt } from "../shared/config";
import { jstDateKey } from "../shared/jst";
import { grantExp, levelUpMovesUpdate } from "../monster/progress";
import { rollMurmur } from "../murmur/murmur";
import { areFriends, isBlockedEitherWay } from "../friends/friends";
import { combatantFromDoc, resolveBattle, type BattleResult, type Combatant } from "./engine";

export class BattleError extends Error {
  constructor(
    public readonly code: "invalid_party" | "not_friend" | "blocked" | "no_defender" | "rate_limited" | "daily_limit" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

export interface BattleDeps {
  db: Firestore;
  now?: () => Date;
  seed?: () => string;
  murmur?: typeof rollMurmur;
}

export interface StartBattleResult {
  battleId: string;
  type: "friend" | "practice";
  winner: "A" | "B" | "draw";
  result: BattleResult;
  rewards: { vp: number; expPerMonster: number; rewarded: boolean; battlesToday: number };
  murmurTextId: string | null;
}

async function loadOwnedParty(db: Firestore, uid: string, ids: string[]): Promise<{ combatants: Combatant[]; docs: FirebaseFirestore.DocumentSnapshot[] }> {
  const { constants: C } = loadConfig();
  const size = C.battlePartySize as number;
  if (ids.length !== size || new Set(ids).size !== size) throw new BattleError("invalid_party", `パーティは ${size} 体です`);
  const docs = await Promise.all(ids.map((id) => db.collection("monsters").doc(id).get()));
  for (const d of docs) {
    if (!d.exists || d.get("ownerId") !== uid) throw new BattleError("invalid_party", "自分のモンスターを選んでください");
    if (d.get("status") !== "active") throw new BattleError("invalid_party", "保管中のモンスターは出せません");
  }
  return { combatants: docs.map((d) => combatantFromDoc(d.id, d.data() as Record<string, unknown>)), docs };
}

async function defenderParty(db: Firestore, ownerId: string): Promise<Combatant[]> {
  const { constants: C } = loadConfig();
  const size = C.battlePartySize as number;
  const user = await db.collection("users").doc(ownerId).get();
  const ids = (user.get("battleParty") as string[] | undefined) ?? [];
  let docs: FirebaseFirestore.DocumentSnapshot[] = [];
  if (ids.length === size) {
    docs = await Promise.all(ids.map((id) => db.collection("monsters").doc(id).get()));
    docs = docs.filter((d) => d.exists && d.get("ownerId") === ownerId && d.get("status") === "active");
  }
  if (docs.length < size) {
    const q = await db.collection("monsters").where("ownerId", "==", ownerId).orderBy("createdAt", "desc").limit(20).get();
    docs = q.docs.filter((d) => d.get("status") === "active").slice(0, size);
  }
  if (docs.length === 0) throw new BattleError("no_defender", "相手にはまだモンスターがいません");
  return docs.map((d) => combatantFromDoc(d.id, d.data() as Record<string, unknown>));
}

export async function setBattlePartyCore(db: Firestore, uid: string, ids: string[]): Promise<{ battleParty: string[] }> {
  await loadOwnedParty(db, uid, ids);
  await db.collection("users").doc(uid).set({ battleParty: ids, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { battleParty: ids };
}

export async function startBattleCore(
  deps: BattleDeps,
  uid: string,
  type: "friend" | "practice",
  targetId: string | null,
  partyIds: string[],
  practiceOpponentIds?: string[],
): Promise<StartBattleResult> {
  const { constants: C } = loadConfig();
  const db = deps.db;
  const now = deps.now ?? (() => new Date());
  const seed = deps.seed ?? (() => randomBytes(16).toString("hex"));
  const murmur = deps.murmur ?? rollMurmur;
  const nowDate = now(); // now() は 1 回だけ呼ぶ（テストで時計を進める実装があるため）
  const nowMs = nowDate.getTime();
  const today = jstDateKey(nowDate);
  const userRef = db.collection("users").doc(uid);

  const userSnap = await userRef.get();
  const user = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
  const lastStart = (user.lastBattleAt as number | undefined) ?? 0;
  if (nowMs - lastStart < (C.battleStartIntervalMs as number)) throw new BattleError("rate_limited", "少し待ってからもう一度");

  const mine = await loadOwnedParty(db, uid, partyIds);
  let opponent: Combatant[];
  let defenderId: string;
  if (type === "friend") {
    if (!targetId || targetId === uid) throw new BattleError("not_friend", "対戦相手を選んでください");
    if (await isBlockedEitherWay(db, uid, targetId)) throw new BattleError("blocked", "このプレイヤーとは対戦できません");
    if (!(await areFriends(db, uid, targetId))) throw new BattleError("not_friend", "フレンドとだけ対戦できます");
    opponent = await defenderParty(db, targetId);
    defenderId = targetId;
  } else {
    // 模擬戦: 自分の別モンスター（指定が無ければ、パーティ以外の新しい順）
    const ids = practiceOpponentIds ?? [];
    if (ids.length > 0) {
      if (ids.some((id) => partyIds.includes(id))) throw new BattleError("invalid_party", "同じモンスターは両側に出せません");
      opponent = (await loadOwnedParty(db, uid, ids)).combatants;
    } else {
      const q = await db.collection("monsters").where("ownerId", "==", uid).orderBy("createdAt", "desc").limit(30).get();
      const others = q.docs.filter((d) => d.get("status") === "active" && !partyIds.includes(d.id)).slice(0, C.battlePartySize as number);
      if (others.length === 0) throw new BattleError("no_defender", "模擬戦の相手がいません（パーティ以外のモンスターが必要）");
      opponent = others.map((d) => combatantFromDoc(d.id, d.data() as Record<string, unknown>));
    }
    defenderId = uid;
  }

  const battleSeed = seed();
  const result = resolveBattle(battleSeed, mine.combatants, opponent);
  const won = result.winner === "A";

  // 報酬（friend のみ）: VP は先着 3 回、経験値は毎回（§4.7: 勝 20 / 負 8）
  const daily = (user.dailyState as Record<string, unknown> | undefined) ?? {};
  const sameDay = daily.date === today;
  const battlesToday = sameDay ? ((daily.friendBattlesToday as number | undefined) ?? 0) : 0;
  let vp = 0;
  let expPer = 0;
  let rewarded = false;
  if (type === "friend") {
    if (battlesToday >= (C.friendBattlesPerDay as number)) throw new BattleError("daily_limit", "今日のフレンド戦はおしまい");
    expPer = won ? (C.expBattleWin as number) : (C.expBattleLose as number);
    if (battlesToday < (C.friendBattleRewardsPerDay as number)) {
      vp = won ? (C.battleFriendRewardVpWin as number) : (C.battleFriendRewardVpLose as number);
      rewarded = true;
    }
  }

  const battleRef = db.collection("battles").doc();
  const batch = db.batch();
  batch.set(battleRef, {
    type,
    attackerId: uid,
    defenderId,
    participants: uid === defenderId ? [uid] : [uid, defenderId], // array-contains で両者の履歴を引く
    attackerParty: partyIds,
    defenderParty: opponent.map((c) => c.id),
    seed: battleSeed,
    winner: result.winner,
    remainingA: result.remainingA,
    remainingB: result.remainingB,
    turnsTotal: result.turnsTotal,
    events: result.events,
    rewards: { vp, expPerMonster: expPer, rewarded },
    createdAt: FieldValue.serverTimestamp(),
  });

  let murmurTextId: string | null = null;
  if (expPer > 0) {
    // 参加モンスターに経験値。レベルアップは grantExp（決定論）
    const privs = await Promise.all(mine.docs.map((d) => db.collection("monsters_private").doc(d.id).get()));
    mine.docs.forEach((d, i) => {
      const p = d.data() as Record<string, unknown>;
      const pr = privs[i].data() as Record<string, unknown> | undefined;
      if (!pr) return;
      const res = grantExp(
        {
          seed: pr.seed as string,
          level: p.level as number,
          exp: p.exp as number,
          stats: fillStats(p.stats as Record<string, unknown>),
          talent: fillStats(pr.talent as Record<string, unknown>) as StatsInt,
          growth: pr.growth as GrowthType,
          personality: p.personality as number,
          statHistory: (p.statHistory as { level: number; stats: Stats }[]) ?? [],
          family: p.family as string,
        },
        expPer,
      );
      const m = i === 0 ? murmur({ growth: pr.growth as GrowthType, murmurRate: pr.murmurRate as number, murmurWindowOffset: pr.murmurWindowOffset as number, level: res.level }, 1 + res.levelUps) : null;
      if (i === 0) murmurTextId = m;
      batch.update(d.ref, {
        exp: res.exp,
        level: res.level,
        stats: res.stats,
        statHistory: res.statHistory,
        ...levelUpMovesUpdate(p, pr.seed as string, p.level as number, res.level),
        ...(m ? { lastMurmurTextId: m } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  const userUpdate: Record<string, unknown> = { lastBattleAt: nowMs, updatedAt: FieldValue.serverTimestamp() };
  if (type === "friend") {
    userUpdate.dailyState = { ...(sameDay ? daily : {}), date: today, friendBattlesToday: battlesToday + 1 };
    if (vp > 0) userUpdate.vpBalance = Math.min(C.maxVpBalance as number, ((user.vpBalance as number | undefined) ?? 0) + vp);
  }
  batch.set(userRef, userUpdate, { merge: true });
  await batch.commit();

  return {
    battleId: battleRef.id,
    type,
    winner: result.winner,
    result,
    rewards: { vp, expPerMonster: expPer, rewarded, battlesToday: type === "friend" ? battlesToday + 1 : battlesToday },
    murmurTextId,
  };
}
