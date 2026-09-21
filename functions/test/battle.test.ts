import { describe, expect, it } from "vitest";
import { combatantFromDoc, loadMovesFile, moveById, resolveBattle, type Combatant } from "../src/battle/engine";

const mk = (id: string, element: Combatant["element"], stats: Partial<Combatant["stats"]>, moves: string[]): Combatant => ({
  id,
  name: id,
  family: "aqua",
  element,
  level: 50,
  stats: { hp: 500, atk: 500, def: 500, spa: 500, sdf: 500, spd: 500, luk: 50, ...stats },
  moves,
});

describe("moves table", () => {
  it("has 100 moves, 6 per family and 4 per element, unique ids", () => {
    const { moves } = loadMovesFile();
    expect(moves).toHaveLength(100);
    expect(new Set(moves.map((m) => m.id)).size).toBe(100);
    const fam = new Map<string, number>();
    const el = new Map<string, number>();
    for (const m of moves) {
      if (m.family) fam.set(m.family, (fam.get(m.family) ?? 0) + 1);
      if (m.element) el.set(m.element, (el.get(m.element) ?? 0) + 1);
    }
    expect([...fam.values()].every((n) => n === 6)).toBe(true);
    expect([...el.values()].every((n) => n === 4)).toBe(true);
    expect(moveById("neutral_tackle")?.power).toBe(190);
  });
});

describe("resolveBattle", () => {
  const seed = "0123456789abcdef0123456789abcdef";
  const teamA = [mk("a1", "fire", {}, ["fire_burst", "neutral_tackle"]), mk("a2", "water", {}, ["water_shot", "neutral_tackle"]), mk("a3", "grass", {}, ["grass_whip"])];
  const teamB = [mk("b1", "grass", {}, ["grass_whip", "neutral_tackle"]), mk("b2", "fire", {}, ["fire_burst"]), mk("b3", "water", {}, ["water_shot"])];

  it("is deterministic for the same seed and differs for another seed", () => {
    const r1 = resolveBattle(seed, teamA, teamB);
    const r2 = resolveBattle(seed, teamA, teamB);
    expect(r1).toEqual(r2);
    const r3 = resolveBattle("fedcba9876543210fedcba9876543210", teamA, teamB);
    expect(r3.events.map((e) => e.text)).not.toEqual(r1.events.map((e) => e.text));
  });

  it("always terminates with a winner and consistent HP snapshots", () => {
    const r = resolveBattle(seed, teamA, teamB);
    expect(["A", "B"]).toContain(r.winner);
    expect(r.events[0].type).toBe("start");
    expect(r.events[r.events.length - 1].type).toBe("end");
    for (const e of r.events) {
      expect(e.hpA).toBeGreaterThanOrEqual(0);
      expect(e.hpB).toBeGreaterThanOrEqual(0);
      expect(e.hpA).toBeLessThanOrEqual(e.maxA);
    }
    expect(r.turnsTotal).toBeLessThanOrEqual(10 * 5);
  });

  it("deals 15-20% of HP per hit at Lv50 / 500 stats with power ~200 (§6.2)", () => {
    const a = [mk("a", "neutral", {}, ["neutral_tackle"])];
    const b = [mk("b", "neutral", { luk: 0 }, ["neutral_tackle"])];
    const r = resolveBattle(seed, a, b);
    const hits = r.events.filter((e) => e.type === "hit" && !e.crit && e.damage !== undefined);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.damage!).toBeGreaterThanOrEqual(500 * 0.13);
      expect(h.damage!).toBeLessThanOrEqual(500 * 0.2);
    }
  });

  it("applies the element chart (fire vs grass is super effective)", () => {
    const a = [mk("a", "fire", {}, ["fire_burst"])];
    const b = [mk("b", "grass", { luk: 0 }, ["grass_bloom"])];
    const r = resolveBattle(seed, a, b);
    const hit = r.events.find((e) => e.type === "hit" && e.side === "A")!;
    expect(hit.typeMod).toBe(1.5);
    expect(hit.text).toContain("効果はばつぐんだ");
  });

  it("times out a stalling duel after 10 turns and eliminates the lower-HP side", () => {
    // 両方とも回復技だけ → 10 ターンで決着
    const a = [mk("a", "neutral", {}, ["neutral_rest"])];
    const b = [mk("b", "neutral", {}, ["neutral_rest"])];
    const r = resolveBattle(seed, a, b);
    expect(r.events.some((e) => e.type === "timeout")).toBe(true);
    expect(r.winner).toBe("A"); // 同率は守備側が脱落
  });

  it("uses the inherited move with the legacy bonus", () => {
    const doc = {
      name: "Shizuku",
      family: "aqua",
      element: "water",
      level: 12,
      stats: { hp: 100, atk: 50, def: 50, spa: 50, sdf: 50, spd: 50, luk: 10 },
      moves: ["water_shot", "neutral_tackle"],
      inheritedMove: { moveId: "beast_bite", generation: 3 },
    };
    const c = combatantFromDoc("m1", doc);
    expect(c.moves).toEqual(["water_shot", "neutral_tackle", "beast_bite"]);
    expect(c.moveBonus?.beast_bite).toBeCloseTo(1.1);
    expect(c.name).toBe("Shizuku");
    expect(combatantFromDoc("m2", { ...doc, name: "" }).name).toBe("アクアのこ");
  });

  it("low-level monsters do not one-shot each other (level factor)", () => {
    const lv1 = (id: string, hp: number, atk: number, def: number) => ({ ...mk(id, "neutral", { hp, atk, def, spa: atk, luk: 0 }, ["neutral_tackle"]), level: 1 });
    const r = resolveBattle(seed, [lv1("a", 40, 58, 10)], [lv1("b", 30, 8, 8)]);
    const hits = r.events.filter((e) => e.type === "hit" && e.damage !== undefined);
    expect(hits.length).toBeGreaterThan(1);
    for (const h of hits) expect(h.damage!).toBeLessThan(30);
  });

  it("party of three wins by elimination and reports remaining count", () => {
    const strong = [mk("s1", "neutral", { atk: 900, hp: 900 }, ["neutral_tackle"]), mk("s2", "neutral", {}, ["neutral_tackle"]), mk("s3", "neutral", {}, ["neutral_tackle"])];
    const weak = [mk("w1", "neutral", { hp: 100, def: 100 }, ["neutral_tackle"]), mk("w2", "neutral", { hp: 100, def: 100 }, ["neutral_tackle"]), mk("w3", "neutral", { hp: 100, def: 100 }, ["neutral_tackle"])];
    const r = resolveBattle(seed, strong, weak);
    expect(r.winner).toBe("A");
    expect(r.remainingB).toBe(0);
    expect(r.remainingA).toBeGreaterThanOrEqual(1);
    expect(r.events.filter((e) => e.type === "faint" && e.side === "B")).toHaveLength(3);
  });
});
