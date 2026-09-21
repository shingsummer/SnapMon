// アカウント関連（企画書 §14.3 年齢確認、利用規約 第 12 条・プライバシーポリシー 5 のアカウント削除）。
// - setBirthYear: 生年の自己申告。13 歳未満は登録しない（users に birthYear を書かない）
// - deleteAccount: 利用者のサーバー上のデータを消す。対戦ログは相手のデータでもあるので残す（表示名は含まれない）
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { loadConfig } from "../shared/config";

export class AccountError extends Error {
  constructor(
    public readonly code: "under_13" | "invalid_year",
    message: string,
  ) {
    super(message);
  }
}

export const MIN_AGE = 13;

/** 年齢確認。今年 − 生年 が 13 未満なら拒否（誕生日を聞かないので、年だけで保守的に判定） */
export async function setBirthYearCore(db: Firestore, uid: string, birthYear: number, now: Date = new Date()): Promise<{ birthYear: number }> {
  const thisYear = now.getFullYear();
  if (!Number.isInteger(birthYear) || birthYear < thisYear - 120 || birthYear > thisYear) throw new AccountError("invalid_year", "生まれた年を正しく入力してください");
  if (thisYear - birthYear < MIN_AGE) throw new AccountError("under_13", "13 歳未満の方は SnapMon を利用できません");
  // 年齢確認が通った最初の 1 回だけ、はじめの撮影チケットを配る（§12、P6: 初日から 3 対 3 のバトルまで体験できるように）
  const { constants: C } = loadConfig();
  const starter = (C.starterSnapTickets as number | undefined) ?? 0;
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const granted = snap.exists && snap.get("starterGranted") === true;
    tx.set(userRef, { birthYear, ...(granted ? {} : { starterGranted: true }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (!granted && starter > 0) {
      tx.set(userRef.collection("inventory").doc("snap_ticket"), { type: "snap_ticket", count: FieldValue.increment(starter) }, { merge: true });
    }
  });
  return { birthYear };
}

export interface DeleteAccountDeps {
  db: Firestore;
  /** Storage の出自写真（source/{uid}/）を消す。テストでは省略可 */
  deleteSourceImages?: (uid: string) => Promise<void>;
  /** Firebase Auth のユーザー削除。テストでは省略可 */
  deleteAuthUser?: (uid: string) => Promise<void>;
}

export interface DeleteAccountResult {
  monsters: number;
  friends: number;
}

async function deleteQueryInBatches(db: Firestore, q: FirebaseFirestore.Query, alsoIds?: (id: string) => FirebaseFirestore.DocumentReference[]): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await q.limit(200).get();
    if (snap.empty) return total;
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
      for (const extra of alsoIds?.(d.id) ?? []) batch.delete(extra);
    }
    await batch.commit();
    total += snap.size;
    if (snap.size < 200) return total;
  }
}

/**
 * 利用者のデータを削除する。順番: モンスター（公開・非公開）→ フレンド関係（自分の一覧と、相手の一覧にある自分）
 * → users 配下（inventory, stepSegments）→ users 本体 → Storage → Auth。
 * 途中で失敗しても再実行できるよう、各手順は冪等。
 */
export async function deleteAccountCore(deps: DeleteAccountDeps, uid: string): Promise<DeleteAccountResult> {
  const db = deps.db;
  const monsters = await deleteQueryInBatches(db, db.collection("monsters").where("ownerId", "==", uid), (id) => [db.collection("monsters_private").doc(id)]);

  // フレンド: 自分の一覧にある相手の一覧から自分を消し、自分の一覧を消す
  const myList = await db.collection("friends").doc(uid).collection("list").get();
  let friends = 0;
  if (!myList.empty) {
    const batch = db.batch();
    for (const d of myList.docs) {
      batch.delete(db.collection("friends").doc(d.id).collection("list").doc(uid));
      batch.delete(d.ref);
      friends++;
    }
    await batch.commit();
  }
  await db.collection("friends").doc(uid).delete().catch(() => undefined);

  const userRef = db.collection("users").doc(uid);
  await deleteQueryInBatches(db, userRef.collection("inventory"));
  await deleteQueryInBatches(db, userRef.collection("stepSegments"));
  await userRef.delete();

  if (deps.deleteSourceImages) await deps.deleteSourceImages(uid);
  if (deps.deleteAuthUser) await deps.deleteAuthUser(uid);
  return { monsters, friends };
}
