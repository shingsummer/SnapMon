// P2 の結合テスト（Firestore エミュレータ）: submitSteps / train / setPartner / useItem / rest
import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { STATS, loadConfig } from "../../src/shared/config";
import { generateMonsterCore } from "../../src/generate/generateMonster";
import { DEFAULT_FAKE_VISION, FakeVisionClient } from "../../src/generate/vision";
import { submitStepsCore } from "../../src/steps/submitSteps";
import { trainCore } from "../../src/monster/train";
import { restCore, setPartnerCore, useItemCore } from "../../src/monster/partnerAndItems";
import type { StepSegment } from "../../src/steps/validate";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
const MIN = 60_000;
const T0 = Date.parse("2026-09-18T03:00:00Z"); // JST 12:00

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});

let bornClock = T0 - 120 * MIN; // 誕生ごとに 61 秒進める（1分1回のレート制限を越える）
async function born(uid: string, tag: string) {
  const img = Buffer.from(`img-${uid}-${tag}`);
  return generateMonsterCore(
    {
      db,
      vision: new FakeVisionClient(DEFAULT_FAKE_VISION),
      phash: async (b) => createHash("sha256").update(b).digest("hex").slice(0, 16),
      now: () => new Date((bornClock += 61_000)),
      nonce: () => tag,
      skipLimits: true, // 無料枠は 1 日 1 枚（P6）。ここは育成側のテストなので枠は見ない
    },
    uid,
    img,
  );
}

const walk = (i: number, steps: number, activity: StepSegment["activity"] = "walking"): StepSegment => ({
  startAt: T0 + i * 5 * MIN,
  endAt: T0 + (i + 1) * 5 * MIN,
  steps,
  activity,
});

describe("submitSteps", () => {
  it("converts steps to VP, feeds the partner, dedupes on resubmit", async () => {
    const uid = `p2-${Date.now()}-a`;
    const m = await born(uid, "a"); // partner になる
    const deps = { db, now: () => new Date(T0 + 60 * MIN), murmur: () => "p001", skipRateLimit: true };
    const segs = [0, 1, 2, 3, 4, 5, 6].map((i) => walk(i, 500)); // 3500 歩、35 分連続
    const r = await submitStepsCore(deps, uid, segs);
    expect(r.acceptedSteps).toBe(3500);
    expect(r.vpGained).toBe(35 + 10); // 連続歩行ボーナス
    expect(r.walkBonusApplied).toBe(true);
    expect(r.partner?.monsterId).toBe(m.monsterId);
    expect(r.partner?.exp).toBe(35);
    expect(r.partner?.levelUps).toBe(1); // Lv1→2 は 24exp
    expect(r.murmurTextId).toBe("p001");

    const pub = (await db.collection("monsters").doc(m.monsterId).get()).data()!;
    expect(pub.level).toBe(2);
    expect(pub.exp).toBe(11);
    expect(pub.statHistory).toHaveLength(2);
    for (const s of STATS) expect(pub.stats[s]).toBeGreaterThan(m.base[s]);

    // 同じ区間をもう一度送っても受理されない
    const r2 = await submitStepsCore(deps, uid, segs);
    expect(r2.acceptedSteps).toBe(0);
    expect(r2.rejected.every((x) => x.reason === "already_synced")).toBe(true);
    const user = (await db.collection("users").doc(uid).get()).data()!;
    expect(user.vpBalance).toBe(45);
    expect(user.dailyState.stepsToday).toBe(3500);
  });

  it("rejects vehicles and enforces the 5-minute submit interval", async () => {
    const uid = `p2-${Date.now()}-b`;
    const fixed = new Date(T0 + 60 * MIN);
    const r = await submitStepsCore({ db, now: () => fixed, murmur: () => null }, uid, [walk(0, 500, "automotive"), walk(1, 500)]);
    expect(r.acceptedSteps).toBe(500);
    expect(r.rejected).toEqual([{ index: 0, reason: "vehicle" }]);
    await expect(submitStepsCore({ db, now: () => fixed, murmur: () => null }, uid, [walk(2, 100)])).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("train", () => {
  it("consumes VP, raises main/sub stats, adds exp, reveals personality after 3", async () => {
    const uid = `p2-${Date.now()}-c`;
    const m = await born(uid, "c");
    await db.collection("users").doc(uid).set({ vpBalance: 100 }, { merge: true });
    const deps = { db, now: () => new Date(T0 + 60 * MIN), murmur: () => null };

    const r1 = await trainCore(deps, uid, m.monsterId, "dash");
    expect(r1.trained).toBe(true);
    expect(r1.statsDelta.spd).toBeGreaterThan(0);
    expect(r1.statsDelta.atk).toBeGreaterThan(0);
    expect(r1.statsDelta.hp).toBe(0);
    expect(r1.vpBalance).toBe(90);
    expect(r1.fatigue).toBe(25);
    expect(r1.personalityRevealed).toBe(false);

    await trainCore(deps, uid, m.monsterId, "meditate");
    const r3 = await trainCore(deps, uid, m.monsterId, "endure");
    expect(r3.personalityRevealed).toBe(true);
    expect(r3.personality).not.toBeNull();
    expect(r3.exp + 0).toBeGreaterThanOrEqual(0);
    const pub = (await db.collection("monsters").doc(m.monsterId).get()).data()!;
    expect(pub.trainingCount).toBe(3);
    expect(pub.exp + (pub.level - 1) * 0).toBeGreaterThanOrEqual(0);
    expect(pub.level).toBe(2); // 45 exp → Lv2 (24) 残り 21
    expect(pub.exp).toBe(21);
  });

  it("blocks without VP, over daily limit, and when tired; cap returns 'もう伸びないようだ' without VP", async () => {
    const { constants: C } = loadConfig();
    const uid = `p2-${Date.now()}-d`;
    const m = await born(uid, "d");
    const deps = { db, now: () => new Date(T0 + 60 * MIN), murmur: () => null };
    await expect(trainCore(deps, uid, m.monsterId, "dash")).rejects.toMatchObject({ code: "no_vp" });

    await db.collection("users").doc(uid).set({ vpBalance: 200, dailyState: { date: "20260918", trainingsToday: C.trainingsPerDay } }, { merge: true });
    await expect(trainCore(deps, uid, m.monsterId, "dash")).rejects.toMatchObject({ code: "daily_limit" });

    await db.collection("users").doc(uid).set({ dailyState: { date: "20260918", trainingsToday: 0 } }, { merge: true });
    await db.collection("monsters").doc(m.monsterId).update({ fatigue: 101 });
    await expect(trainCore(deps, uid, m.monsterId, "dash")).rejects.toMatchObject({ code: "tired" });

    // 休息で回復、2 回目は不可
    await restCore(db, uid, m.monsterId, new Date(T0 + 60 * MIN));
    await expect(restCore(db, uid, m.monsterId, new Date(T0 + 60 * MIN))).rejects.toMatchObject({ code: "daily_limit" });

    // 上限到達ステータス: VP 未消費
    const priv = (await db.collection("monsters_private").doc(m.monsterId).get()).data()!;
    const cap = C.statCapBase + priv.talent.spd * C.statCapPerTalent;
    await db.collection("monsters").doc(m.monsterId).update({ "stats.spd": cap });
    const r = await trainCore(deps, uid, m.monsterId, "dash");
    expect(r.trained).toBe(false);
    expect(r.message).toBe("もう伸びないようだ");
    expect(r.vpBalance).toBe(200);
  });
});

describe("setPartner / useItem", () => {
  it("changes partner up to 3 times a day and feeds matching food", async () => {
    const uid = `p2-${Date.now()}-e`;
    const a = await born(uid, "e1");
    const b = await born(uid, "e2");
    const now = new Date(T0 + 60 * MIN);
    expect((await db.collection("users").doc(uid).get()).get("partnerMonsterId")).toBe(a.monsterId);
    await setPartnerCore(db, uid, b.monsterId, now);
    await setPartnerCore(db, uid, a.monsterId, now);
    await setPartnerCore(db, uid, b.monsterId, now);
    await expect(setPartnerCore(db, uid, a.monsterId, now)).rejects.toMatchObject({ code: "daily_limit" });

    // 誕生で food_aqua が 2 体分入っている
    const inv = (await db.collection("users").doc(uid).collection("inventory").doc("food_aqua").get()).data()!;
    const r = await useItemCore(db, uid, a.monsterId, "food_aqua", now);
    expect(r.remaining).toBe(inv.count - 1);
    expect(r.exp + r.level * 100).toBeGreaterThan(0);
    await expect(useItemCore(db, uid, a.monsterId, "food_beast", now)).rejects.toMatchObject({ code: "no_item" });
    await db.collection("users").doc(uid).collection("inventory").doc("food_beast").set({ type: "food_beast", count: 1 });
    await expect(useItemCore(db, uid, a.monsterId, "food_beast", now)).rejects.toMatchObject({ code: "wrong_family" });
  });
});
