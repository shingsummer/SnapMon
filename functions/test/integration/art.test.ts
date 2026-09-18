// アートバケット処理の結合テスト（Firestore エミュレータ）
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { artStats, enqueuePregeneration, processArtBucket, STATS_DOC } from "../../src/art/artBucket";
import { FakeImageGenerator, type ImageGenerator } from "../../src/art/generator";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});

function deps(generator: ImageGenerator = new FakeImageGenerator()) {
  const saved: Record<string, number> = {};
  return {
    d: { db, generator, saveImage: async (p: string, png: Buffer) => ((saved[p] = png.length), p) },
    saved,
  };
}

async function newBucket(id: string, status = "pending") {
  await db.collection("art_buckets").doc(id).set({ family: "aqua", subFamily: null, element: "water", colorBucket: "h7l1", imagePath: null, status, hitCount: 3 });
}

describe("processArtBucket", () => {
  it("generates once, stores the image, marks ready and accumulates cost", async () => {
    const id = `t-${Date.now()}-a`;
    await newBucket(id);
    const { d, saved } = deps();
    const r = await processArtBucket(d, id);
    expect(r.outcome).toBe("generated");
    expect(r.imagePath).toBe(`art/${id}.png`);
    expect(saved[`art/${id}.png`]).toBeGreaterThan(100);
    const doc = (await db.collection("art_buckets").doc(id).get()).data()!;
    expect(doc.status).toBe("ready");
    expect(doc.attempts).toBe(1);
    // 2 回目は何もしない
    expect((await processArtBucket(d, id)).outcome).toBe("already_ready");
  });

  it("marks failed on generator error and retries up to artMaxAttempts", async () => {
    const id = `t-${Date.now()}-b`;
    await newBucket(id);
    const boom: ImageGenerator = { generate: async () => { throw new Error("quota"); } };
    const { d } = deps(boom);
    expect((await processArtBucket(d, id)).outcome).toBe("failed");
    expect((await processArtBucket(d, id)).outcome).toBe("failed");
    expect((await processArtBucket(d, id)).outcome).toBe("failed");
    const r4 = await processArtBucket(d, id);
    expect(r4.outcome).toBe("failed");
    expect(r4.attempts).toBe(3); // 上限で打ち止め（生成は呼ばれない）
    const doc = (await db.collection("art_buckets").doc(id).get()).data()!;
    expect(doc.error).toContain("quota");
    // 成功する生成器に替えても上限なので動かない → 手動リセット（attempts を戻す）で復帰
    await db.collection("art_buckets").doc(id).update({ attempts: 0 });
    expect((await processArtBucket(deps().d, id)).outcome).toBe("generated");
  });

  it("does not double-generate while another worker is generating", async () => {
    const id = `t-${Date.now()}-c`;
    await newBucket(id, "generating");
    expect((await processArtBucket(deps().d, id)).outcome).toBe("in_progress");
    expect((await processArtBucket(deps().d, "nope")).outcome).toBe("not_found");
  });

  it("pregeneration enqueues 252 buckets idempotently and stats reflect hit rate", async () => {
    const first = await enqueuePregeneration(db);
    const second = await enqueuePregeneration(db);
    expect(first.created + first.existing).toBe(252);
    expect(second.created).toBe(0);
    const s = await artStats(db);
    expect(s.buckets).toBeGreaterThanOrEqual(252);
    expect(s.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(s.cacheHitRate).toBeLessThanOrEqual(1);
    const summary = await db.doc(STATS_DOC).get();
    expect(summary.exists).toBe(true);
  });
});
