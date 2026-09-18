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
cd app && bash tool/copy_config.sh && flutter run --dart-define=USE_EMULATOR=true
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

企画書 §13。P0 完了（2026-09-18）。現在: **P1 誕生**（本番 Functions デプロイ済み、エミュレータから本番 Vision API で誕生を確認。実機での撮影確認と Health Connect 用途申告が残り）。

### デプロイ

```bash
firebase deploy --only firestore:rules,firestore:indexes --project snap-mon-7a9bf
cd functions && npm test && cd .. && firebase deploy --only functions --project snap-mon-7a9bf
firebase deploy --only storage --project snap-mon-7a9bf   # Storage を「始める」してから
```

デプロイ直後は Cloud Run の呼び出し権限の反映に 1〜2 分かかり、その間は callable が UNAUTHENTICATED を返す。
