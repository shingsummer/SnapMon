// バトル解決（企画書 v1.3 §6.1〜§6.3）。純ロジック・決定論（同じ seed と入力なら同じログ）。
// - 1 対 1、ターン制、1 対戦（デュエル）最大 battleMaxTurnsPerDuel ターン、3 体パーティの勝ち抜き
// - 行動順: 優先度 → SPD → 同値は乱数
// - ダメージ: power × 攻/(攻+守) × 0.85 × レベル係数 × 属性 × 会心 × rand(0.9, 1.1)。物理は ATK/DEF、属性技（special）は SPA/相手 SPA（§6.2 の比率形、baseDamage 参照）
// - 両者オート（非同期対戦のため）。AI は期待ダメージ最大、HP 50% 未満で回復、初手でバフ
import * as fs from "node:fs";
import * as path from "node:path";
import type { Element, Family } from "../generate/classify";
import { STATS, configDir, loadConfig, type Stat, type Stats } from "../shared/config";
import { XorShift128 } from "../shared/rng";

export interface MoveDef {
  id: string;
  name: string;
  family: Family | null;
  element: Element | null;
  category: "physical" | "special" | "support";
  power: number;
  effect: Record<string, number | boolean> | null;
}

interface MovesFile {
  elementChart: Record<string, Record<string, number>>;
  moves: MoveDef[];
}

let movesCache: MovesFile | null = null;
export function loadMovesFile(): MovesFile {
  if (!movesCache) movesCache = JSON.parse(fs.readFileSync(path.join(configDir(), "moves.json"), "utf-8")) as MovesFile;
  return movesCache;
}

const FAMILY_JA: Record<string, string> = {
  beast: "ビースト", plant: "プラント", metal: "メタル", aqua: "アクア", rock: "ロック", spark: "スパーク",
  ghost: "ゴースト", food: "フード", paper: "ペーパー", cloth: "クロス", toy: "トイ", enigma: "エニグマ",
};

export function moveById(id: string): MoveDef | undefined {
  return loadMovesFile().moves.find((m) => m.id === id);
}

export interface Combatant {
  id: string;
  name: string;
  family: Family;
  element: Element;
  level: number;
  stats: Stats; // hp は最大 HP
  moves: string[]; // 4 技 + 師匠の型（最大 5）
  /** 師匠の型の伝承ボーナス（§5.5: 3 代で +10%）: moveId → 倍率 */
  moveBonus?: Record<string, number>;
}

export type Side = "A" | "B";

export interface BattleEvent {
  duel: number;
  turn: number;
  side?: Side;
  type: "start" | "switch" | "move" | "hit" | "miss" | "heal" | "stage" | "status" | "skip" | "faint" | "timeout" | "end";
  text: string;
  /** 行動後の HP（表示用） */
  hpA: number;
  hpB: number;
  maxA: number;
  maxB: number;
  moveId?: string;
  damage?: number;
  crit?: boolean;
  typeMod?: number;
}

export interface BattleResult {
  winner: Side | "draw";
  events: BattleEvent[];
  remainingA: number; // 生き残り数
  remainingB: number;
  turnsTotal: number;
}

type StageKey = "atk" | "def" | "spa" | "spd" | "luk" | "evasion" | "accuracy";

interface Fighter {
  side: Side;
  index: number;
  c: Combatant;
  hp: number;
  stages: Record<StageKey, number>;
  sleep: number; // 残りスキップターン
  paralyzed: boolean;
  lastHealTurn: number;
}

function newFighter(side: Side, index: number, c: Combatant): Fighter {
  return {
    side,
    index,
    c,
    hp: Math.max(1, Math.round(c.stats.hp)),
    stages: { atk: 0, def: 0, spa: 0, spd: 0, luk: 0, evasion: 0, accuracy: 0 },
    sleep: 0,
    paralyzed: false,
    lastHealTurn: -99,
  };
}

function stageMul(stage: number): number {
  const { constants: C } = loadConfig();
  const k = C.battleStageMultiplier as number;
  return 1 + k * stage;
}

function effStat(f: Fighter, s: Stat): number {
  const key = s as StageKey;
  const base = f.c.stats[s];
  return base * stageMul(f.stages[key] ?? 0);
}

function clampStage(v: number): number {
  const { constants: C } = loadConfig();
  const m = C.battleMaxStage as number;
  return Math.max(-m, Math.min(m, v));
}

function typeMultiplier(moveElement: Element | null, defender: Element): number {
  if (!moveElement) return 1;
  const chart = loadMovesFile().elementChart;
  return chart[moveElement]?.[defender] ?? 1;
}

/**
 * 基礎ダメージ（乱数・会心・属性なし）。
 * 企画書 §6.2 の「攻÷守」は Lv1 の初期値（5〜60）だと比率が 10 倍を超えて一撃で終わるため、
 * 攻÷(攻＋守) の比率形にレベル係数を掛ける。Lv50・500 同士（比率 0.5）で power 200 → 85 = HP の 17%（§6.2 の狙いどおり）。
 */
function baseDamage(user: Fighter, target: Fighter, m: MoveDef): number {
  const { constants: C } = loadConfig();
  const scale = C.battleDamageScale as number;
  const lf = C.battleLevelFactorBase as number;
  const atk = m.category === "physical" ? effStat(user, "atk") : effStat(user, "spa");
  const def = m.category === "physical" ? effStat(target, "def") : effStat(target, "spa");
  const ratio = atk / Math.max(1, atk + def);
  const levelFactor = (lf + user.c.level) / (lf + 50);
  const bonus = user.c.moveBonus?.[m.id] ?? 1;
  return m.power * ratio * scale * levelFactor * bonus;
}

/** 期待ダメージ（AI 用、乱数なし） */
function expectedDamage(user: Fighter, target: Fighter, m: MoveDef): number {
  if (m.category === "support" || m.power <= 0) return 0;
  const acc = (m.effect?.accuracy as number | undefined) ?? 1;
  return baseDamage(user, target, m) * typeMultiplier(m.element, target.c.element) * acc;
}

function chooseMove(user: Fighter, target: Fighter, turnInDuel: number, rng: XorShift128): MoveDef {
  const defs = user.c.moves.map(moveById).filter((m): m is MoveDef => !!m);
  if (defs.length === 0) return moveById("neutral_tackle")!;
  const maxHp = Math.max(1, Math.round(user.c.stats.hp));
  const scored = defs.map((m) => {
    let score = expectedDamage(user, target, m);
    const e = m.effect ?? {};
    if (m.category === "support") {
      if (typeof e.healRatio === "number" && user.hp < maxHp * 0.5 && turnInDuel - user.lastHealTurn > 1) score = (maxHp - user.hp) * 1.2;
      else if (turnInDuel === 1 && (e.atkStages || e.spaStages || e.defStages)) score = 60;
      else score = 10;
    } else if (typeof e.healRatio === "number" && user.hp < maxHp * 0.5) {
      score += maxHp * (e.healRatio as number);
    }
    return { m, score: score + rng.nextDouble() * 5 }; // 同点回避（決定論）
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].m;
}

export function resolveBattle(seed: string, partyA: Combatant[], partyB: Combatant[]): BattleResult {
  const { constants: C } = loadConfig();
  const rng = new XorShift128(seed);
  const maxTurns = C.battleMaxTurnsPerDuel as number;
  const critMul = C.battleCritMultiplier as number;
  const critDiv = C.battleCritDivisor as number;
  const [rlo, rhi] = C.battleDamageRandRange as [number, number];

  const A = partyA.map((c, i) => newFighter("A", i, c));
  const B = partyB.map((c, i) => newFighter("B", i, c));
  const events: BattleEvent[] = [];
  let ia = 0;
  let ib = 0;
  let duel = 0;
  let turnsTotal = 0;

  const snap = (type: BattleEvent["type"], text: string, extra: Partial<BattleEvent> = {}, turn = 0): void => {
    const a = A[Math.min(ia, A.length - 1)];
    const b = B[Math.min(ib, B.length - 1)];
    events.push({
      duel,
      turn,
      type,
      text,
      hpA: Math.max(0, a.hp),
      hpB: Math.max(0, b.hp),
      maxA: Math.max(1, Math.round(a.c.stats.hp)),
      maxB: Math.max(1, Math.round(b.c.stats.hp)),
      ...extra,
    });
  };

  snap("start", `${A[0].c.name} と ${B[0].c.name} のバトル！`);

  while (ia < A.length && ib < B.length) {
    duel++;
    const a = A[ia];
    const b = B[ib];
    if (duel > 1) snap("switch", `${a.c.name} と ${b.c.name} が向かい合った`);
    let turn = 0;
    while (a.hp > 0 && b.hp > 0 && turn < maxTurns) {
      turn++;
      turnsTotal++;
      const ma = chooseMove(a, b, turn, rng);
      const mb = chooseMove(b, a, turn, rng);
      const pa = (ma.effect?.priority as number | undefined) ?? 0;
      const pb = (mb.effect?.priority as number | undefined) ?? 0;
      let first: [Fighter, Fighter, MoveDef];
      let second: [Fighter, Fighter, MoveDef];
      const aFirst = pa !== pb ? pa > pb : effStat(a, "spd") !== effStat(b, "spd") ? effStat(a, "spd") > effStat(b, "spd") : rng.nextDouble() < 0.5;
      if (aFirst) {
        first = [a, b, ma];
        second = [b, a, mb];
      } else {
        first = [b, a, mb];
        second = [a, b, ma];
      }
      for (const [user, target, m] of [first, second]) {
        if (user.hp <= 0 || target.hp <= 0) break;
        act(user, target, m, turn);
      }
    }
    if (a.hp > 0 && b.hp > 0) {
      // タイムアウト: HP 割合が低い方が脱落。同率は守備側（B）が脱落（攻撃側の有利）
      const ra = a.hp / Math.max(1, Math.round(a.c.stats.hp));
      const rb = b.hp / Math.max(1, Math.round(b.c.stats.hp));
      const loser = ra < rb ? a : b;
      loser.hp = 0;
      snap("timeout", `${maxTurns} ターン経過。${loser.c.name} は力尽きた`, {}, turn);
    }
    if (a.hp <= 0) {
      snap("faint", `${a.c.name} は倒れた`, { side: "A" }, turn);
      ia++;
    }
    if (b.hp <= 0) {
      snap("faint", `${b.c.name} は倒れた`, { side: "B" }, turn);
      ib++;
    }
  }

  const remainingA = A.filter((f) => f.hp > 0).length;
  const remainingB = B.filter((f) => f.hp > 0).length;
  const winner: Side | "draw" = remainingA > 0 && remainingB === 0 ? "A" : remainingB > 0 && remainingA === 0 ? "B" : "draw";
  snap("end", winner === "A" ? `${partyA[0].name} 側の勝ち！` : winner === "B" ? `${partyB[0].name} 側の勝ち！` : "引き分け");
  return { winner, events, remainingA, remainingB, turnsTotal };

  function act(user: Fighter, target: Fighter, m: MoveDef, turn: number): void {
    if (user.sleep > 0) {
      user.sleep--;
      snap("skip", `${user.c.name} は眠っている`, { side: user.side }, turn);
      return;
    }
    if (user.paralyzed && rng.nextDouble() < 0.25) {
      snap("skip", `${user.c.name} は体がしびれて動けない`, { side: user.side }, turn);
      return;
    }
    const e = m.effect ?? {};
    snap("move", `${user.c.name} の ${m.name}！`, { side: user.side, moveId: m.id }, turn);

    if (m.category === "support") {
      applySupport(user, target, m, turn);
      return;
    }
    // 命中
    const acc = ((e.accuracy as number | undefined) ?? 1) * stageMul(user.stages.accuracy) / stageMul(target.stages.evasion);
    if (rng.nextDouble() >= acc) {
      snap("miss", `${target.c.name} には当たらなかった`, { side: user.side }, turn);
      return;
    }
    const typeMod = typeMultiplier(m.element, target.c.element);
    const critChance = effStat(user, "luk") / critDiv + ((e.critBonus as number | undefined) ?? 0);
    const crit = rng.nextDouble() < critChance;
    const r = rng.randRange(rlo, rhi);
    let dmg = Math.floor(baseDamage(user, target, m) * typeMod * (crit ? critMul : 1) * r);
    dmg = Math.max(1, dmg);
    target.hp = Math.max(0, target.hp - dmg);
    const eff = typeMod > 1 ? "効果はばつぐんだ！ " : typeMod < 1 ? "効果はいまひとつ… " : "";
    snap("hit", `${eff}${crit ? "急所に当たった！ " : ""}${target.c.name} に ${dmg} のダメージ`, { side: user.side, damage: dmg, crit, typeMod, moveId: m.id }, turn);

    if (typeof e.drainRatio === "number" && dmg > 0) {
      const heal = Math.floor(dmg * e.drainRatio);
      user.hp = Math.min(Math.round(user.c.stats.hp), user.hp + heal);
      snap("heal", `${user.c.name} は ${heal} 回復した`, { side: user.side }, turn);
    }
    if (typeof e.healRatio === "number") {
      const heal = Math.floor(Math.round(user.c.stats.hp) * e.healRatio);
      user.hp = Math.min(Math.round(user.c.stats.hp), user.hp + heal);
      snap("heal", `${user.c.name} は ${heal} 回復した`, { side: user.side }, turn);
    }
    if (typeof e.selfDamageRatio === "number" && dmg > 0) {
      const self = Math.max(1, Math.floor(dmg * e.selfDamageRatio));
      user.hp = Math.max(0, user.hp - self);
      snap("hit", `${user.c.name} は反動で ${self} のダメージ`, { side: user.side, damage: self }, turn);
    }
    applyStages(user, target, e, turn);
    if (typeof e.sleepChance === "number" && target.hp > 0 && rng.nextDouble() < e.sleepChance) {
      target.sleep = 1;
      snap("status", `${target.c.name} は眠ってしまった`, { side: user.side }, turn);
    }
    if (typeof e.paralyzeChance === "number" && target.hp > 0 && !target.paralyzed && rng.nextDouble() < e.paralyzeChance) {
      target.paralyzed = true;
      snap("status", `${target.c.name} は体がしびれた`, { side: user.side }, turn);
    }
  }

  function applySupport(user: Fighter, target: Fighter, m: MoveDef, turn: number): void {
    const e = m.effect ?? {};
    if (typeof e.healRatio === "number") {
      const max = Math.round(user.c.stats.hp);
      const heal = Math.min(max - user.hp, Math.floor(max * e.healRatio));
      user.hp += heal;
      user.lastHealTurn = turn;
      snap("heal", `${user.c.name} は ${heal} 回復した`, { side: user.side }, turn);
    }
    applyStages(user, target, e, turn);
  }

  function applyStages(user: Fighter, target: Fighter, e: Record<string, number | boolean>, turn: number): void {
    const selfKeys: Record<string, StageKey> = { atkStages: "atk", defStages: "def", spaStages: "spa", spdStages: "spd", luckStages: "luk", evasionStages: "evasion" };
    const targetKeys: Record<string, StageKey> = { atkStagesTarget: "atk", defStagesTarget: "def", spdStagesTarget: "spd", accuracyStagesTarget: "accuracy" };
    const label: Record<StageKey, string> = { atk: "攻撃", def: "防御", spa: "特攻", spd: "速さ", luk: "運", evasion: "回避", accuracy: "命中" };
    for (const [k, stat] of Object.entries(selfKeys)) {
      const v = e[k];
      if (typeof v !== "number" || v === 0) continue;
      const before = user.stages[stat];
      user.stages[stat] = clampStage(before + v);
      if (user.stages[stat] !== before) snap("stage", `${user.c.name} の${label[stat]}が${v > 0 ? "上がった" : "下がった"}`, { side: user.side }, turn);
    }
    for (const [k, stat] of Object.entries(targetKeys)) {
      const v = e[k];
      if (typeof v !== "number" || v === 0 || target.hp <= 0) continue;
      const before = target.stages[stat];
      target.stages[stat] = clampStage(before + v);
      if (target.stages[stat] !== before) snap("stage", `${target.c.name} の${label[stat]}が${v > 0 ? "上がった" : "下がった"}`, { side: user.side }, turn);
    }
  }
}

/** Firestore の monster ドキュメントから Combatant を作る（公開部分のみ） */
export function combatantFromDoc(id: string, d: Record<string, unknown>): Combatant {
  const stats = {} as Stats;
  const src = (d.stats as Record<string, number>) ?? {};
  for (const s of STATS) stats[s] = Number(src[s] ?? 1);
  const moves = [...(((d.moves as string[]) ?? []).slice(0, 4))];
  const inherited = d.inheritedMove as { moveId: string; generation: number } | null | undefined;
  const moveBonus: Record<string, number> = {};
  if (inherited?.moveId) {
    moves.push(inherited.moveId);
    const { constants: C } = loadConfig();
    if (inherited.generation >= (C.legacyMoveGenerations as number)) moveBonus[inherited.moveId] = 1 + (C.legacyMovePowerBonus as number);
  }
  const name = ((d.name as string) || "") !== "" ? (d.name as string) : `${FAMILY_JA[d.family as string] ?? (d.family as string)}のこ`;
  return { id, name, family: d.family as Family, element: d.element as Element, level: (d.level as number) ?? 1, stats, moves, moveBonus };
}
