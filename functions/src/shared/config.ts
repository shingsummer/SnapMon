// shared-config の読み込み。`npm run copy-config` で functions/shared-config/ にコピーされた
// JSON を読む（src/ からも lib/ からも同じ相対位置）。
import * as fs from "node:fs";
import * as path from "node:path";

// 7 種（P6 で特防 sdf を追加）。並びは乱数の呼び出し順でもある（shared-config/README.md）
export const STATS = ["hp", "atk", "def", "spa", "sdf", "spd", "luk"] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;
export type StatsInt = Record<Stat, number>;

export type GrowthType = "early" | "avg" | "late" | "wave" | "superlate";
export type TrainingType = "dash" | "labor" | "meditate" | "endure" | "ukemi";

/** ファミリーごとのステータス傾向（families.json、ポケモンの種族値に相当） */
export interface FamilyTraits {
  baseBias: Stats;
  gainMod: Stats;
}

/**
 * Firestore などから読んだステータス／素質を 7 種そろえる。
 * 特防 sdf を持たない旧データ（P6 より前に生まれた個体）は防御 def の値で補う。それ以外の欠けは 0。
 */
export function fillStats(src: Record<string, unknown> | undefined | null): Stats {
  const out = {} as Stats;
  const s = src ?? {};
  for (const k of STATS) {
    const v = s[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (k === "sdf" && typeof s.def === "number") out[k] = s.def as number;
    else out[k] = 0;
  }
  return out;
}

export interface Constants {
  levelCap: number;
  statCapBase: number;
  statCapPerTalent: number;
  baseStatRange: [number, number];
  talentRange: [number, number];
  levelGainBase: number;
  levelGainPerTalent: number;
  levelGainRandRange: [number, number];
  trainingGainRange: [number, number];
  trainingGainPerTalent: number;
  trainingSubRatio: number;
  personalityTrainingBonus: number;
  fatigueMax: number;
  growthTypeOrder: GrowthType[];
  growthTypeWeights: { minBst0: number; weights: number[] }[];
  trainings: Record<TrainingType, { main: Stat; sub: Stat | null; fatigue: number }>;
  expBase: number;
  expPerLevel: number;
  mentorInheritRate: number;
  mentorInheritRateCapsule: number;
  murmurWindowJitterLevels: number;
  murmurRateRange: [number, number];
  [key: string]: unknown;
}

export interface Personality {
  id: number;
  name: string;
  likes: TrainingType;
  dislikes: TrainingType;
  levelGainMod: Stats;
}

export type CurveTable = Record<GrowthType, number[]>;

const CONFIG_DIR = path.resolve(__dirname, "..", "..", "shared-config");

function readJson<T>(name: string): T {
  const p = path.join(CONFIG_DIR, name);
  if (!fs.existsSync(p)) {
    throw new Error(`shared-config not found: ${p}. Run "npm run copy-config" first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

let cache: { constants: Constants; personalities: Personality[]; curves: CurveTable; families: Record<string, FamilyTraits> } | null = null;

export function loadConfig() {
  if (!cache) {
    const raw = readJson<Record<string, FamilyTraits | string>>("families.json");
    const families: Record<string, FamilyTraits> = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_") && typeof v === "object") families[k] = v;
    cache = {
      constants: readJson<Constants>("constants.json"),
      personalities: readJson<Personality[]>("personalities.json"),
      curves: readJson<CurveTable>("growth_curves.json"),
      families,
    };
  }
  return cache;
}

export function configDir(): string {
  return CONFIG_DIR;
}
