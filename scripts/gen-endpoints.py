#!/usr/bin/env python3
"""Generates tests/api/endpoints.json: every HTTP endpoint of the server (method, path template,
security chain) from the Spring controllers, for the API security and robustness suites."""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), '..', 'server', 'src', 'main', 'java')
MAPPING = re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\(\s*(?:value\s*=\s*)?"([^"]*)"')
CLASS_PREFIX = re.compile(r'@RequestMapping\(\s*(?:value\s*=\s*)?"([^"]*)"\s*\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+)?(?:final\s+)?class')
endpoints = []
for dirpath, _, files in os.walk(ROOT):
    for name in files:
        if not name.endswith('.java'):
            continue
        source = open(os.path.join(dirpath, name), encoding='utf-8').read()
        if '@RestController' not in source:
            continue
        prefix_match = CLASS_PREFIX.search(source)
        prefix = prefix_match.group(1) if prefix_match else ''
        for m in MAPPING.finditer(source):
            path = (prefix + m.group(2)).replace('//', '/')
            chain = 'admin' if path.startswith('/v1/admin') else 'operations' if path.startswith('/actuator') else 'device'
            endpoints.append({'method': m.group(1).upper(), 'path': path, 'chain': chain, 'controller': name[:-5]})
endpoints.sort(key=lambda e: (e['path'], e['method']))
out = os.path.join(os.path.dirname(__file__), '..', 'tests', 'api', 'endpoints.json')
json.dump(endpoints, open(out, 'w'), indent=1)
print(f'{len(endpoints)} endpoints -> {os.path.normpath(out)}')
