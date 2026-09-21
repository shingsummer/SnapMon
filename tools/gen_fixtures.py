"""ゴールデンテスト用フィクスチャと成長曲線表を生成する。

使い方:
  python tools/gen_fixtures.py          # 生成して書き込む
  python tools/gen_fixtures.py --check  # 生成結果が既存ファイルと一致するか検証（CI 用）

出力:
  shared-config/growth_curves.json
  shared-config/fixtures/growth_golden.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import growth_ref as G  # noqa: E402

CURVES_PATH = G.CFG_DIR / "growth_curves.json"
FIXTURE_PATH = G.CFG_DIR / "fixtures" / "growth_golden.json"


def seed(name: str) -> str:
    return G.seed_from_parts("fixture", "000000", name, "20260915", "nonce")


def build() -> dict:
    fx: dict = {"version": 1, "_doc": "python tools/gen_fixtures.py で生成。手で編集しない。"}

    # 1. seed 導出（sha256）
    fx["seeds"] = [
        {"label": "mug", "colorHex": "3a7bd5", "userId": "user-1", "date": "20260915", "nonce": "n1",
         "seedHex": G.seed_from_parts("mug", "3a7bd5", "user-1", "20260915", "n1")},
        {"label": "猫のぬいぐるみ", "colorHex": "ffffff", "userId": "u", "date": "20260101", "nonce": "",
         "seedHex": G.seed_from_parts("猫のぬいぐるみ", "ffffff", "u", "20260101", "")},
    ]

    # 2. RNG 生値
    fx["rng"] = []
    for name in ["rng-a", "rng-b", "rng-zero"]:
        sh = "0" * 32 if name == "rng-zero" else seed(name)
        r = G.XorShift128(sh)
        u32 = [r.next_u32() for _ in range(8)]
        r = G.XorShift128(sh)
        doubles = [r.next_double() for _ in range(4)]
        r = G.XorShift128(sh)
        ints = [{"lo": lo, "hi": hi, "value": r.rand_int(lo, hi)} for lo, hi in [(5, 60), (1, 10), (-4, 4), (0, 7), (0, 0)]]
        r = G.XorShift128(sh)
        ranges = [{"lo": lo, "hi": hi, "value": r.rand_range(lo, hi)} for lo, hi in [(0.8, 1.2), (2, 4), (0.5, 1.5)]]
        fx["rng"].append({"seedHex": sh, "u32": u32, "doubles": doubles, "randInt": ints, "randRange": ranges})

    # 3. 素質式（全組み合わせ）
    fx["talent"] = [
        {"rawBase": rb, "rawTalent": rt, "talent": G.talent_from_raw(rb, rt)}
        for rb in range(G.C["baseStatRange"][0], G.C["baseStatRange"][1] + 1)
        for rt in range(G.C["talentRange"][0], G.C["talentRange"][1] + 1)
    ]

    # 4. 成長タイプ抽選（境界値）
    fx["growthRoll"] = []
    for bst0 in [0, 149, 150, 249, 250, 360]:
        for u in [0.0, 0.049, 0.05, 0.2, 0.5, 0.85, 0.949, 0.95, 0.999]:
            fx["growthRoll"].append({"bst0": bst0, "u": u, "growth": G.roll_growth(bst0, u)})

    # 5. 個体生成（師匠なし／あり）
    fx["individuals"] = []
    fams = [None] * 6 + ["metal", "spark", "ghost", "food", "rock", "enigma"]
    for i in range(12):
        sh = seed(f"ind-{i}")
        fx["individuals"].append({"seedHex": sh, "mentorTalent": None, "useCapsule": False, "family": fams[i],
                                  "expected": G.roll_individual(G.XorShift128(sh), None, False, fams[i])})
    mentor = {"hp": 10, "atk": 7, "def": 3, "spa": 9, "sdf": 6, "spd": 5, "luk": 1}
    for i, cap in enumerate([False, True]):
        sh = seed(f"ind-mentor-{i}")
        fx["individuals"].append({"seedHex": sh, "mentorTalent": mentor, "useCapsule": cap, "family": "beast",
                                  "expected": G.roll_individual(G.XorShift128(sh), mentor, cap, "beast")})

    # 6. レベルアップ Lv1→50 の全履歴
    fx["levelUps"] = []
    lv_fams = [None, None, None, "plant", "paper", "toy"]
    for i in range(6):
        sh = seed(f"lv-{i}")
        r = G.XorShift128(sh)
        ind = G.roll_individual(r, None, False, lv_fams[i])
        stats = {s: float(v) for s, v in ind["base"].items()}
        hist = []
        for L in range(1, G.C["levelCap"]):
            stats = G.level_up(stats, ind["talent"], ind["growth"], L, ind["personality"], r, lv_fams[i])
            hist.append([stats[s] for s in G.STATS])
        fx["levelUps"].append({"seedHex": sh, "family": lv_fams[i], "individual": ind, "statsByLevel": hist})

    # 7. トレーニング
    fx["training"] = []
    for i, ttype in enumerate(["dash", "labor", "meditate", "endure", "dash", "meditate", "ukemi"]):
        sh = seed(f"tr-{i}")
        r = G.XorShift128(sh)
        ind = G.roll_individual(r)
        stats = {s: float(v) for s, v in ind["base"].items()}
        if i == 5:  # 上限張り付きケース
            stats = {s: float(G.stat_cap(ind["talent"][s])) for s in G.STATS}
        after, fatigue = G.train(stats, ind["talent"], ind["personality"], ttype, 30, r)
        fx["training"].append({"seedHex": sh, "individual": ind, "type": ttype, "fatigueBefore": 30,
                               "statsBefore": stats, "expected": {"stats": after, "fatigue": fatigue}})

    # 8. 経験値
    fx["exp"] = []
    for level, exp, gained in [(1, 0, 15), (1, 0, 24), (1, 23, 1), (10, 50, 200), (49, 0, 216), (49, 0, 999), (50, 0, 100), (25, 100, 5880)]:
        nl, ne, ups = G.apply_exp(level, exp, gained)
        fx["exp"].append({"level": level, "exp": exp, "gained": gained,
                          "expected": {"level": nl, "exp": ne, "levelUps": ups}})
    fx["expToNext"] = [{"level": L, "exp": G.exp_to_next(L)} for L in range(1, G.C["levelCap"])]
    fx["statCap"] = [{"talent": t, "cap": G.stat_cap(t)} for t in range(1, 11)]
    return fx


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    check = "--check" in sys.argv
    outputs = {CURVES_PATH: dumps(G.CURVES), FIXTURE_PATH: dumps(build())}
    if check:
        bad = [p for p, s in outputs.items() if not p.exists() or p.read_text(encoding="utf-8") != s]
        if bad:
            print("STALE:", *[str(p.relative_to(G.ROOT)) for p in bad])
            print("run: python tools/gen_fixtures.py")
            return 1
        print("fixtures up to date")
        return 0
    for p, s in outputs.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(s, encoding="utf-8")
        print("wrote", p.relative_to(G.ROOT), f"({len(s)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
