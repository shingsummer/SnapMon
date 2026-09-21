import { describe, expect, it } from "vitest";
import { hintRate, rollMurmur, validateMurmurs } from "../src/murmur/murmur";
import { convertSteps, hasContinuousWalk, validateSegments, type StepSegment } from "../src/steps/validate";
import { grantExp } from "../src/monster/progress";
import { XorShift128 } from "../src/shared/rng";
import { STATS } from "../src/shared/config";

const MIN = 60_000;
const T0 = Date.parse("2026-09-18T03:00:00Z");
const seg = (i: number, steps: number, activity: StepSegment["activity"] = "walking", minutes = 5): StepSegment => ({
  startAt: T0 + i * 5 * MIN,
  endAt: T0 + i * 5 * MIN + minutes * MIN,
  steps,
  activity,
});

describe("validateSegments", () => {
  const now = T0 + 120 * MIN;
  it("accepts walking/running/unknown within limits", () => {
    const v = validateSegments([seg(0, 500), seg(1, 600, "running"), seg(2, 300, "unknown")], 0, now);
    expect(v.every((s) => s.accepted)).toBe(true);
  });
  it("rejects already synced, vehicles, stationary, too fast, future, invalid, too long", () => {
    const v = validateSegments(
      [
        seg(0, 100), // lastSyncAt より前 → 同期済み
        seg(1, 500, "automotive"),
        seg(2, 500, "cycling"),
        seg(3, 100, "stationary"),
        seg(4, 1200), // 240/min > 220
        { startAt: now + 6 * MIN, endAt: now + 10 * MIN, steps: 100, activity: "walking" }, // 未来
        { ...seg(6, 100), endAt: T0 + 6 * 5 * MIN }, // duration 0
        seg(7, 100, "walking", 40), // 40 分は長すぎ
      ],
      T0 + 1,
      now,
    );
    expect(v.map((s) => s.rejectReason)).toEqual(["already_synced", "vehicle", "vehicle", "stationary", "too_fast", "future", "invalid_range", "too_long"]);
  });
});

describe("hasContinuousWalk", () => {
  const now = T0 + 120 * MIN;
  it("true for 6 contiguous 5-min walking segments", () => {
    const v = validateSegments([0, 1, 2, 3, 4, 5].map((i) => seg(i, 400)), 0, now);
    expect(hasContinuousWalk(v)).toBe(true);
  });
  it("false when a gap breaks the run", () => {
    const v = validateSegments([0, 1, 2, 4, 5, 6].map((i) => seg(i, 400)), 0, now);
    expect(hasContinuousWalk(v)).toBe(false);
  });
  it("false when a vehicle segment breaks the run", () => {
    const v = validateSegments([seg(0, 400), seg(1, 400), seg(2, 400, "automotive"), seg(3, 400), seg(4, 400), seg(5, 400)], 0, now);
    expect(hasContinuousWalk(v)).toBe(false);
  });
});

describe("convertSteps", () => {
  const fresh = { stepsToday: 0, vpBalance: 0, vpEarnedToday: 0, stepCarry: 0, partnerExpToday: 0, walkBonusToday: false };
  it("100 steps = 1 VP with carry", () => {
    const r = convertSteps(fresh, 1234, false);
    expect(r.vpGained).toBe(12);
    expect(r.stepCarry).toBe(34);
    expect(r.partnerExp).toBe(12);
    const r2 = convertSteps({ ...fresh, stepCarry: r.stepCarry, stepsToday: r.stepsToday }, 70, false);
    expect(r2.vpGained).toBe(1);
    expect(r2.stepCarry).toBe(4);
  });
  it("caps at 12,000 steps/day and 200 VP balance", () => {
    const r = convertSteps({ ...fresh, stepsToday: 11_500, vpBalance: 195 }, 3000, false);
    expect(r.countedSteps).toBe(500);
    expect(r.stepsToday).toBe(12_000);
    expect(r.vpGained).toBe(5);
    expect(r.vpBalance).toBe(200);
    const r2 = convertSteps({ ...fresh, stepsToday: 12_000 }, 3000, false);
    expect(r2.vpGained).toBe(0);
  });
  it("walk bonus once per day", () => {
    const r = convertSteps(fresh, 3000, true);
    expect(r.vpGained).toBe(40);
    expect(r.walkBonusApplied).toBe(true);
    const r2 = convertSteps({ ...fresh, walkBonusToday: true }, 3000, true);
    expect(r2.vpGained).toBe(30);
    expect(r2.walkBonusApplied).toBe(false);
  });
  it("partner exp capped at 120/day", () => {
    const r = convertSteps({ ...fresh, partnerExpToday: 110 }, 5000, false);
    expect(r.partnerExp).toBe(10);
  });
});

describe("murmur", () => {
  it("murmurs.json is well-formed", () => {
    expect(validateMurmurs()).toEqual([]);
  });
  it("hint rate follows the window and the individual rate", () => {
    expect(hintRate({ growth: "superlate", murmurRate: 1, murmurWindowOffset: 0, level: 20 })).toBeCloseTo(0.08);
    expect(hintRate({ growth: "superlate", murmurRate: 1, murmurWindowOffset: 0, level: 5 })).toBeCloseTo(0.01);
    expect(hintRate({ growth: "superlate", murmurRate: 1, murmurWindowOffset: 4, level: 30 })).toBeCloseTo(0.08); // 12+4..28+4
    expect(hintRate({ growth: "avg", murmurRate: 1.5, murmurWindowOffset: 0, level: 20 })).toBeCloseTo(0.015);
    expect(hintRate({ growth: "wave", murmurRate: 0.5, murmurWindowOffset: 0, level: 1 })).toBeCloseTo(0.015);
  });
  it("every growth type can produce every hint text (no elimination by text)", () => {
    const seen: Record<string, Set<string>> = {};
    for (const growth of ["early", "avg", "late", "wave", "superlate"] as const) {
      seen[growth] = new Set();
      const rng = new XorShift128("0123456789abcdef0123456789abcdef");
      for (let i = 0; i < 4000; i++) {
        const id = rollMurmur({ growth, murmurRate: 1.5, murmurWindowOffset: 0, level: 20 }, 3, rng);
        if (id?.startsWith("h")) seen[growth].add(id);
      }
    }
    const all = new Set(Object.values(seen).flatMap((s) => [...s]));
    for (const growth of Object.keys(seen)) expect(seen[growth].size).toBe(all.size);
  });
  it("hint frequency is near the configured rate", () => {
    const rng = new XorShift128("fedcba9876543210fedcba9876543210");
    let hints = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const id = rollMurmur({ growth: "superlate", murmurRate: 1, murmurWindowOffset: 0, level: 20 }, 1, rng);
      if (id?.startsWith("h")) hints++;
    }
    expect(hints / N).toBeGreaterThan(0.065);
    expect(hints / N).toBeLessThan(0.095);
  });
});

describe("grantExp", () => {
  const base = { hp: 20, atk: 20, def: 20, spa: 20, sdf: 20, spd: 20, luk: 20 };
  const m = {
    seed: "0123456789abcdef0123456789abcdef",
    level: 1,
    exp: 0,
    stats: { ...base },
    talent: { hp: 5, atk: 5, def: 5, spa: 5, sdf: 5, spd: 5, luk: 5 },
    growth: "avg" as const,
    personality: 0,
    statHistory: [{ level: 1, stats: { ...base } }],
  };
  it("levels up deterministically and records history", () => {
    const a = grantExp(m, 100); // Lv1→2 は 24exp, Lv2→3 は 28, Lv3→4 は 32 → 84 消費、残 16
    const b = grantExp(m, 100);
    expect(a.level).toBe(4);
    expect(a.exp).toBe(16);
    expect(a.levelUps).toBe(3);
    expect(a.statHistory).toHaveLength(4);
    expect(a.stats).toEqual(b.stats);
    for (const s of STATS) expect(a.stats[s]).toBeGreaterThan(base[s]);
  });
  it("stops at level cap", () => {
    const r = grantExp({ ...m, level: 49, exp: 0 }, 100000);
    expect(r.level).toBe(50);
    expect(r.exp).toBe(0);
    expect(r.levelUps).toBe(1);
  });
});
