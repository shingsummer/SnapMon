# ADR-001: 技術スタック

- 日付: 2026-09-15
- 状態: 採用
- 出典: 企画書 v1.3 §9.1

## 決定

| レイヤ | 採用 | 理由 |
|---|---|---|
| クライアント | Flutter 3.x（Dart） | iOS/Android 単一コード。カメラ・歩数のプラグインが揃う。UI の自由度が高い |
| 状態管理 | Riverpod 2 | テスト容易、非同期に強い |
| ローカルDB | Drift（SQLite） | 同期済み歩数区間の記録、キャッシュ |
| バックエンド | Firebase（Auth, Firestore, Cloud Functions 2nd gen, Storage, App Check, FCM）。最初から Blaze プラン | 個人開発で運用負荷が最小。Functions 2nd gen と外部 API 呼び出しに Blaze が必須。予算アラート月 5,000 円 |
| Functions ランタイム | Node 22 / TypeScript strict / zod | |
| 画像認識 | Google Cloud Vision API | ラベル・主要色・顔検出を 1 リクエストで取得。P1 で Label のみに減らせるか検証 |
| 画像生成 | OpenAI Images API を第一候補。アダプタ層で差し替え可。バケット単位でキャッシュ | 商用利用可。コストは §14.2 |
| 歩数 | iOS: pedometer + CMMotionActivity、Android: Health Connect + ActivityRecognition。起動時に履歴取得、バックグラウンド処理なし | Health Connect は Play Console で用途申告が必要 |
| 地図・POI（v1.1） | flutter_map（OSM）+ Overpass API | Google Maps SDK の従量課金回避 |
| 分析 | Firebase Analytics + Crashlytics | |
| CI | GitHub Actions | |

## 成長式・乱数の「正」

- 参照実装は Python（`tools/growth_ref.py`）。フィクスチャを生成する。
- サーバー（TS）とクライアント（Dart）はゴールデンテストで参照実装に一致させる。
- 本番で効くのはサーバーの値。クライアントは表示用の予測のみ。
- 成長曲線は sin の実装差を避けるため式ではなく表（`growth_curves.json`）を配布する。

## 却下した案

- **Spark プランで β まで運用**: Functions 2nd gen と外部 API 呼び出しは Blaze 必須のため不可。
- **GPS 速度による乗り物除外**: 「使用中のみ」の位置権限では背景で取れず、v1 は位置権限自体を要求しないため不採用。アクティビティ認識で判定。
- **個体ごとの画像生成**: 収支が成立しないため、バケット単位のキャッシュ方式に変更（§3.6）。
- **`monsters` ドキュメントに隠し値を同居させ DTO で除く**: ルールの書き間違い 1 つで漏れるため、`monsters_private` に分離。

## 影響

- `shared-config/` は Functions・app 両方にコピーして同梱する（`npm run copy-config`、`app/tool/copy_config.sh`）。
- スタックを変更する場合は新しい ADR を追加し、本 ADR を「置換」にする。
