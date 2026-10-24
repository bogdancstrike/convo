#!/usr/bin/env bash
# Runs call-android.spec.ts against the local Compose stack and accepts the call on the emulator.
#
# Prerequisites: `docker compose up -d`, an emulator with the debug APK signed in as $PK_USER
# against https://localhost:8443 (`adb reverse tcp:8443 tcp:8443`), microphone/camera granted.
# Usage: PK_USER=droid [MINUTES=5] [VIDEO=1] tests/e2e/android/run-call.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${PK_USER:?set PK_USER to the username signed in on the emulator}"
ADB="${ADB:-adb} ${ANDROID_SERIAL:+-s $ANDROID_SERIAL}"
# Debug builds replace the emulator's silent microphone with a pulsed tone for audibility checks.
$ADB shell setprop debug.convo.calltone 1
$ADB logcat -c
docker compose --profile e2e build e2e >/dev/null
docker compose --profile e2e run --rm \
  -e PK_USER -e MINUTES="${MINUTES:-5}" -e VIDEO="${VIDEO:-}" e2e \
  npx playwright test -c android/playwright.android.config.ts &
runner=$!
# Accept the incoming call as soon as the ring screen shows.
for _ in $(seq 1 60); do
  if $ADB exec-out uiautomator dump /dev/tty 2>/dev/null | grep -q 'content-desc="Accept"'; then
    bounds=$($ADB exec-out uiautomator dump /dev/tty | grep -o 'content-desc="Accept"[^>]*bounds="[^"]*"' | grep -o '\[[0-9,]*\]\[[0-9,]*\]')
    read -r x1 y1 x2 y2 < <(echo "$bounds" | tr '[],' '   ')
    $ADB shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2)); echo "accepted on Android"; break
  fi
  sleep 2
done
wait $runner
echo "Android media counters:"; $ADB logcat -d -s ConvoCallStats | tail -2
