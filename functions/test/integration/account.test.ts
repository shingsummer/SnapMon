// アカウント: 年齢確認とアカウント削除（Firestore エミュレータ）
import { randomBytes } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { AccountError, deleteAccountCore, setBirthYearCore } from "../../src/account/account";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});
const uniqueUid = () => `u-${randomBytes(6).toString("hex")}`;
const resetDb = async () => undefined; // uid をユニークにするので消さなくてよい

describe("setBirthYear", () => {
  it("13 歳以上なら birthYear を保存、13 歳未満は under_13、範囲外は invalid_year", async () => {
    await resetDb();
    const uid = uniqueUid();
    const now = new Date("2026-09-21T00:00:00Z");
    await expect(setBirthYearCore(db, uid, 2014, now)).rejects.toMatchObject({ code: "under_13" } satisfies Partial<AccountError>);
    await expect(setBirthYearCore(db, uid, 1800, now)).rejects.toMatchObject({ code: "invalid_year" });
    await expect(setBirthYearCore(db, uid, 2027, now)).rejects.toMatchObject({ code: "invalid_year" });
    expect((await db.collection("users").doc(uid).get()).get("birthYear")).toBeUndefined();
    await setBirthYearCore(db, uid, 2013, now); // ちょうど 13 歳（年だけの判定）
    expect((await db.collection("users").doc(uid).get()).get("birthYear")).toBe(2013);
  });
});

describe("deleteAccount", () => {
  it("モンスター・非公開・フレンド双方向・在庫・歩数区間・users を消し、相手のデータは残す", async () => {
    await resetDb();
    const uid = uniqueUid();
    const other = uniqueUid();
    const batch = db.batch();
    for (let i = 0; i < 3; i++) {
      const ref = db.collection("monsters").doc(`m-${uid}-${i}`);
      batch.set(ref, { ownerId: uid, name: `m${i}` });
      batch.set(db.collection("monsters_private").doc(ref.id), { seed: "x" });
    }
    batch.set(db.collection("monsters").doc(`m-${other}-0`), { ownerId: other, name: "theirs" });
    batch.set(db.collection("monsters_private").doc(`m-${other}-0`), { seed: "y" });
    batch.set(db.collection("users").doc(uid), { displayName: "me", birthYear: 1990 });
    batch.set(db.collection("users").doc(uid).collection("inventory").doc("food_aqua"), { count: 2 });
    batch.set(db.collection("users").doc(uid).collection("stepSegments").doc("1"), { steps: 100 });
    batch.set(db.collection("users").doc(other), { displayName: "them" });
    batch.set(db.collection("friends").doc(uid).collection("list").doc(other), { addedAt: 1 });
    batch.set(db.collection("friends").doc(other).collection("list").doc(uid), { addedAt: 1 });
    batch.set(db.collection("battles").doc("b1"), { participants: [uid, other], winner: "A" });
    await batch.commit();

    const calls: string[] = [];
    const res = await deleteAccountCore(
      { db, deleteSourceImages: async (u) => void calls.push(`storage:${u}`), deleteAuthUser: async (u) => void calls.push(`auth:${u}`) },
      uid,
    );
    expect(res).toEqual({ monsters: 3, friends: 1 });
    expect(calls).toEqual([`storage:${uid}`, `auth:${uid}`]);

    expect((await db.collection("monsters").where("ownerId", "==", uid).get()).empty).toBe(true);
    expect((await db.collection("monsters_private").doc(`m-${uid}-0`).get()).exists).toBe(false);
    expect((await db.collection("users").doc(uid).get()).exists).toBe(false);
    expect((await db.collection("users").doc(uid).collection("inventory").get()).empty).toBe(true);
    expect((await db.collection("users").doc(uid).collection("stepSegments").get()).empty).toBe(true);
    expect((await db.collection("friends").doc(uid).collection("list").get()).empty).toBe(true);
    expect((await db.collection("friends").doc(other).collection("list").doc(uid).get()).exists).toBe(false);
    // 相手のデータと対戦ログは残る
    expect((await db.collection("monsters").doc(`m-${other}-0`).get()).exists).toBe(true);
    expect((await db.collection("users").doc(other).get()).exists).toBe(true);
    expect((await db.collection("battles").doc("b1").get()).exists).toBe(true);

    // 二度目も失敗しない（冪等）
    expect(await deleteAccountCore({ db }, uid)).toEqual({ monsters: 0, friends: 0 });
  });
});
