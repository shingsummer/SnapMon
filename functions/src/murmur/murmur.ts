// つぶやき抽選（企画書 v1.3 §4.6）。
// - トリガーごとに独立抽選。示唆つぶやきはウィンドウ内 8% / 外 1%（× 個体の murmurRate）
// - 全テキストが全成長タイプの重みを持つ（消去法を成立させない）
// - 抽選ログは保存しない。呼び出し側は textId だけをレスポンスに同梱する
// - 専用 API は無い。train / submitSteps / startBattle の副産物としてのみ返る
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { configDir, loadConfig, type GrowthType } from "../shared/config";
import { XorShift128 } from "../shared/rng";

interface MurmurFile {
  hints: { id: string; text: string; weights: number[] }[];
  plain: { id: string; text: string }[];
}

let cache: MurmurFile | null = null;
export function loadMurmurs(): MurmurFile {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(configDir(), "murmurs.json"), "utf-8")) as MurmurFile;
  return cache;
}

export interface MurmurSubject {
  growth: GrowthType;
  murmurRate: number;
  murmurWindowOffset: number;
  level: number;
}

/** その個体・レベルでの示唆つぶやき出現率（1 イベントあたり） */
export function hintRate(s: MurmurSubject): number {
  const { constants: C } = loadConfig();
  const inRate = C.murmurHintRateInWindow as number;
  const outRate = C.murmurHintRateOutOfWindow as number;
  const windows = C.murmurWindows as Record<string, [number, number]>;
  let base: number;
  if (s.growth === "wave") base = C.murmurWaveRate as number;
  else if (s.growth === "avg") base = outRate;
  else {
    const w = windows[s.growth];
    const lo = w[0] + s.murmurWindowOffset;
    const hi = w[1] + s.murmurWindowOffset;
    base = s.level >= lo && s.level <= hi ? inRate : outRate;
  }
  return Math.min(1, base * s.murmurRate);
}

export function freshRng(): XorShift128 {
  return new XorShift128(randomBytes(16).toString("hex"));
}

/**
 * events 回分の独立抽選をまとめて行い、最初に当たった示唆つぶやきを返す。
 * 示唆が出なければ、通常つぶやきを murmurPlainRate で 1 回だけ抽選。
 */
export function rollMurmur(s: MurmurSubject, events: number, rng: XorShift128 = freshRng()): string | null {
  const { constants: C } = loadConfig();
  const m = loadMurmurs();
  const order = C.growthTypeOrder;
  const gi = order.indexOf(s.growth);
  const rate = hintRate(s);
  for (let i = 0; i < events; i++) {
    if (rng.nextDouble() < rate) {
      return weightedPick(m.hints, (h) => h.weights[gi], rng);
    }
  }
  if (m.plain.length > 0 && rng.nextDouble() < (C.murmurPlainRate as number)) {
    return m.plain[rng.randInt(0, m.plain.length - 1)].id;
  }
  return null;
}

function weightedPick<T extends { id: string }>(items: T[], weightOf: (t: T) => number, rng: XorShift128): string {
  const total = items.reduce((a, t) => a + Math.max(0, weightOf(t)), 0);
  let u = rng.nextDouble() * total;
  for (const t of items) {
    u -= Math.max(0, weightOf(t));
    if (u < 0) return t.id;
  }
  return items[items.length - 1].id;
}

/** 起動時チェック用: 全示唆テキストが全タイプで正の重みを持つか */
export function validateMurmurs(): string[] {
  const { constants: C } = loadConfig();
  const m = loadMurmurs();
  const n = C.growthTypeOrder.length;
  const problems: string[] = [];
  for (const h of m.hints) {
    if (h.weights.length !== n) problems.push(`${h.id}: weights length ${h.weights.length} != ${n}`);
    if (h.weights.some((w) => !(w > 0))) problems.push(`${h.id}: all weights must be > 0`);
  }
  return problems;
}
