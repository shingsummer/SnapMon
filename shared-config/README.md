# shared-config

Functions（TypeScript）と app（Dart）の両方が読む静的マスタ。**Python の `tools/growth_ref.py` が参照実装**で、TS / Dart はゴールデンテストでそれに一致することを保証する。

| ファイル | 内容 | 生成 |
|---|---|---|
| `constants.json` | 上限値・レート・成長式の係数（企画書 §16.2） | 手書き |
| `growth_curves.json` | 成長タイプ別 curve(L) の表（L=1..49、小数6桁） | `python tools/gen_fixtures.py` |
| `personalities.json` | 性格8種。好む／嫌うトレーニング | 手書き |
| `murmurs.json` | つぶやきテキストと成長タイプ重み | 手書き（運営で入替） |
| `label_map.json` | Vision ラベル → ファミリー | 手書き（運営で追加） |
| `moves.json` | 技テーブル | 手書き |
| `fixtures/growth_golden.json` | ゴールデンテスト用フィクスチャ | `python tools/gen_fixtures.py` |

## 乱数（xorshift128）の仕様

3言語で bit 単位に一致させるため、以下を厳守する。

- シード: 16 バイト（32桁 hex）。`seedFromParts(label, colorHex, userId, yyyymmdd, nonce)` は `sha256(label|colorHex|userId|yyyymmdd|nonce)` の先頭 16 バイト。
- 状態: `x, y, z, w` = シードの 4 バイトずつをビッグエンディアン uint32 として読む。全部 0 なら `x = 1`。
- 1ステップ:
  ```
  t = x ^ (x << 11)            (uint32)
  x = y; y = z; z = w
  w = w ^ (w >>> 19) ^ (t ^ (t >>> 8))   (uint32)
  return w
  ```
- `nextDouble()` = `nextU32() / 4294967296`（[0, 1)）
- `randInt(lo, hi)` = `lo + floor(nextDouble() * (hi - lo + 1))`（両端含む）
- `randRange(lo, hi)` = `lo + nextDouble() * (hi - lo)`
- 四捨五入は常に `floor(x + 0.5)`（Python の `round` は銀行丸めなので使わない）

## 乱数の呼び出し順（変えるとフィクスチャが壊れる）

- **個体生成**: ステータス順 `hp, atk, def, spa, sdf, spd, luk`（7 種、P6 で特防 sdf を追加）で `randInt(base)`, `randInt(talent)` を交互 → `nextDouble()`（成長タイプ）→ `randInt(0,7)`（性格）→ `randRange(murmurRate)` → `randInt(-jitter, +jitter)`
- **レベルアップ**: ステータス順に `randRange(0.8, 1.2)` を 1 回ずつ
- ファミリー傾向（`families.json` の baseBias / gainMod）は乱数を消費しない。初期値は rand(5,60)+baseBias（1 未満は 1）、素質の計算には bias を入れない。レベルアップ上昇量に gainMod を掛ける
- **トレーニング**: `randRange(2, 4)` を 1 回

## 成長式（企画書 §4.3〜4.5、§5.3）

```
talent    = clamp( floorHalfUp( rawTalent * 0.6 + (65 - rawBase) / 60 * 10 * 0.4 ), 1, 10 )
statCap   = 399 + talent * 60
gain      = (5.0 + 0.9 * talent) * curve[growth][level] * personalityMod * randRange(0.8, 1.2)
training  = (randRange(2, 4) + 0.5 * talent[main]) * trainingMod    # sub は main の 50%
expToNext = 20 + 4 * level
```

`curve` は `growth_curves.json` の表を引く（sin の実装差を避けるため式ではなく表）。
