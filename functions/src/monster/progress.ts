// 経験値付与とレベルアップの適用（企画書 §4.4, §4.7）。純ロジック。
// レベルアップの乱数は「個体の seed + レベル」から決定論的に作る（再現可能、改ざん検証可能）。
import type { Element, Family } from "../generate/classify";
import { learnMovesOnLevelUp } from "../generate/loadout";
import { STATS, type GrowthType, type Stats, type StatsInt } from "../shared/config";
import { applyExp, levelUp } from "../shared/growth";
import { XorShift128, seedFromParts } from "../shared/rng";

export interface ProgressInput {
  seed: string; // monsters_private.seed
  level: number;
  exp: number;
  stats: Stats;
  talent: StatsInt;
  growth: GrowthType;
  personality: number;
  statHistory: { level: number; stats: Stats }[];
  /** ファミリー（families.json の gainMod を掛ける）。旧データで欠けていれば補正なし */
  family?: string | null;
}

export interface ProgressResult {
  level: number;
  exp: number;
  stats: Stats;
  statHistory: { level: number; stats: Stats }[];
  levelUps: number;
}

export function levelUpRng(seed: string, level: number): XorShift128 {
  return new XorShift128(seedFromParts(seed, "levelup", String(level), "", ""));
}

export function grantExp(m: ProgressInput, gained: number): ProgressResult {
  const r = applyExp(m.level, m.exp, gained);
  let stats = { ...m.stats };
  const history = [...m.statHistory];
  for (let L = m.level; L < r.level; L++) {
    stats = levelUp(stats, m.talent, m.growth, L, m.personality, levelUpRng(m.seed, L), m.family ?? null);
    history.push({ level: L + 1, stats: roundStats(stats) });
  }
  return { level: r.level, exp: r.exp, stats, statHistory: history, levelUps: r.levelUps };
}

/**
 * レベルアップで覚えた技の更新差分（§6.3）。monsters の公開ドキュメントと grantExp の前後レベルから、
 * 技が増えたときだけ `{ moves }` を返す（増えなければ空オブジェクト。tx.update にスプレッドして使う）。
 */
export function levelUpMovesUpdate(pub: Record<string, unknown>, seed: string, fromLevel: number, toLevel: number): { moves?: string[] } {
  if (toLevel <= fromLevel) return {};
  const before = (pub.moves as string[] | undefined) ?? [];
  const after = learnMovesOnLevelUp(seed, pub.family as Family, (pub.subFamily as Family | null | undefined) ?? null, pub.element as Element, before, fromLevel, toLevel);
  return after.length === before.length ? {} : { moves: after };
}

/** 表示用に丸める（保存は小数のまま。グラフは丸めた値） */
export function roundStats(s: Stats): Stats {
  const out = {} as Stats;
  for (const k of STATS) out[k] = Math.round(s[k]);
  return out;
}
