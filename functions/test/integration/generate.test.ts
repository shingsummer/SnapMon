// generateMonsterCore の結合テスト（Firestore エミュレータ）。
// 実行: npm run test:integration  （firebase emulators:exec が FIRESTORE_EMULATOR_HOST を設定する）
import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { Jimp } from "jimp";
import { beforeAll, describe, expect, it } from "vitest";
import { STATS, loadConfig } from "../../src/shared/config";
import { GenerateError, generateMonsterCore, hammingSimilarity } from "../../src/generate/generateMonster";
import { computePhash } from "../../src/generate/phash";
import { DEFAULT_FAKE_VISION, FakeVisionClient } from "../../src/generate/vision";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:integration`.");
}

let db: Firestore;

async function pngOf(color: number, w = 64, h = 64): Promise<Buffer> {
  const img = new Jimp({ width: w, height: h, color });
  return img.getBuffer("image/png");
}

/** テスト用ハッシュ: バイト列が同じなら同じ、違えば（ほぼ確実に）違う。pHash 自体は下の専用テストで見る */
const bytesHash = async (buf: Buffer) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

function deps(over: Partial<Parameters<typeof generateMonsterCore>[0]> = {}) {
  let t = Date.parse("2026-09-18T03:00:00Z"); // JST 12:00
  return {
    db,
    vision: new FakeVisionClient(DEFAULT_FAKE_VISION),
    phash: bytesHash,
    now: () => new Date((t += 61_000)), // 呼ぶごとに 61 秒進める（レート制限を越える）
    nonce: () => "fixed-nonce",
    ...over,
  };
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "snap-mon-7a9bf" });
  db = getFirestore();
});

describe("generateMonsterCore", () => {
  it("creates monster + private + inventory and consumes a snap", async () => {
    const uid = `u-${Date.now()}-a`;
    const res = await generateMonsterCore(deps(), uid, await pngOf(0x3366ffff));
    expect(res.family).toBe("aqua");
    expect(res.element).toBe("water");
    expect(res.moves).toHaveLength(2);
    expect(res.snapsUsed).toBe(1);
    expect(res.items[0].type).toBe("food_aqua");

    const pub = (await db.collection("monsters").doc(res.monsterId).get()).data()!;
    expect(pub.ownerId).toBe(uid);
    expect(pub.level).toBe(1);
    for (const s of STATS) expect(pub.stats[s]).toBe(res.base[s]);
    // 隠し値は公開ドキュメントに一切入っていない
    expect(pub.talent).toBeUndefined();
    expect(pub.growth).toBeUndefined();
    expect(pub.murmurRate).toBeUndefined();

    const priv = (await db.collection("monsters_private").doc(res.monsterId).get()).data()!;
    expect(priv.talent).toBeDefined();
    expect(["early", "avg", "late", "wave", "superlate"]).toContain(priv.growth);

    const user = (await db.collection("users").doc(uid).get()).data()!;
    expect(user.dailyState.snapsUsed).toBe(1);
    expect(user.partnerMonsterId).toBe(res.monsterId);
    const inv = (await db.collection("users").doc(uid).collection("inventory").doc("food_aqua").get()).data()!;
    expect(inv.count).toBe(res.items[0].count);

    const bucket = (await db.collection("art_buckets").doc(res.artBucketId).get()).data()!;
    expect(bucket.status).toBe("pending");
  });

  it("rejects faces without consuming a snap", async () => {
    const uid = `u-${Date.now()}-b`;
    const d = deps({ vision: new FakeVisionClient({ ...DEFAULT_FAKE_VISION, faceCount: 1 }) });
    await expect(generateMonsterCore(d, uid, await pngOf(0xff0000ff))).rejects.toMatchObject({ code: "face_detected" });
    const user = await db.collection("users").doc(uid).get();
    expect(user.exists).toBe(false);
  });

  it("rejects duplicate photos and enforces the daily limit", async () => {
    const { constants: C } = loadConfig();
    const uid = `u-${Date.now()}-c`;
    const d = deps();
    const img = await pngOf(0x00aa00ff);
    await generateMonsterCore(d, uid, img);
    await expect(generateMonsterCore(d, uid, img)).rejects.toMatchObject({ code: "duplicate_photo" });
    // 枠は 1 のまま
    expect((await db.collection("users").doc(uid).get()).get("dailyState.snapsUsed")).toBe(1);

    const colors = [0xaa0000ff, 0x0000aaff, 0xaaaa00ff, 0x00aaaaff];
    for (let i = 1; i < (C.snapsPerDay as number); i++) {
      await generateMonsterCore(d, uid, await pngOf(colors[i]));
    }
    await expect(generateMonsterCore(d, uid, await pngOf(0xaa00aaff))).rejects.toMatchObject({ code: "daily_limit" });
  });

  it("enforces the 1/min rate limit", async () => {
    const uid = `u-${Date.now()}-d`;
    const fixed = Date.parse("2026-09-18T03:00:00Z");
    const d = deps({ now: () => new Date(fixed) });
    await generateMonsterCore(d, uid, await pngOf(0x123456ff));
    await expect(generateMonsterCore(d, uid, await pngOf(0x654321ff))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("applies mentor inheritance reservation", async () => {
    const uid = `u-${Date.now()}-e`;
    const mentorRef = db.collection("monsters").doc();
    await mentorRef.set({ ownerId: uid, level: 50, isMentor: true, mentorMoveId: "beast_bite", inheritedMove: null, mentorUsed: false });
    await db.collection("monsters_private").doc(mentorRef.id).set({
      ownerId: uid,
      talent: { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, luk: 10 },
      growth: "avg",
    });
    await db.collection("users").doc(uid).set({ pendingDisciple: { mentorId: mentorRef.id, useCapsule: false } });

    const res = await generateMonsterCore(deps(), uid, await pngOf(0x777777ff));
    expect(res.mentorId).toBe(mentorRef.id);
    expect(res.inheritedMove).toEqual({ moveId: "beast_bite", generation: 1 });
    const priv = (await db.collection("monsters_private").doc(res.monsterId).get()).data()!;
    // 素質10 の師匠から 30%（=3）が上乗せされる。元が 5 以上なら 8 以上、上限 10
    for (const s of STATS) expect(priv.talent[s]).toBeGreaterThanOrEqual(4);
    const mentor = (await mentorRef.get()).data()!;
    expect(mentor.discipleId).toBe(res.monsterId);
    expect(mentor.mentorUsed).toBe(true);
    const user = (await db.collection("users").doc(uid).get()).data()!;
    expect(user.pendingDisciple).toBeUndefined();
  });

  it("computePhash: re-encoded image matches, inverted image does not", async () => {
    const a = new Jimp({ width: 64, height: 64, color: 0xffffffff });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (((x >> 3) + (y >> 3)) % 2 === 0) a.setPixelColor(0x000000ff, x, y);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (x < y / 2) a.setPixelColor(0x808080ff, x, y);
    const ha = await computePhash(await a.getBuffer("image/png"));
    const ha2 = await computePhash(await a.getBuffer("image/jpeg"));
    const hb = await computePhash(await a.clone().invert().getBuffer("image/png"));
    expect(ha).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingSimilarity(ha, ha2)).toBeGreaterThanOrEqual(0.9); // 再エンコードしても同一判定
    expect(hammingSimilarity(ha, hb)).toBeLessThan(0.9); // 明暗反転は別物
  });

  it("hammingSimilarity", () => {
    expect(hammingSimilarity("ffffffffffffffff", "ffffffffffffffff")).toBe(1);
    expect(hammingSimilarity("0000000000000000", "ffffffffffffffff")).toBe(0);
    expect(hammingSimilarity("0000000000000000", "000000000000000f")).toBeCloseTo(1 - 4 / 64);
  });
});
