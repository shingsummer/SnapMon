// レベルアップでの技習得（企画書 §6.3: Lv10/20/30/40、空き枠がある間だけ自動習得）。
import { describe, expect, it } from "vitest";
import { learnMovesOnLevelUp, loadMoves } from "../src/generate/loadout";
import { levelUpMovesUpdate } from "../src/monster/progress";

const SEED = "0123456789abcdef0123456789abcdef";

describe("learnMovesOnLevelUp", () => {
  it("Lv10 を跨ぐと 1 技、Lv20 で 2 技目。決定論で同じ結果", () => {
    const a = learnMovesOnLevelUp(SEED, "aqua", null, "water", ["aqua_ripple", "water_stream"], 1, 10);
    expect(a).toHaveLength(3);
    const b = learnMovesOnLevelUp(SEED, "aqua", null, "water", ["aqua_ripple", "water_stream"], 1, 10);
    expect(b).toEqual(a);
    const c = learnMovesOnLevelUp(SEED, "aqua", null, "water", a, 10, 20);
    expect(c).toHaveLength(4);
    expect(new Set(c).size).toBe(4); // 重複なし
  });

  it("習得はファミリー・サブファミリー・属性のプールから", () => {
    const out = learnMovesOnLevelUp(SEED, "beast", "toy", "fire", [], 1, 40);
    expect(out).toHaveLength(4);
    const byId = new Map(loadMoves().map((m) => [m.id, m]));
    for (const id of out) {
      const m = byId.get(id)!;
      expect(m.family === "beast" || m.family === "toy" || (m.family === null && m.element === "fire")).toBe(true);
    }
  });

  it("枠が埋まっていれば見送り。レベルが習得点を跨がなければ変化なし", () => {
    const full = ["aqua_ripple", "water_stream", "aqua_mist", "water_veil"];
    expect(learnMovesOnLevelUp(SEED, "aqua", null, "water", full, 20, 40)).toEqual(full);
    expect(learnMovesOnLevelUp(SEED, "aqua", null, "water", ["aqua_ripple"], 3, 9)).toEqual(["aqua_ripple"]);
    expect(learnMovesOnLevelUp(SEED, "aqua", null, "water", ["aqua_ripple"], 10, 10)).toEqual(["aqua_ripple"]);
  });

  it("levelUpMovesUpdate は技が増えたときだけ moves を返す", () => {
    const pub = { family: "aqua", subFamily: null, element: "water", moves: ["aqua_ripple", "water_stream"] };
    expect(levelUpMovesUpdate(pub, SEED, 5, 5)).toEqual({});
    expect(levelUpMovesUpdate(pub, SEED, 5, 9)).toEqual({});
    const up = levelUpMovesUpdate(pub, SEED, 9, 12);
    expect(up.moves).toHaveLength(3);
    expect(up.moves!.slice(0, 2)).toEqual(["aqua_ripple", "water_stream"]);
  });
});
