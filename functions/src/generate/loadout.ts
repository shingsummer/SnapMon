// 誕生時の技（2つ）とアイテム（1〜3個）の決定（企画書 §5.4, §6.3）。
// 乱数は個体生成後の同じ rng を続けて使う（サーバー専用ロジックなので Dart 側に複製しない）。
import * as fs from "node:fs";
import * as path from "node:path";
import { configDir } from "../shared/config";
import type { XorShift128 } from "../shared/rng";
import type { Element, Family } from "./classify";

export interface Move {
  id: string;
  name: string;
  family: Family | null;
  element: Element | null;
  category: "physical" | "special" | "support";
  power: number;
  effect: Record<string, number> | null;
}

interface MovesFile {
  moves: Move[];
}

let movesCache: Move[] | null = null;
export function loadMoves(): Move[] {
  if (!movesCache) {
    movesCache = (JSON.parse(fs.readFileSync(path.join(configDir(), "moves.json"), "utf-8")) as MovesFile).moves;
  }
  return movesCache;
}

/** ファミリー（＋サブファミリー）と属性のプールから重複なしで 2 技。足りなければ無属性から補う。 */
export function pickInitialMoves(rng: XorShift128, family: Family, subFamily: Family | null, element: Element): string[] {
  const all = loadMoves();
  const pool = all.filter(
    (m) => m.family === family || (subFamily !== null && m.family === subFamily) || (m.family === null && m.element === element),
  );
  const fallback = all.filter((m) => m.family === null && m.element === "neutral");
  const picked: string[] = [];
  const candidates = [...pool];
  while (picked.length < 2 && candidates.length > 0) {
    const i = rng.randInt(0, candidates.length - 1);
    picked.push(candidates[i].id);
    candidates.splice(i, 1);
  }
  for (const m of fallback) {
    if (picked.length >= 2) break;
    if (!picked.includes(m.id)) picked.push(m.id);
  }
  return picked;
}

export interface ItemGrant {
  type: string;
  count: number;
}

/** 被写体ファミリーの餌を 1〜3 個（§5.4）。 */
export function rollBirthItems(rng: XorShift128, family: Family): ItemGrant[] {
  const count = rng.randInt(1, 3);
  return [{ type: `food_${family}`, count }];
}
