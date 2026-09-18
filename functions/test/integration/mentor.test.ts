// 師匠・継承・保管牧場の結合テスト（Firestore エミュレータ）
import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { STATS, loadConfig } from "../../src/shared/config";
import { generateMonsterCore } from "../../src/generate/generateMonster";
import { DEFAULT_FAKE_VISION, FakeVisionClient } from "../../src/generate/vision";
import { appointMentorCore, cancelDiscipleCore, reserveDiscipleCore, setStorageCore } from "../../src/monster/mentor";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});

let clock = Date.parse("2026-10-01T00:00:00Z");
async function born(uid: string) {
  const img = Buffer.from(`img-${uid}-${clock}`);
  return generateMonsterCore(
    {
      db,
      vision: new FakeVisionClient(DEFAULT_FAKE_VISION),
      phash: async (b) => createHash("sha256").update(b).digest("hex").slice(0, 16),
      now: () => new Date((clock += 25 * 3600_000)),
      nonce: () => String(clock),
    },
    uid,
    img,
  );
}

describe("mentor / disciple", () => {
  it("appoints at Lv50 with a known move, reserves a disciple (capsule consumed), and the next birth inherits", async () => {
    const { constants: C } = loadConfig();
    const uid = `mt-${Date.now()}-a`;
    const m = await born(uid);
    await expect(appointMentorCore(db, uid, m.monsterId, m.moves[0])).rejects.toMatchObject({ code: "not_max_level" });
    await db.collection("monsters").doc(m.monsterId).update({ level: C.levelCap });
    await expect(appointMentorCore(db, uid, m.monsterId, "nope_move")).rejects.toMatchObject({ code: "invalid_move" });
    await appointMentorCore(db, uid, m.monsterId, m.moves[0]);
    await expect(appointMentorCore(db, uid, m.monsterId, m.moves[0])).rejects.toMatchObject({ code: "already_mentor" });

    await expect(reserveDiscipleCore(db, uid, m.monsterId, true)).rejects.toMatchObject({ code: "no_capsule" });
    await db.collection("users").doc(uid).collection("inventory").doc("bond_capsule").set({ type: "bond_capsule", count: 1 });
    await reserveDiscipleCore(db, uid, m.monsterId, true);
    expect((await db.collection("users").doc(uid).collection("inventory").doc("bond_capsule").get()).get("count")).toBe(0);
    expect((await db.collection("users").doc(uid).get()).get("pendingDisciple").mentorId).toBe(m.monsterId);

    const child = await born(uid);
    expect(child.mentorId).toBe(m.monsterId);
    expect(child.inheritedMove).toEqual({ moveId: m.moves[0], generation: 1 });
    const mentorPriv = (await db.collection("monsters_private").doc(m.monsterId).get()).data()!;
    const childPriv = (await db.collection("monsters_private").doc(child.monsterId).get()).data()!;
    for (const s of STATS) expect(childPriv.talent[s]).toBeGreaterThanOrEqual(Math.min(10, Math.floor(mentorPriv.talent[s] * 0.5 + 0.5)));
    const mentor = (await db.collection("monsters").doc(m.monsterId).get()).data()!;
    expect(mentor.mentorUsed).toBe(true);
    expect(mentor.discipleId).toBe(child.monsterId);
    await expect(reserveDiscipleCore(db, uid, m.monsterId, false)).rejects.toMatchObject({ code: "mentor_used" });
  });

  it("cancels a reservation", async () => {
    const uid = `mt-${Date.now()}-b`;
    const m = await born(uid);
    await db.collection("monsters").doc(m.monsterId).update({ level: 50 });
    await appointMentorCore(db, uid, m.monsterId, m.moves[0]);
    await reserveDiscipleCore(db, uid, m.monsterId, false);
    await cancelDiscipleCore(db, uid);
    expect((await db.collection("users").doc(uid).get()).get("pendingDisciple")).toBeUndefined();
  });
});

describe("storage", () => {
  it("stores and restores, refuses the partner, and enforces the active cap", async () => {
    const { constants: C } = loadConfig();
    const uid = `st-${Date.now()}`;
    const a = await born(uid); // partner
    const b = await born(uid);
    await expect(setStorageCore(db, uid, a.monsterId, true)).rejects.toMatchObject({ code: "partner" });
    const r = await setStorageCore(db, uid, b.monsterId, true);
    expect(r.status).toBe("stored");
    expect(r.activeCap).toBe(C.activeCapFree);
    expect((await db.collection("monsters").doc(b.monsterId).get()).get("status")).toBe("stored");

    // アクティブ枠いっぱいのときは戻せない
    await db.collection("users").doc(uid).set({ premiumUntil: 0 }, { merge: true });
    const fill = [];
    for (let i = 0; i < (C.activeCapFree as number) - 1; i++) {
      fill.push(db.collection("monsters").add({ ownerId: uid, status: "active", family: "aqua", element: "water", level: 1 }));
    }
    await Promise.all(fill);
    await expect(setStorageCore(db, uid, b.monsterId, false)).rejects.toMatchObject({ code: "active_cap" });
    // プレミアムなら 100 体まで
    await db.collection("users").doc(uid).set({ premiumUntil: Date.now() + 86400_000 }, { merge: true });
    const r2 = await setStorageCore(db, uid, b.monsterId, false);
    expect(r2.status).toBe("active");
    expect(r2.activeCap).toBe(C.activeCapPremium);
  });
});
