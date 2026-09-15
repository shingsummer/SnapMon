"""SnapMon 成長式の検算スクリプト（企画書 v1.3 §4.3〜§4.5 / §4.7 / §16.4 対応）。

使い方:  python tools/sim_growth.py
constants.json の値を変えたら必ずこれを回し、企画書の表を更新すること。
式の本体は growth_ref.py（参照実装）にあり、ここは統計を取るだけ。
"""
from __future__ import annotations

import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import growth_ref as G  # noqa: E402

C = G.C


def run(base: int, talent: int, growth: str, rnd: random.Random) -> list[float]:
    """1ステータス分を Lv1→50 まで（統計用なので Python の乱数でよい）。"""
    s, hist = float(base), []
    for L in range(1, C["levelCap"]):
        gain = (C["levelGainBase"] + C["levelGainPerTalent"] * talent) * G.curve(growth, L) * rnd.uniform(*C["levelGainRandRange"])
        s = min(G.stat_cap(talent), s + gain)
        hist.append(s)
    return hist


def main() -> None:
    rnd = random.Random(1)
    n_levels = C["levelCap"] - 1

    print(f"== curve sum Lv1->{n_levels} (target 61.25 +/- 2) ==")
    for g in G.GROWTH_TYPES:
        print(f"  {g:9s}: {sum(G.CURVES[g]):.2f}")

    print("\n== talent range by raw_base ==")
    for rb in (5, 20, 40, 60):
        ts = [G.talent_from_raw(rb, rt) for rt in range(1, 11)]
        print(f"  base {rb:2d}: talent {min(ts)}..{max(ts)}")
    N = 100_000
    bs, ts = [], []
    for _ in range(N):
        rb, rt = rnd.randint(*C["baseStatRange"]), rnd.randint(*C["talentRange"])
        bs.append(rb)
        ts.append(G.talent_from_raw(rb, rt))
    print(f"  corr(base, talent) = {st.correlation(bs, ts):.2f}")
    print("  talent dist % :", {k: round(ts.count(k) / N * 100, 1) for k in range(1, 11)})

    print("\n== Lv30 / Lv40 / Lv50 from level-ups only (mean of 2000 runs) ==")
    cases = [
        (60, 10, "early", "talent10 base60 early"),
        (10, 10, "superlate", "talent10 base10 superlate"),
        (30, 5, "late", "talent5  base30 late"),
        (40, 3, "avg", "talent3  base40 avg"),
        (5, 1, "avg", "talent1  base5  avg"),
    ]
    tr_lo, tr_hi = C["trainingGainRange"]
    for base, t, g, label in cases:
        runs = [run(base, t, g, rnd) for _ in range(2000)]
        lv30, lv40, lv50 = (st.mean(r[i] for r in runs) for i in (28, 38, 48))
        cap = G.stat_cap(t)
        gap = max(0.0, cap - lv50)
        per_training = (tr_lo + tr_hi) / 2 + C["trainingGainPerTalent"] * t
        print(f"  {label}: Lv30={lv30:4.0f} Lv40={lv40:4.0f} Lv50={lv50:4.0f} cap={cap} "
              f"({lv50 / cap * 100:.0f}%)  trainings to cap ~{gap / per_training:.0f}")

    total_exp = sum(G.exp_to_next(L) for L in range(1, C["levelCap"]))
    print(f"\n== exp Lv1->{C['levelCap']} total = {total_exp} ==")
    focus = C["trainingsPerDay"] * C["expPerTraining"] + 60 + 3 * C["expBattleWin"]
    for label, per_day in (("focus 1 monster (8 train + walk 60 + 3 battles)", focus),
                           ("2 monsters in parallel", focus / 2),
                           ("walk only (partner, 60/day)", 60)):
        print(f"  {label}: ~{total_exp / per_day:.0f} days")


if __name__ == "__main__":
    main()
