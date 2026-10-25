#!/usr/bin/env bash
set -euo pipefail
android_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(cd -- "$android_dir/../.." && pwd)"
cd -- "$repo_dir"
if [[ ! -x apps/web/node_modules/.bin/vite ]]; then npm --prefix apps/web ci; fi
node apps/android/scripts/design-tokens.mjs
# Debug builds pin the local development certificate (Compose `web` container) so the emulator can
# use https://10.0.2.2:8443 against this computer. Skipped when the stack is not running.
if cert=$(docker compose exec -T web cat /etc/nginx/tls/server.crt 2>/dev/null) && [[ -n "$cert" ]]; then
  printf '%s\n' "$cert" > apps/android/app/src/debug/res/raw/convo_dev.crt
  echo "Pinned the local development certificate for debug builds"
fi
# Every user-facing string must have a Romanian translation.
apps/android/scripts/check-i18n.py
apps/web/node_modules/.bin/tsc -p apps/android/protocol/tsconfig.json --noEmit
apps/web/node_modules/.bin/vite build --config apps/android/protocol/vite.config.mjs
# Produce a compact distributable rather than retaining dead ZIP entries from incremental packaging.
"$android_dir/gradlew" -p "$android_dir" clean :app:assembleDebug
mkdir -p apps/assets
cp "$android_dir/app/build/outputs/apk/debug/app-debug.apk" apps/assets/convo-android-debug.apk
(cd apps/assets && sha256sum convo-android-debug.apk > convo-android-debug.apk.sha256)
printf 'APK: %s\n' "$repo_dir/apps/assets/convo-android-debug.apk"
