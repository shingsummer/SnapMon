# SnapMon（仮）

写真で生まれ、歩いて育つ、育成バトルRPG。仕様は [docs/SnapMon_企画書_v1.3.md](docs/SnapMon_企画書_v1.3.md) が正。

## 構成

```
app/             Flutter クライアント（lib/domain は純 Dart）
functions/       Firebase Cloud Functions（TypeScript、サーバー権威）
shared-config/   定数・成長曲線・技・つぶやき・フィクスチャ（両者に同梱）
tools/           Python 参照実装・フィクスチャ生成・検算
docs/            企画書、ADR
```

## セットアップ

```bash
# 1. Python（参照実装・フィクスチャ）
python tools/gen_fixtures.py          # growth_curves.json と fixtures を生成
python tools/sim_growth.py            # 企画書 §4.5 / §4.7 の表の検算

# 2. Functions
cd functions && npm install && npm test

# 3. Flutter（SDK 導入後）
cd app && bash tool/copy_config.sh && flutter pub get && flutter test
```

## 定数を変えるときの手順

1. `shared-config/constants.json` を編集
2. `python tools/gen_fixtures.py` でフィクスチャを再生成
3. `python tools/sim_growth.py` の出力で企画書 §4.5 / §4.7 / §16.4 の表を更新
4. `cd functions && npm test`、`cd app && flutter test` が通ることを確認

## 開発フェーズ

企画書 §13。現在: **P0 基盤**。
