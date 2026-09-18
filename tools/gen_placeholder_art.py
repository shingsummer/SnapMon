"""プレースホルダ画像（企画書 §15.2: ファミリー×属性の SVG シルエット 84 種）を生成する。

使い方: python tools/gen_placeholder_art.py
出力:   app/assets/art/placeholder/{family}_{element}.svg

P3 でアートバケット（画像生成）に置き換わるまでの仮画像。属性で色、ファミリーで形が変わる。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app" / "assets" / "art" / "placeholder"

FAMILIES = ["beast", "plant", "metal", "aqua", "rock", "spark", "ghost", "food", "paper", "cloth", "toy", "enigma"]

# 属性 → (本体色, 縁色, 背景色)
ELEMENT_COLORS = {
    "fire": ("#ef6c3a", "#b3401c", "#fff1e8"),
    "water": ("#3f8fe0", "#245c9e", "#e8f1fb"),
    "grass": ("#4caf50", "#2e7d32", "#ecf7ec"),
    "thunder": ("#f2c230", "#b58a00", "#fdf7e3"),
    "light": ("#f5f0dc", "#bfb68c", "#fbfaf4"),
    "dark": ("#4b4160", "#25203a", "#ecebf0"),
    "neutral": ("#a1887f", "#6d4c41", "#f3efed"),
}

# ファミリー → 本体シルエットの SVG パス（256×256 座標系、中央寄せ）
BODY = {
    "beast": '<path d="M78 92 L60 40 L104 78 Q128 70 152 78 L196 40 L178 92 Q214 130 196 178 Q170 224 128 224 Q86 224 60 178 Q42 130 78 92 Z"/>',
    "plant": '<path d="M128 224 Q60 210 60 140 Q60 90 128 40 Q196 90 196 140 Q196 210 128 224 Z"/><path d="M128 224 L128 120" stroke="{edge}" stroke-width="10" fill="none"/>',
    "metal": '<rect x="56" y="56" width="144" height="144" rx="18"/><rect x="88" y="24" width="80" height="40" rx="8"/>',
    "aqua": '<path d="M128 28 Q200 120 200 160 Q200 226 128 226 Q56 226 56 160 Q56 120 128 28 Z"/>',
    "rock": '<path d="M48 200 L70 110 L120 60 L190 80 L214 150 L190 210 L80 214 Z"/>',
    "spark": '<path d="M150 20 L70 140 L124 140 L100 236 L190 110 L136 110 Z"/>',
    "ghost": '<path d="M64 224 L64 130 Q64 44 128 44 Q192 44 192 130 L192 224 L168 200 L148 224 L128 200 L108 224 L88 200 Z"/>',
    "food": '<circle cx="128" cy="140" r="84"/><rect x="118" y="36" width="20" height="40" rx="6"/>',
    "paper": '<path d="M72 40 L160 40 L200 80 L200 216 L72 216 Z"/><path d="M160 40 L160 80 L200 80" fill="{edge}"/>',
    "cloth": '<path d="M60 70 L100 40 L128 60 L156 40 L196 70 L180 110 L166 100 L166 220 L90 220 L90 100 L76 110 Z"/>',
    "toy": '<circle cx="128" cy="92" r="52"/><rect x="72" y="140" width="112" height="84" rx="20"/><circle cx="60" cy="160" r="22"/><circle cx="196" cy="160" r="22"/>',
    "enigma": '<path d="M128 32 Q210 32 210 110 Q210 160 150 176 L150 196 L106 196 L106 150 Q160 140 160 110 Q160 76 128 76 Q96 76 92 108 L48 108 Q52 32 128 32 Z"/><circle cx="128" cy="228" r="16"/>',
}

EYES = '<circle cx="104" cy="{ey}" r="9" fill="#1b1b1b"/><circle cx="152" cy="{ey}" r="9" fill="#1b1b1b"/>'
EYE_Y = {"beast": 120, "plant": 130, "metal": 120, "aqua": 150, "rock": 140, "spark": 130, "ghost": 120,
         "food": 130, "paper": 120, "cloth": 140, "toy": 92, "enigma": 110}


def svg(family: str, element: str) -> str:
    body, edge, bg = ELEMENT_COLORS[element]
    shape = BODY[family].replace("{edge}", edge)
    eyes = EYES.format(ey=EYE_Y[family])
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">\n'
        f'  <rect width="256" height="256" rx="32" fill="{bg}"/>\n'
        f'  <g fill="{body}" stroke="{edge}" stroke-width="6" stroke-linejoin="round">{shape}</g>\n'
        f"  {eyes}\n"
        "</svg>\n"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in FAMILIES:
        for e in ELEMENT_COLORS:
            (OUT / f"{f}_{e}.svg").write_text(svg(f, e), encoding="utf-8")
            n += 1
    print(f"wrote {n} svgs -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
