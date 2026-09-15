// shared-config の読み込み。`npm run copy-config` で functions/shared-config/ にコピーされた
// JSON を読む（src/ からも lib/ からも同じ相対位置）。
import * as fs from "node:fs";
import * as path from "node:path";

export const STATS = ["hp", "atk", "def", "spa", "spd", "luk"] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;
export type StatsInt = Record<Stat, number>;

export type GrowthType = "early" | "avg" | "late" | "wave" | "superlate";
export type TrainingType = "dash" | "labor" | "meditate" | "endure";

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

let cache: { constants: Constants; personalities: Personality[]; curves: CurveTable } | null = null;

export function loadConfig() {
  if (!cache) {
    cache = {
      constants: readJson<Constants>("constants.json"),
      personalities: readJson<Personality[]>("personalities.json"),
      curves: readJson<CurveTable>("growth_curves.json"),
    };
  }
  return cache;
}

export function configDir(): string {
  return CONFIG_DIR;
}
