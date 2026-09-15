#!/usr/bin/env bash
# shared-config/*.json を app/assets/config/ にコピーする（Flutter の assets はパッケージ内に置く必要があるため）。
# 生成物なので git 管理しない。flutter run / build の前に実行する。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/config
cp ../shared-config/*.json assets/config/
echo "copied shared-config -> app/assets/config/"
