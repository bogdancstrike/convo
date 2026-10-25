#!/usr/bin/env bash
# Runs call-link-android.spec.ts: declines the group ring on the emulator, then opens the member
# call link with an Android VIEW intent so the app joins the running call.
# Prerequisites as for run-call.sh. Usage: PK_USER=droid tests/e2e/android/run-call-link.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${PK_USER:?set PK_USER to the username signed in on the emulator}"
ADB="${ADB:-adb} ${ANDROID_SERIAL:+-s $ANDROID_SERIAL}"
log=$(mktemp)
docker compose --profile e2e build e2e >/dev/null
docker compose --profile e2e run --rm -e PK_USER e2e npx playwright test -c android/playwright.android.config.ts call-link-android > "$log" 2>&1 &
runner=$!
tap() { # taps the node whose content-desc is $1
  local bounds; bounds=$($ADB exec-out uiautomator dump /dev/tty | grep -o "content-desc=\"$1\"[^>]*bounds=\"[^\"]*\"" | grep -o '\[[0-9,]*\]\[[0-9,]*\]' | head -1)
  [ -n "$bounds" ] || return 1
  read -r x1 y1 x2 y2 < <(echo "$bounds" | tr '[],' '   ')
  $ADB shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}
for _ in $(seq 1 90); do grep -q "CALL LINK" "$log" && break; sleep 2; done
link=$(grep -o "CALL LINK #/call/[A-Za-z0-9_-]*" "$log" | awk '{print $3}')
for _ in $(seq 1 30); do tap Decline && break; sleep 2; done
sleep 3
$ADB shell am start -a android.intent.action.VIEW -d "https://localhost:8443/$link" -n com.convo.android/.MainActivity >/dev/null
wait $runner; status=$?
grep -E "ANDROID JOINED|passed|failed" "$log"; rm -f "$log"; exit $status
