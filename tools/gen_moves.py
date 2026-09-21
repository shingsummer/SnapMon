"""技テーブル shared-config/moves.json を生成する（企画書 v1.3 §6.2, §6.3）。

- ファミリー技 6 × 12 = 72、属性技 4 × 7 = 28、合計 100
- power は §6.2 の尺度（Lv50・平均 500 同士で 1 発 15〜20%）: 通常 190〜210、強技 240〜260（反動や命中低下つき）、弱技 150 前後（追加効果つき）
- 日本語名は仮（§15.5 未決）。βで差し替える前提
使い方: python tools/gen_moves.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "shared-config" / "moves.json"

# (id, 名前, category, power, effect)
# category: physical(ATK/DEF) / special(SPA/SDF) / support
FAMILY_MOVES = {
    "beast": [
        ("beast_bite", "かみつき", "physical", 200, None),
        ("beast_rush", "とっしん", "physical", 250, {"selfDamageRatio": 0.1}),
        ("beast_claw", "ひっかき", "physical", 160, {"critBonus": 0.15}),
        ("beast_howl", "とおぼえ", "support", 0, {"atkStages": 1}),
        ("beast_pounce", "とびかかり", "physical", 190, {"priority": 1}),
        ("beast_fang", "するどいキバ", "physical", 230, {"accuracy": 0.85}),
    ],
    "plant": [
        ("plant_leaf", "はっぱカッター", "physical", 190, {"critBonus": 0.1}),
        ("plant_heal", "こうごうせい", "support", 0, {"healRatio": 0.25}),
        ("plant_vine", "つるでしばる", "physical", 170, {"spdStagesTarget": -1}),
        ("plant_seed", "たねばくだん", "special", 210, None),
        ("plant_root", "ねをはる", "support", 0, {"defStages": 1, "sdfStages": 1}),
        ("plant_spore", "ねむりこな", "special", 150, {"sleepChance": 0.3}),
    ],
    "metal": [
        ("metal_guard", "てっぺき", "support", 0, {"defStages": 1}),
        ("metal_slam", "アイアンボディ", "physical", 220, None),
        ("metal_drill", "ドリル", "physical", 240, {"accuracy": 0.85}),
        ("metal_sharpen", "とぎすます", "support", 0, {"atkStages": 1}),
        ("metal_gear", "ギアクラッシュ", "physical", 190, {"defStagesTarget": -1}),
        ("metal_reflect", "はねかえし", "special", 180, None),
    ],
    "aqua": [
        ("aqua_splash", "みずかけ", "special", 190, None),
        ("aqua_bubble", "あわ", "special", 160, {"spdStagesTarget": -1}),
        ("aqua_wave", "なみのり", "special", 220, None),
        ("aqua_mist", "きり", "support", 0, {"evasionStages": 1}),
        ("aqua_ripple", "はもん", "special", 200, {"critBonus": 0.1}),
        ("aqua_soak", "びしょぬれ", "physical", 170, {"atkStagesTarget": -1}),
    ],
    "rock": [
        ("rock_throw", "いしつぶて", "physical", 190, None),
        ("rock_harden", "かたくなる", "support", 0, {"defStages": 1}),
        ("rock_slide", "がんせきなだれ", "physical", 240, {"accuracy": 0.85}),
        ("rock_press", "おしつぶす", "physical", 210, None),
        ("rock_moss", "コケむす", "support", 0, {"healRatio": 0.2}),
        ("rock_quake", "じひびき", "physical", 200, {"spdStagesTarget": -1}),
    ],
    "spark": [
        ("spark_zap", "でんげき", "special", 200, None),
        ("spark_dash", "かみなりダッシュ", "physical", 180, {"priority": 1}),
        ("spark_charge", "じゅうでん", "support", 0, {"spaStages": 1}),
        ("spark_overload", "オーバーロード", "special", 250, {"selfDamageRatio": 0.1}),
        ("spark_static", "せいでんき", "special", 150, {"paralyzeChance": 0.3}),
        ("spark_flash", "フラッシュ", "special", 170, {"accuracyStagesTarget": -1}),
    ],
    "ghost": [
        ("ghost_touch", "ひやりタッチ", "special", 190, None),
        ("ghost_fade", "きえる", "support", 0, {"evasionStages": 1}),
        ("ghost_curse", "のろい", "special", 160, {"sdfStagesTarget": -1}),
        ("ghost_wail", "うらめしや", "special", 220, None),
        ("ghost_drain", "たましいすい", "special", 180, {"drainRatio": 0.5}),
        ("ghost_shadow", "かげうち", "physical", 180, {"priority": 1}),
    ],
    "food": [
        ("food_toss", "なげつける", "physical", 190, None),
        ("food_snack", "おやつ", "support", 0, {"healRatio": 0.3}),
        ("food_spicy", "げきから", "special", 210, None),
        ("food_sticky", "ベタベタ", "physical", 160, {"spdStagesTarget": -1}),
        ("food_feast", "たべほうだい", "support", 0, {"atkStages": 1, "defStages": 1, "spdStages": -1}),
        ("food_crumb", "パンくず", "physical", 150, {"luckStages": 1}),
    ],
    "paper": [
        ("paper_cut", "かみで切る", "physical", 200, {"critBonus": 0.15}),
        ("paper_fold", "おりたたむ", "support", 0, {"evasionStages": 1}),
        ("paper_plane", "かみひこうき", "physical", 180, {"priority": 1}),
        ("paper_scroll", "まきもの", "special", 200, None),
        ("paper_confuse", "ややこしい", "special", 150, {"accuracyStagesTarget": -1}),
        ("paper_origami", "おりがみへんげ", "support", 0, {"spaStages": 1}),
    ],
    "cloth": [
        ("cloth_whip", "ぬのムチ", "physical", 190, None),
        ("cloth_wrap", "くるむ", "physical", 160, {"spdStagesTarget": -1}),
        ("cloth_patch", "つぎはぎ", "support", 0, {"healRatio": 0.25}),
        ("cloth_flap", "はためく", "special", 180, {"priority": 1}),
        ("cloth_thread", "いとでしばる", "physical", 170, {"atkStagesTarget": -1}),
        ("cloth_sew", "ぬいあわせ", "support", 0, {"defStages": 1}),
    ],
    "toy": [
        ("toy_bounce", "はねる", "physical", 190, None),
        ("toy_spin", "コマまわし", "physical", 210, None),
        ("toy_squeak", "ピーピー", "special", 150, {"accuracyStagesTarget": -1}),
        ("toy_lucky", "ラッキー", "support", 0, {"luckStages": 2}),
        ("toy_windup", "ぜんまい", "support", 0, {"spdStages": 1}),
        ("toy_surprise", "びっくりばこ", "special", 240, {"accuracy": 0.8}),
    ],
    "enigma": [
        ("enigma_question", "はてな", "special", 200, None),
        ("enigma_mystery", "なぞのちから", "special", 230, {"accuracy": 0.9}),
        ("enigma_shift", "いれかわり", "support", 0, {"spaStages": 1, "atkStages": 1, "defStages": -1, "sdfStages": -1}),
        ("enigma_glitch", "バグる", "physical", 180, {"randomStat": True}),
        ("enigma_blank", "むひょうじょう", "support", 0, {"evasionStages": 1}),
        ("enigma_answer", "こたえ", "physical", 210, {"critBonus": 0.1}),
    ],
}

ELEMENT_MOVES = {
    "fire": [
        ("fire_ember", "ひのこ", "special", 190, None),
        ("fire_burst", "ほのお", "special", 210, None),
        ("fire_blaze", "だいもえ", "special", 250, {"selfDamageRatio": 0.1}),
        ("fire_warm", "あたためる", "support", 0, {"atkStages": 1}),
    ],
    "water": [
        ("water_shot", "みずでっぽう", "special", 190, None),
        ("water_stream", "げきりゅう", "special", 220, None),
        ("water_veil", "みずのまく", "support", 0, {"sdfStages": 1}),
        ("water_drizzle", "こさめ", "special", 160, {"healRatio": 0.1}),
    ],
    "grass": [
        ("grass_whip", "つるのムチ", "physical", 190, None),
        ("grass_bloom", "かいか", "support", 0, {"healRatio": 0.25}),
        ("grass_thorn", "とげ", "physical", 200, {"critBonus": 0.1}),
        ("grass_pollen", "かふん", "special", 150, {"sleepChance": 0.25}),
    ],
    "thunder": [
        ("thunder_spark", "スパーク", "special", 190, None),
        ("thunder_bolt", "いなずま", "special", 230, {"accuracy": 0.9}),
        ("thunder_quick", "でんこうせっか", "physical", 170, {"priority": 1}),
        ("thunder_numb", "しびれ", "special", 150, {"paralyzeChance": 0.3}),
    ],
    "light": [
        ("light_ray", "ひかり", "special", 200, None),
        ("light_shine", "かがやき", "support", 0, {"spaStages": 1}),
        ("light_purify", "きよめ", "support", 0, {"healRatio": 0.25}),
        ("light_beam", "ひかりのやいば", "special", 240, {"accuracy": 0.85}),
    ],
    "dark": [
        ("dark_veil", "やみ", "special", 200, None),
        ("dark_bite", "やみのキバ", "physical", 210, None),
        ("dark_sap", "せいきすい", "special", 170, {"drainRatio": 0.5}),
        ("dark_fear", "おびえさせる", "special", 150, {"atkStagesTarget": -1}),
    ],
    "neutral": [
        ("neutral_tackle", "たいあたり", "physical", 190, None),
        ("neutral_focus", "きあい", "support", 0, {"atkStages": 1}),
        ("neutral_rest", "ひとやすみ", "support", 0, {"healRatio": 0.3}),
        ("neutral_body", "ぜんりょくタックル", "physical", 240, {"selfDamageRatio": 0.1}),
    ],
}


def main() -> None:
    moves = []
    for fam, ms in FAMILY_MOVES.items():
        for mid, name, cat, power, eff in ms:
            moves.append({"id": mid, "name": name, "family": fam, "element": None, "category": cat, "power": power, "effect": eff})
    for el, ms in ELEMENT_MOVES.items():
        for mid, name, cat, power, eff in ms:
            moves.append({"id": mid, "name": name, "family": None, "element": el, "category": cat, "power": power, "effect": eff})
    ids = [m["id"] for m in moves]
    assert len(ids) == len(set(ids)) == 100, len(ids)
    doc = {
        "_doc": "tools/gen_moves.py で生成。power は企画書 §6.2 の尺度（190〜250）。日本語名は仮（§15.5）。effect のキー: selfDamageRatio, critBonus, accuracy, priority, healRatio, drainRatio, {atk,def,spa,spd,luck,evasion}Stages（自分）, {atk,def,spd,accuracy}StagesTarget（相手）, sleepChance, paralyzeChance, randomStat",
        "categories": ["physical", "special", "support"],
        "elementChart": {
            "_doc": "攻撃属性 → 防御属性: 倍率。3すくみ（火>草>水>火）＋光闇相互有利。未記載は 1.0",
            "fire": {"grass": 1.5, "water": 0.67},
            "grass": {"water": 1.5, "fire": 0.67},
            "water": {"fire": 1.5, "grass": 0.67},
            "light": {"dark": 1.5},
            "dark": {"light": 1.5},
        },
        "moves": moves,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(moves)} moves -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
