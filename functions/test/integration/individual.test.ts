// 個体アート（写真参照）の結合テスト（Firestore エミュレータ）
import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { Jimp } from "jimp";
import { beforeAll, describe, expect, it } from "vitest";
import { generateArtSamples, processMonsterArt } from "../../src/art/individual";
import { FakeImageGenerator, type ImageGenerator } from "../../src/art/generator";
import { generateMonsterCore } from "../../src/generate/generateMonster";
import { DEFAULT_FAKE_VISION, FakeVisionClient } from "../../src/generate/vision";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run via npm run test:integration");

let db: Firestore;
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: "snap-mon-7a9bf" });
  db = getFirestore();
});

const store = new Map<string, Buffer>();
function deps(generator: ImageGenerator = new FakeImageGenerator()) {
  return {
    db,
    generator,
    loadImage: async (p: string) => {
      const b = store.get(p);
      if (!b) throw new Error(`no image at ${p}`);
      return b;
    },
    saveImage: async (p: string, png: Buffer) => (store.set(p, png), p),
  };
}

let clock = Date.parse("2026-09-18T01:00:00Z");
async function born(uid: string, withSource: boolean) {
  const img = await new Jimp({ width: 32, height: 32, color: 0x3366ffff }).getBuffer("image/png");
  return generateMonsterCore(
    {
      db,
      vision: new FakeVisionClient(DEFAULT_FAKE_VISION),
      phash: async (b) => createHash("sha256").update(Buffer.concat([b, Buffer.from(String(clock))])).digest("hex").slice(0, 16),
      now: () => new Date((clock += 61_000)),
      nonce: () => String(clock),
      saveSource: withSource
        ? async (u, id, bytes) => {
            const p = `source/${u}/${id}.jpg`;
            store.set(p, bytes);
            return p;
          }
        : undefined,
    },
    uid,
    img,
  );
}

describe("processMonsterArt", () => {
  it("birth with a saved photo ends in artStatus pending, then generates an individual image", async () => {
    const uid = `ia-${Date.now()}-a`;
    const r = await born(uid, true);
    const doc0 = (await db.collection("monsters").doc(r.monsterId).get()).data()!;
    expect(doc0.artStatus).toBe("pending");
    expect(doc0.sourceImagePath).toBe(`source/${uid}/${r.monsterId}.jpg`);

    const res = await processMonsterArt(deps(), r.monsterId);
    expect(res.outcome).toBe("generated");
    expect(res.imagePath).toBe(`art/monsters/${r.monsterId}.png`);
    const doc = (await db.collection("monsters").doc(r.monsterId).get()).data()!;
    expect(doc.artStatus).toBe("ready");
    expect(doc.artQuality).toBe("low");
    expect((await processMonsterArt(deps(), r.monsterId)).outcome).toBe("already_ready");
  });

  it("birth without saveSource falls back to bucket art", async () => {
    const uid = `ia-${Date.now()}-b`;
    const r = await born(uid, false);
    const doc = (await db.collection("monsters").doc(r.monsterId).get()).data()!;
    expect(doc.artStatus).toBe("fallback");
    expect((await processMonsterArt(deps(), r.monsterId)).outcome).toBe("no_source");
  });

  it("fails then falls back after artIndividualMaxAttempts", async () => {
    const uid = `ia-${Date.now()}-c`;
    const r = await born(uid, true);
    const boom: ImageGenerator = { generate: async () => { throw new Error("x"); }, generateFromImage: async () => { throw new Error("quota"); } };
    expect((await processMonsterArt(deps(boom), r.monsterId)).outcome).toBe("failed");
    expect((await processMonsterArt(deps(boom), r.monsterId)).outcome).toBe("fallback");
    const doc = (await db.collection("monsters").doc(r.monsterId).get()).data()!;
    expect(doc.artStatus).toBe("fallback");
    expect(doc.artError).toContain("quota");
  });

  it("generateArtSamples writes low/medium samples and records cost", async () => {
    const uid = `ia-${Date.now()}-d`;
    const r = await born(uid, true);
    const out = await generateArtSamples(deps(), r.monsterId, ["low", "medium"]);
    expect(out.low.path).toBe(`art/samples/${r.monsterId}_low.png`);
    expect(out.medium.path).toBe(`art/samples/${r.monsterId}_medium.png`);
    const doc = (await db.collection("art_samples").doc(r.monsterId).get()).data()!;
    expect(doc.samples.low.path).toBe(out.low.path);
  });
});
