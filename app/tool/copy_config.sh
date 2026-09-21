#!/usr/bin/env bash
# shared-config/*.json を app/assets/config/ にコピーする（Flutter の assets はパッケージ内に置く必要があるため）。
# 生成物なので git 管理しない。flutter run / build の前に実行する。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/config
cp ../shared-config/*.json assets/config/
mkdir -p assets/legal
cp "../docs/legal/利用規約.md" assets/legal/terms.md
cp "../docs/legal/プライバシーポリシー.md" assets/legal/privacy.md
echo "copied shared-config -> app/assets/config/, docs/legal -> app/assets/legal/"
