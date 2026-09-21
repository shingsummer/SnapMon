# SnapMon（仮）

写真で生まれ、歩いて育つ、育成バトルRPG。仕様は [docs/SnapMon_企画書_v1.3.md](docs/SnapMon_企画書_v1.3.md) が正。

## 構成

```
app/             Flutter クライアント（lib/domain は純 Dart）
functions/       Firebase Cloud Functions（TypeScript、サーバー権威）
shared-config/   定数・成長曲線・技・つぶやき・フィクスチャ（両者に同梱）
tools/           Python 参照実装・フィクスチャ生成・検算
docs/            企画書、ADR
firebase.json    Functions / Firestore / Storage のデプロイ設定とエミュレータ
firestore.rules  クライアントは自分のデータの読み取りのみ。monsters_private は完全拒否
```

## セットアップ

```bash
# 1. Python（参照実装・フィクスチャ）
python tools/gen_fixtures.py          # growth_curves.json と fixtures を生成
python tools/sim_growth.py            # 企画書 §4.5 / §4.7 の表の検算

# 2. Functions
cd functions && npm install && npm test

# 3. Flutter
cd app && bash tool/copy_config.sh && flutter pub get && flutter test

# 4. プレースホルダ画像（ファミリー×属性 84 枚の SVG）
python tools/gen_placeholder_art.py
```

### ローカルエミュレータで通しで動かす（Vision API を呼ばない）

```bash
# ターミナル A: Functions + Firestore エミュレータ（Java が必要。Android Studio 同梱の jbr でよい）
cd functions && npm run build && cd .. && firebase emulators:start --only functions,firestore --project snap-mon-7a9bf

# ターミナル B: アプリをエミュレータ接続モードで起動（Android エミュレータからは 10.0.2.2 に接続）
#   FAKE_STEPS=true で疑似歩数（直近 40 分の歩行）を流し込む。エミュレータには歩数センサーが無いため
cd app && bash tool/copy_config.sh && flutter run --dart-define=USE_EMULATOR=true --dart-define=FAKE_STEPS=true
```

エミュレータ上の generateMonster は Vision を呼ばず「マグカップ／青」の固定結果を返す（`FakeVisionClient`）。
Firestore エミュレータでの結合テストは `cd functions && npm run test:integration`。

### Firebase（初回のみ）

Firebase プロジェクト `snap-mon-7a9bf`（Blaze）。ネイティブ設定ファイルは git 管理外なので、クローン直後は再生成する。

```bash
npm install -g firebase-tools
dart pub global activate flutterfire_cli
firebase login
cd app && flutterfire configure --platforms=android,ios
```

`app/lib/firebase_options.dart` はクライアント公開設定なので commit している。`google-services.json` / `GoogleService-Info.plist` は上記コマンドで再生成する。

### Android 実機・エミュレータで動かすには

Android Studio を入れて SDK を導入する（`flutter doctor` の Android toolchain が √ になること）。Google サインインには、デバッグ署名の SHA-1 を Firebase コンソールの Android アプリに登録する必要がある。

```bash
cd app/android && ./gradlew signingReport     # SHA1 を控えてコンソールに登録
cd app && bash tool/copy_config.sh && flutter run
```

デバッグビルドは App Check のデバッグプロバイダを使う。初回起動時にログへ出るデバッグトークンを Firebase コンソール（App Check → アプリ → デバッグトークンを管理）に登録する。

## 定数を変えるときの手順

1. `shared-config/constants.json` を編集
2. `python tools/gen_fixtures.py` でフィクスチャを再生成
3. `python tools/sim_growth.py` の出力で企画書 §4.5 / §4.7 / §16.4 の表を更新
4. `cd functions && npm test`、`cd app && flutter test` が通ることを確認

## 開発フェーズ

企画書 §13。P0 完了（2026-09-18）。P1 はエミュレータで本番 Vision API による誕生まで確認済み（実機確認のみ残り）。P2 育成はエミュレータ＋疑似歩数で確認済み（Health Connect の実歩数は実機待ち）。P3 アート: **写真参照の個体生成（品質 low、性格で表情が変わる）** を本番で確認済み。共有バケットは失敗時の保険。P4 バトル: 模擬戦をエミュレータで通し確認済み、本番デプロイ済み（フレンド戦は 2 アカウント目での確認が残り）。P5: 図鑑・アイテム・師匠任命/弟子予約/家系図・保管牧場・チュートリアルをエミュレータで通し確認済み、本番デプロイ済み。現在: **P6 β準備**（バランス調整、課金・広告、規約/プライバシーポリシー、Health Connect 用途申告、実機テスト）。

法務: 利用規約・プライバシーポリシーの原本は `docs/legal/*.md`。アプリは `app/tool/copy_config.sh` で `assets/legal/` にコピーして表示（S17、`/legal/terms` `/legal/privacy`）。公開ページは `python tools/gen_legal_html.py` → `hosting/public/` → `firebase deploy --only hosting`（URL は https://snap-mon-7a9bf.web.app/privacy.html など。ストア申請と Health Connect の用途申告に使う）。運営者名・連絡先・管轄裁判所は記入済み（2026-09-21）。年齢確認（生年、13 歳未満は拒否）はホーム表示前の `BirthYearGate`、退会はホーム下部の「アカウントを削除」（callable `deleteAccount`）。

ステータスは 7 種（hp, atk, def, spa, sdf, spd, luk。P6 で特防 sdf を追加。旧個体の欠けは読み出し時に def で補う）。ファミリーごとの傾向は `shared-config/families.json`（初期値 bias と上昇倍率。ポケモンの種族値に相当、企画書 §4.1）。バトルのダメージ式は企画書 §6.2（v1.3 で改訂済み: 攻÷(攻＋守) × レベル係数 × 段階補正、会心は運÷3000 で 2 倍）。定数を触ったら `cd functions && npm run sim:battle` で検算し、§6.2 の表を更新する。技は Lv10/20 で自動習得（Lv30/40 の入れ替えは v1.1）。

注意: 画像 API の安全フィルタは「Do not depict humans」のような否定文を弾くため、プロンプトは企画書 §16.3 の意図を肯定表現で書いている（`functions/src/art/prompt.ts`）。`moderation: "low"` も指定。

### 画像生成の API キー（P3）

コードにも .env にも書かない。Secret Manager に登録し、Functions だけが読む。

```bash
firebase functions:secrets:set OPENAI_API_KEY --project snap-mon-7a9bf   # 聞かれたらキーを貼る
```

モデル名は `functions/.env` の `OPENAI_IMAGE_MODEL`、単価の目安は `shared-config/constants.json` の `artCostUsd`。
エミュレータでは `functions/.secret.local`（git 管理外、空でよい）により疑似生成に切り替わる。
事前生成（252 バケット）とコスト統計は、アプリのホーム画面タイトルを長押しして開く管理画面から（`ADMIN_UIDS` の uid のみ）。

### デプロイ

```bash
firebase deploy --only firestore:rules,firestore:indexes --project snap-mon-7a9bf
cd functions && npm test && cd .. && firebase deploy --only functions --project snap-mon-7a9bf
firebase deploy --only storage --project snap-mon-7a9bf   # Storage を「始める」してから
```

デプロイ直後は Cloud Run の呼び出し権限の反映に 1〜2 分かかり、その間は callable が UNAUTHENTICATED を返す。

`User code failed to load. Cannot determine backend specification. Timeout after 10000` で失敗したときは、コードの読み込み自体は 0.4 秒程度なので CLI 側の検出タイムアウト（既定 10 秒）が原因。`FUNCTIONS_DISCOVERY_TIMEOUT=60000` を付けて再実行する（PowerShell なら `$env:FUNCTIONS_DISCOVERY_TIMEOUT=60000` を先に実行）。
