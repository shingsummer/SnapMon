// 師匠・継承・保管牧場（企画書 v1.3 §5.5, §7.1, §11）
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { loadConfig } from "../shared/config";

export class MentorError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "forbidden"
      | "not_max_level"
      | "already_mentor"
      | "not_mentor"
      | "mentor_used"
      | "invalid_move"
      | "no_capsule"
      | "stored"
      | "partner"
      | "active_cap"
      | "reserved",
    message: string,
  ) {
    super(message);
  }
}

async function ownedRef(db: Firestore, tx: FirebaseFirestore.Transaction, uid: string, monsterId: string) {
  const ref = db.collection("monsters").doc(monsterId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new MentorError("not_found", "モンスターが見つかりません");
  if (snap.get("ownerId") !== uid) throw new MentorError("forbidden", "自分のモンスターではありません");
  return { ref, snap, data: snap.data() as Record<string, unknown> };
}

/** 師匠に任命（Lv50、取消不可）。師匠の型として渡す技を 1 つ選ぶ（4 技 or 受け継いだ型） */
export async function appointMentorCore(db: Firestore, uid: string, monsterId: string, mentorMoveId: string): Promise<{ monsterId: string; mentorMoveId: string }> {
  const { constants: C } = loadConfig();
  await db.runTransaction(async (tx) => {
    const { ref, data } = await ownedRef(db, tx, uid, monsterId);
    if ((data.level as number) < (C.levelCap as number)) throw new MentorError("not_max_level", `Lv${C.levelCap} になると師匠に任命できます`);
    if (data.isMentor === true) throw new MentorError("already_mentor", "すでに師匠です");
    const moves = (data.moves as string[] | undefined) ?? [];
    const inherited = (data.inheritedMove as { moveId: string } | null | undefined)?.moveId;
    if (!moves.includes(mentorMoveId) && inherited !== mentorMoveId) throw new MentorError("invalid_move", "その技は覚えていません");
    tx.update(ref, { isMentor: true, mentorMoveId, mentorAppointedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { monsterId, mentorMoveId };
}

/** 弟子を予約: 次に生まれる 1 体に素質の一部と師匠の型を継承（generateMonster が消費）。絆カプセルで継承率アップ */
export async function reserveDiscipleCore(db: Firestore, uid: string, mentorId: string, useCapsule: boolean): Promise<{ mentorId: string; useCapsule: boolean }> {
  const userRef = db.collection("users").doc(uid);
  const capsuleRef = userRef.collection("inventory").doc("bond_capsule");
  await db.runTransaction(async (tx) => {
    const [{ data }, userSnap, capsule] = await Promise.all([ownedRef(db, tx, uid, mentorId), tx.get(userRef), tx.get(capsuleRef)]);
    if (data.isMentor !== true) throw new MentorError("not_mentor", "師匠に任命されていません");
    if (data.mentorUsed === true) throw new MentorError("mentor_used", "この師匠はもう弟子をとりました");
    const pending = userSnap.get("pendingDisciple") as { mentorId: string } | undefined;
    if (pending && pending.mentorId !== mentorId) throw new MentorError("reserved", "別の師匠の弟子を予約中です");
    if (useCapsule) {
      const count = capsule.exists ? ((capsule.get("count") as number | undefined) ?? 0) : 0;
      if (count <= 0) throw new MentorError("no_capsule", "絆カプセルを持っていません");
      tx.set(capsuleRef, { type: "bond_capsule", count: count - 1 }, { merge: true });
    }
    tx.set(userRef, { pendingDisciple: { mentorId, useCapsule, reservedAt: Date.now() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { mentorId, useCapsule };
}

/** 予約の取り消し（カプセルは返さない: 単純化） */
export async function cancelDiscipleCore(db: Firestore, uid: string): Promise<void> {
  await db.collection("users").doc(uid).set({ pendingDisciple: FieldValue.delete() }, { merge: true });
}

/** アクティブ／保管の移動（§7.1）。保管中はトレーニング・バトル不可。アクティブ枠は無料 30 / プレミアム 100 */
export async function setStorageCore(db: Firestore, uid: string, monsterId: string, stored: boolean, now: Date = new Date()): Promise<{ status: string; activeCount: number; activeCap: number }> {
  const { constants: C } = loadConfig();
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const [{ ref, data }, userSnap] = await Promise.all([ownedRef(db, tx, uid, monsterId), tx.get(userRef)]);
    const premiumUntil = userSnap.get("premiumUntil") as number | undefined;
    const premium = typeof premiumUntil === "number" && premiumUntil > now.getTime();
    const cap = (premium ? C.activeCapPremium : C.activeCapFree) as number;
    const activeQ = await tx.get(db.collection("monsters").where("ownerId", "==", uid).where("status", "==", "active"));
    let activeCount = activeQ.size;
    if (stored) {
      if (data.status === "stored") return { status: "stored", activeCount, activeCap: cap };
      if (userSnap.get("partnerMonsterId") === monsterId) throw new MentorError("partner", "パートナーは保管できません。先にパートナーを変えてください");
      tx.update(ref, { status: "stored", storedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      activeCount -= 1;
    } else {
      if (data.status === "active") return { status: "active", activeCount, activeCap: cap };
      if (activeCount >= cap) throw new MentorError("active_cap", `育成中は ${cap} 体までです。誰かを保管してください`);
      tx.update(ref, { status: "active", storedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      activeCount += 1;
    }
    return { status: stored ? "stored" : "active", activeCount, activeCap: cap };
  });
}
