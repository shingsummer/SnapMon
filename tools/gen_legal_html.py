"""docs/legal/*.md から公開用 HTML（hosting/public/）を生成する。

ストア審査（Google Play / App Store、Health Connect の用途申告）にはプライバシーポリシーの公開 URL が要る。
Firebase Hosting で https://snap-mon-7a9bf.web.app/privacy.html などとして配信する。

使い方: python tools/gen_legal_html.py
        firebase deploy --only hosting --project snap-mon-7a9bf   （公開は しぴさん の確認後）

外部ライブラリなし。対応する Markdown: 見出し（#〜###）、段落、箇条書き（-、数字.）、表、太字（**）。
"""
from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "legal"
OUT = ROOT / "hosting" / "public"

PAGES = [
    ("利用規約.md", "terms.html", "利用規約"),
    ("プライバシーポリシー.md", "privacy.html", "プライバシーポリシー"),
    ("特定商取引法に基づく表記.md", "tokusho.html", "特定商取引法に基づく表記"),
]

CSS = """
body{font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;line-height:1.8;color:#222;background:#fafafa}
h1{font-size:1.5rem;border-bottom:2px solid #4a5d8a;padding-bottom:8px}
h2{font-size:1.15rem;margin-top:2em;border-left:4px solid #4a5d8a;padding-left:8px}
h3{font-size:1rem;margin-top:1.5em}
table{border-collapse:collapse;width:100%;font-size:.95rem}
th,td{border:1px solid #ccc;padding:6px 8px;vertical-align:top}
th{background:#eef1f7}
nav{font-size:.9rem;margin-bottom:16px}
footer{margin-top:3em;font-size:.85rem;color:#666}
"""


def inline(text: str) -> str:
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`(.+?)`", r"<code>\1</code>", t)
    return t


def md_to_html(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    para: list[str] = []

    def flush_para() -> None:
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            flush_para()
            i += 1
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            flush_para()
            out.append(f"<h{len(m.group(1))}>{inline(m.group(2))}</h{len(m.group(1))}>")
            i += 1
            continue
        if line.startswith("|"):
            flush_para()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
            body = [r for r in cells if not all(re.fullmatch(r":?-+:?", c) for c in r)]
            out.append("<table>")
            for ri, r in enumerate(body):
                tag = "th" if ri == 0 else "td"
                out.append("<tr>" + "".join(f"<{tag}>{inline(c)}</{tag}>" for c in r) + "</tr>")
            out.append("</table>")
            continue
        m = re.match(r"^(\s*)(-|\d+\.)\s+(.*)$", line)
        if m:
            flush_para()
            ordered = m.group(2) != "-"
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>")
            while i < len(lines):
                m2 = re.match(r"^(\s*)(-|\d+\.)\s+(.*)$", lines[i])
                if not m2:
                    break
                indent = len(m2.group(1))
                text = m2.group(3)
                # ネストした箇条書き（インデント 3 以上）は同じ li 内の ul として出す
                if indent >= 3:
                    out.append(f"<ul><li>{inline(text)}</li></ul>")
                else:
                    out.append(f"<li>{inline(text)}</li>")
                i += 1
            out.append(f"</{tag}>")
            continue
        para.append(line.strip())
        i += 1
    flush_para()
    return "\n".join(out)


def page(title: str, body: str) -> str:
    nav = " ｜ ".join(f'<a href="{o}">{t}</a>' for _, o, t in PAGES)
    return (
        "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">"
        f"<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>SnapMon {title}</title>"
        f"<style>{CSS}</style></head><body><nav><a href=\"index.html\">SnapMon</a> ｜ {nav}</nav>{body}"
        "<footer>© SnapMon</footer></body></html>\n"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for src, dst, title in PAGES:
        md = (SRC / src).read_text(encoding="utf-8")
        (OUT / dst).write_text(page(title, md_to_html(md)), encoding="utf-8")
        print("wrote", dst)
    links = "".join(f'<li><a href="{o}">{t}</a></li>' for _, o, t in PAGES)
    index = page("", f"<h1>SnapMon</h1><p>写真で生まれ、歩いて育つモンスター育成アプリ。</p><ul>{links}</ul>")
    (OUT / "index.html").write_text(index, encoding="utf-8")
    print("wrote index.html")


if __name__ == "__main__":
    main()
