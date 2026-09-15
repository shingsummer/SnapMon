// ゴールデンテスト: tools/growth_ref.py（参照実装）が生成した fixtures と一致すること。
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { STATS, configDir, loadConfig } from "../src/shared/config";
import { XorShift128, seedFromParts } from "../src/shared/rng";
import { applyExp, expToNext, levelUp, rollGrowth, rollIndividual, statCap, talentFromRaw, train } from "../src/shared/growth";

const fx = JSON.parse(fs.readFileSync(path.join(configDir(), "fixtures", "growth_golden.json"), "utf-8"));
const EPS = 1e-9;

function toArr(stats: Record<string, number>): number[] {
  return STATS.map((s) => stats[s]);
}

describe("seedFromParts", () => {
  it("matches sha256 prefix", () => {
    for (const c of fx.seeds) {
      expect(seedFromParts(c.label, c.colorHex, c.userId, c.date, c.nonce)).toBe(c.seedHex);
    }
  });
});

describe("XorShift128", () => {
  it("raw u32 / double / randInt / randRange match", () => {
    for (const c of fx.rng) {
      let r = new XorShift128(c.seedHex);
      expect(c.u32.map(() => r.nextU32())).toEqual(c.u32);
      r = new XorShift128(c.seedHex);
      for (const d of c.doubles) expect(r.nextDouble()).toBeCloseTo(d, 12);
      r = new XorShift128(c.seedHex);
      for (const ri of c.randInt) expect(r.randInt(ri.lo, ri.hi)).toBe(ri.value);
      r = new XorShift128(c.seedHex);
      for (const rr of c.randRange) expect(Math.abs(r.randRange(rr.lo, rr.hi) - rr.value)).toBeLessThan(EPS);
    }
  });
});

describe("talentFromRaw", () => {
  it("all combinations", () => {
    for (const c of fx.talent) expect(talentFromRaw(c.rawBase, c.rawTalent)).toBe(c.talent);
  });
  it("statCap", () => {
    for (const c of fx.statCap) expect(statCap(c.talent)).toBe(c.cap);
  });
});

describe("rollGrowth", () => {
  it("boundaries", () => {
    for (const c of fx.growthRoll) expect(rollGrowth(c.bst0, c.u)).toBe(c.growth);
  });
});

describe("rollIndividual", () => {
  it("matches reference, with and without mentor", () => {
    for (const c of fx.individuals) {
      const ind = rollIndividual(new XorShift128(c.seedHex), c.mentorTalent, c.useCapsule);
      expect(ind.base).toEqual(c.expected.base);
      expect(ind.talent).toEqual(c.expected.talent);
      expect(ind.growth).toBe(c.expected.growth);
      expect(ind.personality).toBe(c.expected.personality);
      expect(Math.abs(ind.murmurRate - c.expected.murmurRate)).toBeLessThan(EPS);
      expect(ind.murmurWindowOffset).toBe(c.expected.murmurWindowOffset);
    }
  });
});

describe("levelUp Lv1->50", () => {
  it("full history matches reference", () => {
    const { constants: C } = loadConfig();
    for (const c of fx.levelUps) {
      const rng = new XorShift128(c.seedHex);
      const ind = rollIndividual(rng);
      let stats = { ...ind.base };
      for (let L = 1; L < C.levelCap; L++) {
        stats = levelUp(stats, ind.talent, ind.growth, L, ind.personality, rng);
        const expected: number[] = c.statsByLevel[L - 1];
        toArr(stats).forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(EPS));
      }
    }
  });
});

describe("train", () => {
  it("matches reference incl. cap clamp", () => {
    for (const c of fx.training) {
      const rng = new XorShift128(c.seedHex);
      const ind = rollIndividual(rng);
      const res = train(c.statsBefore, ind.talent, ind.personality, c.type, c.fatigueBefore, rng);
      toArr(res.stats).forEach((v, i) => expect(Math.abs(v - toArr(c.expected.stats)[i])).toBeLessThan(EPS));
      expect(res.fatigue).toBe(c.expected.fatigue);
    }
  });
});

describe("exp", () => {
  it("expToNext table", () => {
    for (const c of fx.expToNext) expect(expToNext(c.level)).toBe(c.exp);
  });
  it("applyExp cases", () => {
    for (const c of fx.exp) expect(applyExp(c.level, c.exp, c.gained)).toEqual(c.expected);
  });
});
