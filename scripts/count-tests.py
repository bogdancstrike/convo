#!/usr/bin/env python3
"""Counts Convo's tests per suite from the test runners themselves (docs/testing.md).

  scripts/count-tests.py            # all suites (needs Docker for the API and e2e collectors)
  scripts/count-tests.py --no-docker

JUnit and Android counts come from the latest test-result XML (run the suites first); the others
are collected without running (vitest list, pytest --collect-only, playwright --list).
"""
import glob, os, re, subprocess, sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
docker = '--no-docker' not in sys.argv


def run(cmd, cwd=ROOT):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True).stdout


def junit(pattern):
    total = 0
    for f in glob.glob(os.path.join(ROOT, pattern)):
        try:
            total += int(ET.parse(f).getroot().get('tests', 0))
        except ET.ParseError:
            pass
    return total


counts = {
    'server JUnit (unit)': junit('server/build/test-results/test/*.xml'),
    'web Vitest (core + UI)': len(run('npx vitest list 2>/dev/null', os.path.join(ROOT, 'apps/web')).splitlines()),
    'admin Vitest': len(run('npx vitest list 2>/dev/null', os.path.join(ROOT, 'apps/admin')).splitlines()),
    'Android JUnit': junit('apps/android/app/build/test-results/*/*.xml'),
}
if docker:
    api = re.search(r'(\d+) tests? collected', run('docker compose --profile e2e run --rm api-tests pytest --collect-only -q tests 2>/dev/null | tail -3'))
    counts['API pytest (contract, security, robustness)'] = int(api.group(1)) if api else 0
    e2e = re.search(r'Total: (\d+) tests?', run('docker compose --profile e2e run --rm e2e npx playwright test --list 2>/dev/null | tail -3'))
    counts['e2e Playwright (chromium + firefox)'] = int(e2e.group(1)) if e2e else 0
    smoke = re.search(r'Total: (\d+) tests?', run('docker compose --profile e2e run --rm e2e npx playwright test -c smoke/playwright.smoke.config.ts --list 2>/dev/null | tail -3'))
    counts['production smoke'] = int(smoke.group(1)) if smoke else 0
width = max(map(len, counts))
for name, n in counts.items():
    print(f'{name:<{width}}  {n:>6}')
print(f'{"TOTAL":<{width}}  {sum(counts.values()):>6}')
