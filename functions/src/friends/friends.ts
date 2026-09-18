// フレンド（企画書 §6.4 フレンド、§14.3 ストア審査の UGC 要件: 通報・ブロック）
import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

export class FriendError extends Error {
  constructor(
    public readonly code: "not_found" | "self" | "blocked" | "already" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字を除く

export function randomFriendCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 8) throw new FriendError("invalid", "フレンドコードは 8 文字です");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** 自分のフレンドコード（無ければ発行） */
export async function ensureFriendCode(db: Firestore, uid: string): Promise<string> {
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const existing = snap.get("friendCode") as string | undefined;
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    const code = randomFriendCode();
    const dup = await db.collection("users").where("friendCode", "==", code).limit(1).get();
    if (!dup.empty) continue;
    await userRef.set({ friendCode: code }, { merge: true });
    return code;
  }
  throw new Error("could not allocate friend code");
}

export async function addFriend(db: Firestore, uid: string, rawCode: string, myDisplayName: string | null = null): Promise<{ friendId: string; displayName: string | null }> {
  const code = normalizeCode(rawCode);
  const q = await db.collection("users").where("friendCode", "==", code).limit(1).get();
  if (q.empty) throw new FriendError("not_found", "そのコードのプレイヤーは見つかりません");
  const friendId = q.docs[0].id;
  if (friendId === uid) throw new FriendError("self", "自分のコードです");
  const theirEntry = await db.collection("friends").doc(friendId).collection("list").doc(uid).get();
  if (theirEntry.exists && theirEntry.get("blocked") === true) throw new FriendError("blocked", "このプレイヤーとはフレンドになれません");
  const myEntry = db.collection("friends").doc(uid).collection("list").doc(friendId);
  if ((await myEntry.get()).exists) throw new FriendError("already", "すでにフレンドです");
  const theirName = (q.docs[0].get("displayName") as string | undefined) ?? null;
  const batch = db.batch();
  batch.set(myEntry, { addedAt: FieldValue.serverTimestamp(), blocked: false, displayName: theirName });
  batch.set(
    db.collection("friends").doc(friendId).collection("list").doc(uid),
    { addedAt: FieldValue.serverTimestamp(), blocked: false, displayName: myDisplayName },
    { merge: true },
  );
  await batch.commit();
  return { friendId, displayName: theirName };
}

export async function removeFriend(db: Firestore, uid: string, friendId: string): Promise<void> {
  const batch = db.batch();
  batch.delete(db.collection("friends").doc(uid).collection("list").doc(friendId));
  batch.delete(db.collection("friends").doc(friendId).collection("list").doc(uid));
  await batch.commit();
}

/** ブロック: 自分側のエントリに blocked=true を立て、相手側からは自分を消す */
export async function blockUser(db: Firestore, uid: string, targetId: string): Promise<void> {
  if (targetId === uid) throw new FriendError("self", "自分はブロックできません");
  const batch = db.batch();
  batch.set(db.collection("friends").doc(uid).collection("list").doc(targetId), { blocked: true, blockedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.delete(db.collection("friends").doc(targetId).collection("list").doc(uid));
  await batch.commit();
}

export async function reportUser(db: Firestore, uid: string, targetId: string, reason: string, detail: string): Promise<{ reportId: string }> {
  if (targetId === uid) throw new FriendError("self", "自分は通報できません");
  const ref = await db.collection("reports").add({
    reporterId: uid,
    targetUserId: targetId,
    reason: reason.slice(0, 40),
    detail: detail.slice(0, 500),
    createdAt: FieldValue.serverTimestamp(),
    status: "open",
  });
  return { reportId: ref.id };
}

/** どちらかがブロックしていれば true */
export async function isBlockedEitherWay(db: Firestore, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([
    db.collection("friends").doc(a).collection("list").doc(b).get(),
    db.collection("friends").doc(b).collection("list").doc(a).get(),
  ]);
  return x.get("blocked") === true || y.get("blocked") === true;
}

export async function areFriends(db: Firestore, a: string, b: string): Promise<boolean> {
  const x = await db.collection("friends").doc(a).collection("list").doc(b).get();
  return x.exists && x.get("blocked") !== true;
}
