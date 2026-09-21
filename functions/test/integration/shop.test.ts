// 課金（§12、P6）: 付与の冪等性、撮影チケットの消費と 1 日の合計上限、プレミアムの +1 枚、はじめのチケット、専用アート券。
import { createHash, randomBytes } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { Jimp } from "jimp";
import { beforeAll, describe, expect, it } from "vitest";
import { setBirthYearCore } from "../../src/account/account";
import { generateMonsterCore } from "../../src/generate/generateMonster";
import { DEFAULT_FAKE_VISION, FakeVisionClient } from "../../src/generate/vision";
import { loadConfig } from "../../src/shared/config";
import { DevPurchaseVerifier, applyArtUpgradeCore, freeSnapAllowance, redeemPurchaseCore } from "../../src/shop/shop";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});
const uniqueUid = () => `u-${randomBytes(6).toString("hex")}`;
const NOW = new Date("2026-10-02T03:00:00Z"); // JST 12:00

async function pngOf(color: number): Promise<Buffer> {
  const img = new Jimp({ width: 32, height: 32, color });
  // 写真ごとに pHash が変わるように模様を入れる
  for (let i = 0; i < 32; i++) img.setPixelColor(0x000000ff, (i * 7 + (color >>> 8)) % 32, (i * 3) % 32);
  return img.getBuffer("image/png");
}

/** テスト用ハッシュ: バイト列が違えば別の写真（小さな合成画像は本物の pHash だと似すぎて弾かれる） */
const bytesHash = async (buf: Buffer) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

function genDeps() {
  // generateMonster は 1 分 1 回のレート制限があるので、呼ぶたびに時計を 61 秒進める（同じ JST の日のまま）
  let clock = NOW.getTime();
  return { db, vision: new FakeVisionClient(DEFAULT_FAKE_VISION), phash: bytesHash, now: () => new Date((clock += 61_000)), nonce: () => randomBytes(4).toString("hex") };
}

async function tickets(uid: string): Promise<number> {
  const s = await db.collection("users").doc(uid).collection("inventory").doc("snap_ticket").get();
  return s.exists ? ((s.get("count") as number | undefined) ?? 0) : 0;
}

describe("redeemPurchase", () => {
  it("consumable grants items; the same orderId grants only once", async () => {
    const uid = uniqueUid();
    const deps = { db, verifier: new DevPurchaseVerifier(), now: () => NOW };
    const r1 = await redeemPurchaseCore(deps, uid, { platform: "dev", productId: "snap_ticket_5", token: "order-1" });
    expect(r1.alreadyGranted).toBe(false);
    expect(await tickets(uid)).toBe(5);
    const r2 = await redeemPurchaseCore(deps, uid, { platform: "dev", productId: "snap_ticket_5", token: "order-1" });
    expect(r2.alreadyGranted).toBe(true);
    expect(await tickets(uid)).toBe(5);
    await redeemPurchaseCore(deps, uid, { platform: "dev", productId: "snap_ticket_5", token: "order-2" });
    expect(await tickets(uid)).toBe(10);
    await expect(redeemPurchaseCore(deps, uid, { platform: "dev", productId: "nope", token: "x" })).rejects.toMatchObject({ code: "unknown_product" });
  });

  it("subscription extends premiumUntil from the later of now / current", async () => {
    const uid = uniqueUid();
    const deps = { db, verifier: new DevPurchaseVerifier(), now: () => NOW };
    const a = await redeemPurchaseCore(deps, uid, { platform: "dev", productId: "premium_monthly", token: "p1" });
    expect(a.premiumUntil).toBe(NOW.getTime() + 30 * 86400_000);
    const b = await redeemPurchaseCore(deps, uid, { platform: "dev", productId: "premium_monthly", token: "p2" });
    expect(b.premiumUntil).toBe(NOW.getTime() + 60 * 86400_000);
    const user = (await db.collection("users").doc(uid).get()).data()!;
    expect(freeSnapAllowance(user, NOW)).toBe(loadConfig().constants.snapsPerDay + 1);
    expect(freeSnapAllowance(user, new Date(NOW.getTime() + 61 * 86400_000))).toBe(loadConfig().constants.snapsPerDay);
  });
});

describe("snap quota with tickets", () => {
  it("free 1/day, then tickets, capped at snapsMaxPerDay per day", async () => {
    const { constants: C } = loadConfig();
    expect(C.snapsPerDay).toBe(1);
    expect(C.snapsMaxPerDay).toBe(3);
    const uid = uniqueUid();
    const d = genDeps();
    await redeemPurchaseCore({ db, verifier: new DevPurchaseVerifier(), now: () => NOW }, uid, { platform: "dev", productId: "snap_ticket_5", token: "t" });

    const r1 = await generateMonsterCore(d, uid, await pngOf(0xaa0000ff));
    expect(r1.ticketUsed).toBe(false);
    expect(r1.snapsPerDay).toBe(1);
    expect(r1.ticketsLeft).toBe(5);

    const r2 = await generateMonsterCore(d, uid, await pngOf(0x00aa00ff));
    expect(r2.ticketUsed).toBe(true);
    expect(r2.ticketsLeft).toBe(4);
    const r3 = await generateMonsterCore(d, uid, await pngOf(0x0000aaff));
    expect(r3.ticketUsed).toBe(true);
    expect(await tickets(uid)).toBe(3);

    // 4 枚目: チケットがあっても 1 日の合計上限
    await expect(generateMonsterCore(d, uid, await pngOf(0xaaaa00ff))).rejects.toMatchObject({ code: "daily_limit" });
    expect(await tickets(uid)).toBe(3); // 消費されない
  });

  it("premium adds one free snap per day", async () => {
    const uid = uniqueUid();
    const d = genDeps();
    await redeemPurchaseCore({ db, verifier: new DevPurchaseVerifier(), now: () => NOW }, uid, { platform: "dev", productId: "premium_monthly", token: "p" });
    const r1 = await generateMonsterCore(d, uid, await pngOf(0xaa0000ff));
    expect(r1.snapsPerDay).toBe(2);
    const r2 = await generateMonsterCore(d, uid, await pngOf(0x00aa00ff));
    expect(r2.ticketUsed).toBe(false);
    await expect(generateMonsterCore(d, uid, await pngOf(0x0000aaff))).rejects.toMatchObject({ code: "no_ticket" });
  });

  it("starter tickets are granted once at age verification", async () => {
    const uid = uniqueUid();
    await setBirthYearCore(db, uid, 1990, NOW);
    expect(await tickets(uid)).toBe(loadConfig().constants.starterSnapTickets as number);
    await setBirthYearCore(db, uid, 1991, NOW); // 2 回目は増えない
    expect(await tickets(uid)).toBe(loadConfig().constants.starterSnapTickets as number);
  });
});

describe("applyArtUpgrade", () => {
  it("consumes one art_upgrade, resets art state and regenerates with the configured quality", async () => {
    const uid = uniqueUid();
    const d = genDeps();
    const born = await generateMonsterCore({ ...d, saveSource: async (_u, id) => `source/${uid}/${id}.jpg` }, uid, await pngOf(0xaa0000ff));
    const ref = db.collection("monsters").doc(born.monsterId);
    await ref.update({ artStatus: "ready", artImagePath: "art/monsters/x.png" });

    const calls: string[] = [];
    const deps = { db, regenerate: async (id: string, q: string) => void calls.push(`${id}:${q}`) || { outcome: "generated", imagePath: "art/monsters/x.png" } };
    await expect(applyArtUpgradeCore(deps, uid, born.monsterId)).rejects.toMatchObject({ code: "no_item" });

    await redeemPurchaseCore({ db, verifier: new DevPurchaseVerifier(), now: () => NOW }, uid, { platform: "dev", productId: "art_upgrade_1", token: "a1" });
    const res = await applyArtUpgradeCore(deps, uid, born.monsterId);
    expect(res.remaining).toBe(0);
    expect(calls).toEqual([`${born.monsterId}:medium`]);
    expect((await ref.get()).get("artAttempts")).toBe(0);

    await expect(applyArtUpgradeCore(deps, uniqueUid(), born.monsterId)).rejects.toMatchObject({ code: "forbidden" });
  });
});
