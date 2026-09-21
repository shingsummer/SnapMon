// バトルバランスの検算（企画書 §6.2「Lv50・500 同士で 1 発 15〜20%」ほか）。
// 実行: npm run sim:battle   （純ロジックのみ。Firestore 不要）
// 成長式で個体を作り（rollIndividual → levelUp）、resolveBattle を大量に回して統計を取る。
// 定数を変えたらこれを回し、企画書 §6.2 の表を更新すること。
import { it } from "vitest";
import type { Element, Family } from "../../src/generate/classify";
import { pickInitialMoves } from "../../src/generate/loadout";
import { levelUp, rollIndividual } from "../../src/shared/growth";
import { loadConfig, STATS, type Stats } from "../../src/shared/config";
import { XorShift128 } from "../../src/shared/rng";
import { loadMovesFile, moveById, resolveBattle, type BattleResult, type Combatant } from "../../src/battle/engine";

const FAMILIES: Family[] = ["beast", "plant", "metal", "aqua", "rock", "spark", "ghost", "food", "paper", "cloth", "toy", "enigma"];
const ELEMENTS: Element[] = ["fire", "water", "grass", "thunder", "light", "dark", "neutral"];

function hexSeed(rng: XorShift128): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += rng.randInt(0, 15).toString(16);
  return s;
}

interface Made {
  c: Combatant;
  talent: Record<string, number>;
  growth: string;
}

/** 成長式どおりに Lv `level` の個体を作る。moveSlots: 技の数（現状 2、Lv10/20 習得を入れると 4） */
function makeMonster(rng: XorShift128, level: number, moveSlots: number, name: string): Made {
  const family = FAMILIES[rng.randInt(0, FAMILIES.length - 1)];
  const element = ELEMENTS[rng.randInt(0, ELEMENTS.length - 1)];
  const ind = rollIndividual(new XorShift128(hexSeed(rng)), null, false, family);
  let stats = {} as Stats;
  for (const s of STATS) stats[s] = ind.base[s];
  for (let L = 1; L < level; L++) stats = levelUp(stats, ind.talent, ind.growth, L, ind.personality, new XorShift128(hexSeed(rng)), family);
  const moves = pickInitialMoves(new XorShift128(hexSeed(rng)), family, null, element);
  if (moveSlots > 2) {
    const pool = loadMovesFile().moves.filter((m) => (m.family === family || (m.family === null && m.element === element)) && !moves.includes(m.id));
    while (moves.length < moveSlots && pool.length > 0) moves.push(pool.splice(rng.randInt(0, pool.length - 1), 1)[0].id);
  }
  return { c: { id: name, name, family, element, level, stats, moves }, talent: ind.talent, growth: ind.growth };
}

interface Agg {
  n: number;
  winA: number;
  winB: number;
  draw: number;
  turns: number;
  duels: number;
  timeouts: number;
  hits: number;
  hitPct: number; // 1 撃の最大 HP 比の合計
  crits: number;
  misses: number;
  firstDuelWinsForA: number;
  moveUse: Map<string, number>;
  supportUse: number;
}

function newAgg(): Agg {
  return { n: 0, winA: 0, winB: 0, draw: 0, turns: 0, duels: 0, timeouts: 0, hits: 0, hitPct: 0, crits: 0, misses: 0, firstDuelWinsForA: 0, moveUse: new Map(), supportUse: 0 };
}

function record(a: Agg, r: BattleResult, A: Combatant[], B: Combatant[]): void {
  a.n++;
  if (r.winner === "A") a.winA++;
  else if (r.winner === "B") a.winB++;
  else a.draw++;
  a.turns += r.turnsTotal;
  let duels = 0;
  for (const e of r.events) {
    if (e.type === "switch" || (e.type === "start" && duels === 0)) duels++;
    if (e.type === "timeout") a.timeouts++;
    if (e.type === "hit" && e.damage !== undefined && e.moveId) {
      // 反動ダメージ（moveId 付きだが side 側自身）は除外: text で判別
      if (e.text.includes("反動")) continue;
      a.hits++;
      const targetMax = e.side === "A" ? e.maxB : e.maxA;
      a.hitPct += e.damage / Math.max(1, targetMax);
      if (e.crit) a.crits++;
    }
    if (e.type === "miss") a.misses++;
    if (e.type === "move" && e.moveId) {
      a.moveUse.set(e.moveId, (a.moveUse.get(e.moveId) ?? 0) + 1);
      if (moveById(e.moveId)?.category === "support") a.supportUse++;
    }
    if (e.type === "faint" && e.duel === 1 && e.side === "B") a.firstDuelWinsForA++;
  }
  a.duels += duels;
}

function fmt(a: Agg, label: string): string {
  const hp = a.hits ? ((a.hitPct / a.hits) * 100).toFixed(1) : "-";
  return (
    `${label.padEnd(34)} A勝 ${((a.winA / a.n) * 100).toFixed(1).padStart(5)}%  引分 ${((a.draw / a.n) * 100).toFixed(1).padStart(4)}%  ` +
    `ターン/対戦 ${(a.turns / a.duels).toFixed(1).padStart(4)}  タイムアウト ${((a.timeouts / a.duels) * 100).toFixed(0).padStart(3)}%  ` +
    `1撃 ${hp.padStart(5)}% HP  会心 ${((a.crits / Math.max(1, a.hits)) * 100).toFixed(0).padStart(3)}%  外れ ${((a.misses / Math.max(1, a.hits + a.misses)) * 100).toFixed(0)}%  サポート技 ${((a.supportUse / Math.max(1, [...a.moveUse.values()].reduce((x, y) => x + y, 0))) * 100).toFixed(0)}%`
  );
}

function party(rng: XorShift128, level: number, slots: number, tag: string): Combatant[] {
  return [0, 1, 2].map((i) => makeMonster(rng, level, slots, `${tag}${i}`).c);
}

function runMatch(rng: XorShift128, n: number, mkA: () => Combatant[], mkB: () => Combatant[]): Agg {
  const a = newAgg();
  for (let i = 0; i < n; i++) {
    const A = mkA();
    const B = mkB();
    record(a, resolveBattle(hexSeed(rng), A, B), A, B);
  }
  return a;
}

function statValue(N: number, s: string): number {
  const rng = new XorShift128("1234567890abcdef1234567890abcdef");
  const a = newAgg();
  for (let i = 0; i < N; i++) {
    const base = party(rng, 50, 4, "M");
    const A = base.map((c) => ({ ...c, id: "A" + c.id, stats: { ...c.stats, ...(s === "none" ? {} : { [s]: c.stats[s] + 100 }) } }));
    const B = base.map((c) => ({ ...c, id: "B" + c.id, stats: { ...c.stats } }));
    record(a, resolveBattle(hexSeed(rng), A, B), A, B);
  }
  return (a.winA / a.n) * 100;
}

function mirrorRows(N: number): void {
  for (const [lv, slots] of [
    [1, 2],
    [10, 4],
    [25, 4],
    [50, 4],
  ] as const) {
    const rng = new XorShift128("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    console.log(fmt(runMatch(rng, N, () => party(rng, lv, slots, "A"), () => party(rng, lv, slots, "B")), `  Lv${lv} vs Lv${lv}（技${slots}）`));
  }
}

const VARIANTS: { label: string; over: Record<string, number> }[] = [
  { label: "旧（P4 時点: lf=10, 会心 運/1000 ×1.5）", over: { battleLevelFactorBase: 10, battleCritDivisor: 1000, battleCritMultiplier: 1.5 } },
  { label: "現状（constants.json）", over: {} },
];

/** バフ持ち（攻撃 3 + 攻撃バフ 1）vs 攻撃 4。AI のバフ評価が効いているか */
function buffValue(N: number, buffScore: number, stageK: number): { win: number; support: number } {
  const C = loadConfig().constants as unknown as Record<string, unknown>;
  const prev = C.battleAiBuffScore;
  const prevK = C.battleStageMultiplier;
  C.battleAiBuffScore = buffScore;
  C.battleStageMultiplier = stageK;
  const rng = new XorShift128("5555666677778888999900001111aaaa");
  const a = newAgg();
  // 物理攻撃 3 + 攻撃バフ 1（バフと主力技の系統を揃える）
  const attacks = loadMovesFile().moves.filter((m) => m.category === "physical" && !m.effect?.selfDamageRatio);
  const buffs = loadMovesFile().moves.filter((m) => m.category === "support" && ((m.effect?.atkStages as number) ?? 0) > 0);
  for (let i = 0; i < N; i++) {
    const base = party(rng, 50, 4, "M");
    const pick = () => attacks[rng.randInt(0, attacks.length - 1)].id;
    const A = base.map((c) => ({ ...c, id: "A" + c.id, moves: [pick(), pick(), pick(), buffs[rng.randInt(0, buffs.length - 1)].id] }));
    const B = base.map((c) => ({ ...c, id: "B" + c.id, moves: [pick(), pick(), pick(), pick()] }));
    record(a, resolveBattle(hexSeed(rng), A, B), A, B);
  }
  C.battleAiBuffScore = prev;
  C.battleStageMultiplier = prevK;
  const total = [...a.moveUse.values()].reduce((x, y) => x + y, 0);
  return { win: (a.winA / a.n) * 100, support: (a.supportUse / Math.max(1, total)) * 100 };
}

it("battle balance report", () => {
  const C = loadConfig().constants as unknown as Record<string, unknown>;
  const original = { ...C };
  const N = 1200;
  for (const v of VARIANTS) {
    Object.assign(C, original, v.over);
    console.log(`
===== ${v.label}: scale=${C.battleDamageScale} lf=${C.battleLevelFactorBase} critDiv=${C.battleCritDivisor} critMul=${C.battleCritMultiplier} exp=${C.battleRatioExponent} buffAI=${C.battleAiBuffScore} =====`);
    mirrorRows(N);
    const vals = [...STATS, "none"].map((s) => `${s} ${statValue(600, s).toFixed(0)}%`);
    console.log(`  +100 の勝率: ${vals.join("  ")}`);
  }
  Object.assign(C, original);

  console.log("\n== バフ持ち vs 攻撃のみ（Lv50、AI のバフ評価を変えて） ==");
  for (const [b, k] of [
    [0.8, 0.5],
    [1.05, 0.5],
    [1.05, 0.3],
    [1.05, 0.25],
  ] as const) {
    const r = buffValue(600, b, k);
    console.log(`  buffScore ${b} 段階倍率 ${k}: バフ持ちの勝率 ${r.win.toFixed(1)}%  サポート技使用率 ${r.support.toFixed(0)}%`);
  }

  console.log("\n== レベル差（現状定数、A が高い方、技 4） ==");
  for (const [la, lb] of [
    [5, 1],
    [10, 5],
    [20, 10],
    [30, 20],
    [50, 40],
  ] as const) {
    const rng = new XorShift128("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    console.log(fmt(runMatch(rng, 600, () => party(rng, la, 4, "A"), () => party(rng, lb, 4, "B")), `  Lv${la} vs Lv${lb}`));
  }

  console.log("\n== 技の使用率（現状定数、Lv50・技 4、上位/下位 8） ==");
  {
    const rng = new XorShift128("abcdefabcdefabcdefabcdefabcdefab");
    const a = runMatch(rng, N, () => party(rng, 50, 4, "A"), () => party(rng, 50, 4, "B"));
    const total = [...a.moveUse.values()].reduce((x, y) => x + y, 0);
    const rows = [...a.moveUse.entries()].sort((x, y) => y[1] - x[1]);
    const show = (r: [string, number]) => `  ${r[0].padEnd(16)} ${moveById(r[0])!.category.padEnd(8)} pow ${String(moveById(r[0])!.power).padStart(3)}  ${((r[1] / total) * 100).toFixed(2)}%`;
    rows.slice(0, 8).forEach((r) => console.log(show(r)));
    console.log("  ...");
    rows.slice(-8).forEach((r) => console.log(show(r)));
    const never = loadMovesFile().moves.filter((m) => !a.moveUse.has(m.id)).map((m) => m.id);
    console.log(`  一度も使われなかった技 ${never.length}: ${never.join(", ")}`);
  }
});
