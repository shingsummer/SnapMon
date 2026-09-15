"""SnapMon 成長式・乱数の参照実装（Python）。

企画書 v1.3 §4.3〜§4.5, §5.3, §16.1 に対応。
functions/src/shared/growth.ts と app/lib/domain/growth.dart はこのファイルと
同一入力で同一出力になることをゴールデンテスト（fixtures/growth_golden.json）で保証する。

- 乱数の仕様と呼び出し順は shared-config/README.md を参照。
- 四捨五入は floor(x + 0.5)。Python の round() は銀行丸めなので使わない。
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
CFG_DIR = ROOT / "shared-config"

STATS = ["hp", "atk", "def", "spa", "spd", "luk"]
MASK = 0xFFFFFFFF


def load_json(name: str):
    return json.loads((CFG_DIR / name).read_text(encoding="utf-8"))


C = load_json("constants.json")
PERSONALITIES = load_json("personalities.json")
GROWTH_TYPES: list[str] = C["growthTypeOrder"]


def floor_half_up(x: float) -> int:
    return math.floor(x + 0.5)


# ---------------------------------------------------------------- RNG
class XorShift128:
    def __init__(self, seed_hex: str):
        if len(seed_hex) != 32:
            raise ValueError("seed_hex must be 32 hex chars")
        b = bytes.fromhex(seed_hex)
        self.x, self.y, self.z, self.w = (int.from_bytes(b[i : i + 4], "big") for i in (0, 4, 8, 12))
        if (self.x | self.y | self.z | self.w) == 0:
            self.x = 1

    def next_u32(self) -> int:
        t = (self.x ^ ((self.x << 11) & MASK)) & MASK
        self.x, self.y, self.z = self.y, self.z, self.w
        self.w = (self.w ^ (self.w >> 19) ^ (t ^ (t >> 8))) & MASK
        return self.w

    def next_double(self) -> float:
        return self.next_u32() / 4294967296.0

    def rand_int(self, lo: int, hi: int) -> int:
        return lo + math.floor(self.next_double() * (hi - lo + 1))

    def rand_range(self, lo: float, hi: float) -> float:
        return lo + self.next_double() * (hi - lo)


def seed_from_parts(label: str, color_hex: str, user_id: str, yyyymmdd: str, nonce: str) -> str:
    s = "|".join([label, color_hex, user_id, yyyymmdd, nonce])
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------- 成長曲線
def curve_raw(growth: str, level: int) -> float:
    L = level
    if growth == "early":
        return 2.0 - L / 50 * 1.5
    if growth == "avg":
        return 1.25
    if growth == "late":
        return 0.5 + L / 50 * 1.5
    if growth == "wave":
        return 1.25 + 0.75 * math.sin(L / 4)
    if growth == "superlate":
        return C["superlateCurveLow"] if L < C["superlateSwitchLevel"] else C["superlateCurveHigh"]
    raise ValueError(growth)


def build_curve_table() -> dict[str, list[float]]:
    """L=1..levelCap-1 の curve を小数6桁に丸めた表。TS/Dart はこの表を読む。"""
    return {g: [round(curve_raw(g, L), 6) for L in range(1, C["levelCap"])] for g in GROWTH_TYPES}


CURVES = build_curve_table()


def curve(growth: str, level: int) -> float:
    return CURVES[growth][level - 1]


# ---------------------------------------------------------------- 個体
def talent_from_raw(raw_base: int, raw_talent: int) -> int:
    v = raw_talent * 0.6 + (65 - raw_base) / 60 * 10 * 0.4
    return max(C["talentRange"][0], min(C["talentRange"][1], floor_half_up(v)))


def stat_cap(talent: int) -> int:
    return C["statCapBase"] + talent * C["statCapPerTalent"]


def roll_growth(bst0: int, u: float) -> str:
    weights = None
    for row in C["growthTypeWeights"]:
        if bst0 >= row["minBst0"]:
            weights = row["weights"]
            break
    assert weights is not None
    cum = 0.0
    for g, p in zip(GROWTH_TYPES, weights):
        cum += p
        if u < cum:
            return g
    return GROWTH_TYPES[-1]


def roll_individual(rng: XorShift128, mentor_talent: Optional[dict] = None, use_capsule: bool = False) -> dict:
    base, talent = {}, {}
    for s in STATS:
        rb = rng.rand_int(*C["baseStatRange"])
        rt = rng.rand_int(*C["talentRange"])
        base[s] = rb
        talent[s] = talent_from_raw(rb, rt)
    if mentor_talent is not None:
        rate = C["mentorInheritRateCapsule"] if use_capsule else C["mentorInheritRate"]
        for s in STATS:
            talent[s] = min(C["talentRange"][1], talent[s] + floor_half_up(mentor_talent[s] * rate))
    bst0 = sum(base.values())
    growth = roll_growth(bst0, rng.next_double())
    personality = rng.rand_int(0, len(PERSONALITIES) - 1)
    murmur_rate = rng.rand_range(*C["murmurRateRange"])
    j = C["murmurWindowJitterLevels"]
    murmur_offset = rng.rand_int(-j, j)
    return {
        "base": base,
        "talent": talent,
        "growth": growth,
        "personality": personality,
        "murmurRate": murmur_rate,
        "murmurWindowOffset": murmur_offset,
    }


# ---------------------------------------------------------------- 成長
def level_up(stats: dict, talent: dict, growth: str, level: int, personality: int, rng: XorShift128) -> dict:
    """level → level+1 のレベルアップ後ステータス。stats は現在値（float）。"""
    mods = PERSONALITIES[personality]["levelGainMod"]
    out = {}
    for s in STATS:
        r = rng.rand_range(*C["levelGainRandRange"])
        gain = (C["levelGainBase"] + C["levelGainPerTalent"] * talent[s]) * curve(growth, level) * mods[s] * r
        out[s] = min(stat_cap(talent[s]), stats[s] + gain)
    return out


def training_mod(personality: int, training_type: str) -> float:
    p = PERSONALITIES[personality]
    b = C["personalityTrainingBonus"]
    if p["likes"] == training_type:
        return 1.0 + b
    if p["dislikes"] == training_type:
        return 1.0 - b
    return 1.0


def train(stats: dict, talent: dict, personality: int, training_type: str, fatigue: int, rng: XorShift128):
    t = C["trainings"][training_type]
    main, sub = t["main"], t["sub"]
    main_gain = (rng.rand_range(*C["trainingGainRange"]) + C["trainingGainPerTalent"] * talent[main]) * training_mod(personality, training_type)
    out = dict(stats)
    out[main] = min(stat_cap(talent[main]), stats[main] + main_gain)
    if sub:
        out[sub] = min(stat_cap(talent[sub]), stats[sub] + main_gain * C["trainingSubRatio"])
    return out, fatigue + t["fatigue"]


def exp_to_next(level: int) -> int:
    return C["expBase"] + C["expPerLevel"] * level


def apply_exp(level: int, exp: int, gained: int):
    """返り値: (level, exp, levelUps)。levelCap 到達後は exp を 0 に固定。"""
    cap = C["levelCap"]
    level_ups = 0
    if level >= cap:
        return cap, 0, 0
    exp += gained
    while level < cap and exp >= exp_to_next(level):
        exp -= exp_to_next(level)
        level += 1
        level_ups += 1
    if level >= cap:
        exp = 0
    return level, exp, level_ups
