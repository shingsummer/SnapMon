// setPartner / useItem / rest（企画書 §11, §5.3, §5.4）
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { loadConfig, type GrowthType, type Stats, type StatsInt } from "../shared/config";
import { jstDateKey } from "../shared/jst";
import { grantExp, levelUpMovesUpdate } from "./progress";

export class MonsterActionError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "stored" | "daily_limit" | "no_item" | "wrong_family" | "unknown_item",
    message: string,
  ) {
    super(message);
  }
}

async function loadOwned(db: Firestore, tx: FirebaseFirestore.Transaction, uid: string, monsterId: string) {
  const pubRef = db.collection("monsters").doc(monsterId);
  const privRef = db.collection("monsters_private").doc(monsterId);
  const [pub, priv] = await Promise.all([tx.get(pubRef), tx.get(privRef)]);
  if (!pub.exists || !priv.exists) throw new MonsterActionError("not_found", "モンスターが見つかりません");
  if (pub.get("ownerId") !== uid) throw new MonsterActionError("forbidden", "自分のモンスターではありません");
  return { pubRef, pub: pub.data() as Record<string, unknown>, priv: priv.data() as Record<string, unknown> };
}

export async function setPartnerCore(db: Firestore, uid: string, monsterId: string, now: Date = new Date()): Promise<{ partnerMonsterId: string; changesToday: number }> {
  const { constants: C } = loadConfig();
  const today = jstDateKey(now);
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const [userSnap, owned] = await Promise.all([tx.get(userRef), loadOwned(db, tx, uid, monsterId)]);
    if (owned.pub.status !== "active") throw new MonsterActionError("stored", "保管中のモンスターはパートナーにできません");
    const user = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
    if (user.partnerMonsterId === monsterId) return { partnerMonsterId: monsterId, changesToday: 0 };
    const daily = (user.dailyState as Record<string, unknown> | undefined) ?? {};
    const sameDay = daily.date === today;
    const changes = sameDay ? ((daily.partnerChangesToday as number | undefined) ?? 0) : 0;
    if (changes >= (C.partnerChangesPerDay as number)) throw new MonsterActionError("daily_limit", "パートナーの変更は1日3回までです");
    tx.set(
      userRef,
      { partnerMonsterId: monsterId, dailyState: { ...(sameDay ? daily : {}), date: today, partnerChangesToday: changes + 1 }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { partnerMonsterId: monsterId, changesToday: changes + 1 };
  });
}

export interface UseItemResult {
  itemType: string;
  remaining: number;
  exp: number;
  level: number;
  levelUps: number;
  fatigue: number;
}

/** 餌: ファミリー（サブファミリー含む）一致で経験値 +expPerFood。疲労回復薬: 疲労 0（1日1個）。 */
export async function useItemCore(db: Firestore, uid: string, monsterId: string, itemType: string, now: Date = new Date()): Promise<UseItemResult> {
  const { constants: C } = loadConfig();
  const today = jstDateKey(now);
  const userRef = db.collection("users").doc(uid);
  const invRef = userRef.collection("inventory").doc(itemType);
  return db.runTransaction(async (tx) => {
    const [userSnap, inv, owned] = await Promise.all([tx.get(userRef), tx.get(invRef), loadOwned(db, tx, uid, monsterId)]);
    const count = inv.exists ? ((inv.get("count") as number | undefined) ?? 0) : 0;
    if (count <= 0) throw new MonsterActionError("no_item", "そのアイテムを持っていません");
    if (owned.pub.status !== "active") throw new MonsterActionError("stored", "保管中のモンスターには使えません");
    const p = owned.pub;
    const pr = owned.priv;

    let exp = p.exp as number;
    let level = p.level as number;
    let levelUps = 0;
    let fatigue = (p.fatigue as number | undefined) ?? 0;
    const update: Record<string, unknown> = {};

    if (itemType.startsWith("food_")) {
      const fam = itemType.slice(5);
      if (fam !== p.family && fam !== p.subFamily) throw new MonsterActionError("wrong_family", "このエサは好みじゃないみたいだ");
      const res = grantExp(
        {
          seed: pr.seed as string,
          level,
          exp,
          stats: p.stats as Stats,
          talent: pr.talent as StatsInt,
          growth: pr.growth as GrowthType,
          personality: p.personality as number,
          statHistory: (p.statHistory as { level: number; stats: Stats }[]) ?? [],
        },
        C.expPerFood as number,
      );
      exp = res.exp;
      level = res.level;
      levelUps = res.levelUps;
      Object.assign(update, { exp, level, stats: res.stats, statHistory: res.statHistory }, levelUpMovesUpdate(p, pr.seed as string, p.level as number, level));
    } else if (itemType === "fatigue_cure") {
      const user = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
      const daily = (user.dailyState as Record<string, unknown> | undefined) ?? {};
      const sameDay = daily.date === today;
      const used = sameDay ? ((daily.fatigueCuresToday as number | undefined) ?? 0) : 0;
      if (used >= (C.fatigueCurePerDay as number)) throw new MonsterActionError("daily_limit", "疲労回復薬は1日1個までです");
      fatigue = 0;
      update.fatigue = 0;
      tx.set(userRef, { dailyState: { ...(sameDay ? daily : {}), date: today, fatigueCuresToday: used + 1 } }, { merge: true });
    } else {
      throw new MonsterActionError("unknown_item", "まだ使えないアイテムです");
    }

    tx.update(owned.pubRef, { ...update, updatedAt: FieldValue.serverTimestamp() });
    tx.set(invRef, { type: itemType, count: count - 1 }, { merge: true });
    return { itemType, remaining: count - 1, exp, level, levelUps, fatigue };
  });
}

/** 休息（VP 消費なし）: 疲労を 0 にする。1日1回。 */
export async function restCore(db: Firestore, uid: string, monsterId: string, now: Date = new Date()): Promise<{ fatigue: number }> {
  const today = jstDateKey(now);
  return db.runTransaction(async (tx) => {
    const owned = await loadOwned(db, tx, uid, monsterId);
    if (owned.pub.lastRestDate === today) throw new MonsterActionError("daily_limit", "今日はもう休んだ");
    tx.update(owned.pubRef, { fatigue: 0, lastRestDate: today, updatedAt: FieldValue.serverTimestamp() });
    return { fatigue: 0 };
  });
}
