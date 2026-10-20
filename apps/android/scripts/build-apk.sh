#!/usr/bin/env bash
set -euo pipefail
android_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(cd -- "$android_dir/../.." && pwd)"
cd -- "$repo_dir"
if [[ ! -x apps/web/node_modules/.bin/vite ]]; then npm --prefix apps/web ci; fi
node apps/android/scripts/design-tokens.mjs
apps/web/node_modules/.bin/tsc -p apps/android/protocol/tsconfig.json --noEmit
apps/web/node_modules/.bin/vite build --config apps/android/protocol/vite.config.mjs
"$android_dir/gradlew" -p "$android_dir" :app:assembleDebug
mkdir -p apps/assets
cp "$android_dir/app/build/outputs/apk/debug/app-debug.apk" apps/assets/convo-android-debug.apk
(cd apps/assets && sha256sum convo-android-debug.apk > convo-android-debug.apk.sha256)
printf 'APK: %s\n' "$repo_dir/apps/assets/convo-android-debug.apk"
