#!/usr/bin/env python3
"""Lists user-facing English strings in the Android UI that have no Romanian translation.

Looks at literal arguments of the text-bearing composables and of tr(); strings built with
templates ($name) cannot be looked up and are reported separately, because tr() only matches whole
keys — use tr("… {placeholder} …").replace(...) for those. Exit status 1 when something is missing.

Usage: apps/android/scripts/check-i18n.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "app/src/main/java/com/convo/android"
I18N = (ROOT / "i18n/I18n.kt").read_text(encoding="utf-8")
KEYS = set(re.findall(r'"((?:[^"\\]|\\.)*)" to "', I18N))
# Never translated: the product name.
UNTRANSLATED = {"Convo"}

# Composables whose leading string arguments are shown to the user (translated through tr()).
CALL = re.compile(r'\b(Text|tr|ActionRow|PrivacySwitch|InfoSection|Confirm|EmptyState|PillChip|SettingsRow)\(\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"((?:[^"\\]|\\.)*)")?')

missing, templated = {}, {}
for path in sorted(ROOT.rglob("*.kt")):
    if path.name == "I18n.kt":
        continue
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        for match in CALL.finditer(line):
            for text in filter(None, match.groups()[1:]):
                # Only strings with words outside template expressions need translating.
                words = re.sub(r"\$\{[^}]*\}?|\$\w+", "", text)
                if not re.search(r"[A-Za-z]{2}", words) or text in UNTRANSLATED:
                    continue
                where = f"{path.relative_to(ROOT)}:{line_no}"
                if "$" in text:
                    templated.setdefault(text, where)
                elif text not in KEYS:
                    missing.setdefault(text, where)

for title, items in (("Missing Romanian translations", missing), ("Templated strings tr() cannot match", templated)):
    if items:
        print(f"{title} ({len(items)}):")
        for text, where in sorted(items.items(), key=lambda kv: kv[1]):
            print(f"  {where}: {text}")
sys.exit(1 if missing or templated else 0)
