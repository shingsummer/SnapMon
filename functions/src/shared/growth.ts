// 成長式（企画書 v1.3 §4.3〜§4.5, §5.3）。サーバー側が正。
// tools/growth_ref.py と同一入力で同一出力になることを test/growth_golden.test.ts で保証する。
import { STATS, type GrowthType, type Stat, type Stats, type StatsInt, type TrainingType, loadConfig } from "./config";
import { XorShift128, floorHalfUp } from "./rng";

export interface Individual {
  base: StatsInt;
  talent: StatsInt; // 隠し値。クライアントに返してはならない
  growth: GrowthType; // 隠し値
  personality: number;
  murmurRate: number; // 隠し値
  murmurWindowOffset: number; // 隠し値
}

export function talentFromRaw(rawBase: number, rawTalent: number): number {
  const { constants: C } = loadConfig();
  const v = rawTalent * 0.6 + ((65 - rawBase) / 60) * 10 * 0.4;
  return Math.max(C.talentRange[0], Math.min(C.talentRange[1], floorHalfUp(v)));
}

export function statCap(talent: number): number {
  const { constants: C } = loadConfig();
  return C.statCapBase + talent * C.statCapPerTalent;
}

export function curve(growth: GrowthType, level: number): number {
  const { curves } = loadConfig();
  const v = curves[growth][level - 1];
  if (v === undefined) throw new Error(`curve out of range: ${growth} L${level}`);
  return v;
}

export function rollGrowth(bst0: number, u: number): GrowthType {
  const { constants: C } = loadConfig();
  let weights: number[] | undefined;
  for (const row of C.growthTypeWeights) {
    if (bst0 >= row.minBst0) {
      weights = row.weights;
      break;
    }
  }
  if (!weights) throw new Error("growthTypeWeights has no matching row");
  let cum = 0;
  for (let i = 0; i < C.growthTypeOrder.length; i++) {
    cum += weights[i];
    if (u < cum) return C.growthTypeOrder[i];
  }
  return C.growthTypeOrder[C.growthTypeOrder.length - 1];
}

export function rollIndividual(rng: XorShift128, mentorTalent: StatsInt | null = null, useCapsule = false): Individual {
  const { constants: C, personalities } = loadConfig();
  const base = {} as StatsInt;
  const talent = {} as StatsInt;
  for (const s of STATS) {
    const rb = rng.randInt(C.baseStatRange[0], C.baseStatRange[1]);
    const rt = rng.randInt(C.talentRange[0], C.talentRange[1]);
    base[s] = rb;
    talent[s] = talentFromRaw(rb, rt);
  }
  if (mentorTalent) {
    const rate = useCapsule ? C.mentorInheritRateCapsule : C.mentorInheritRate;
    for (const s of STATS) {
      talent[s] = Math.min(C.talentRange[1], talent[s] + floorHalfUp(mentorTalent[s] * rate));
    }
  }
  const bst0 = STATS.reduce((a, s) => a + base[s], 0);
  const growth = rollGrowth(bst0, rng.nextDouble());
  const personality = rng.randInt(0, personalities.length - 1);
  const murmurRate = rng.randRange(C.murmurRateRange[0], C.murmurRateRange[1]);
  const j = C.murmurWindowJitterLevels;
  const murmurWindowOffset = rng.randInt(-j, j);
  return { base, talent, growth, personality, murmurRate, murmurWindowOffset };
}

/** level → level+1 のレベルアップ後ステータス */
export function levelUp(stats: Stats, talent: StatsInt, growth: GrowthType, level: number, personality: number, rng: XorShift128): Stats {
  const { constants: C, personalities } = loadConfig();
  const mods = personalities[personality].levelGainMod;
  const out = {} as Stats;
  for (const s of STATS) {
    const r = rng.randRange(C.levelGainRandRange[0], C.levelGainRandRange[1]);
    const gain = (C.levelGainBase + C.levelGainPerTalent * talent[s]) * curve(growth, level) * mods[s] * r;
    out[s] = Math.min(statCap(talent[s]), stats[s] + gain);
  }
  return out;
}

export function trainingMod(personality: number, type: TrainingType): number {
  const { constants: C, personalities } = loadConfig();
  const p = personalities[personality];
  if (p.likes === type) return 1.0 + C.personalityTrainingBonus;
  if (p.dislikes === type) return 1.0 - C.personalityTrainingBonus;
  return 1.0;
}

export function train(
  stats: Stats,
  talent: StatsInt,
  personality: number,
  type: TrainingType,
  fatigue: number,
  rng: XorShift128,
): { stats: Stats; fatigue: number } {
  const { constants: C } = loadConfig();
  const t = C.trainings[type];
  const main: Stat = t.main;
  const mainGain = (rng.randRange(C.trainingGainRange[0], C.trainingGainRange[1]) + C.trainingGainPerTalent * talent[main]) * trainingMod(personality, type);
  const out = { ...stats };
  out[main] = Math.min(statCap(talent[main]), stats[main] + mainGain);
  if (t.sub) {
    out[t.sub] = Math.min(statCap(talent[t.sub]), stats[t.sub] + mainGain * C.trainingSubRatio);
  }
  return { stats: out, fatigue: fatigue + t.fatigue };
}

export function expToNext(level: number): number {
  const { constants: C } = loadConfig();
  return C.expBase + C.expPerLevel * level;
}

export function applyExp(level: number, exp: number, gained: number): { level: number; exp: number; levelUps: number } {
  const { constants: C } = loadConfig();
  const cap = C.levelCap;
  if (level >= cap) return { level: cap, exp: 0, levelUps: 0 };
  let levelUps = 0;
  exp += gained;
  while (level < cap && exp >= expToNext(level)) {
    exp -= expToNext(level);
    level += 1;
    levelUps += 1;
  }
  if (level >= cap) exp = 0;
  return { level, exp, levelUps };
}
