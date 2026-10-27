#!/usr/bin/env node
// Merges web coverage from Vitest (coverage/coverage-final.json, Istanbul provider: the same
// instrumentation as the e2e build, so statements line up — npm run coverage:merged) and the e2e run
// (../../tests/e2e/test-results/coverage/*.json, written from window.__coverage__ of an instrumented
// build, paths under /app/src) into coverage-merged/ (text summary, HTML, JSON). docs/testing.md
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import libSourceMaps from 'istanbul-lib-source-maps';
import reports from 'istanbul-reports';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Container paths (/app/...) to this checkout. */
const remap = (data) => Object.fromEntries(Object.entries(data).map(([file, cov]) => {
  const local = file.replace(/^\/app\//, `${web}/`);
  return [local, { ...cov, path: local }];
}));
const store = libSourceMaps.createSourceMapStore();
let files = 0;

// e2e: an instrumented build whose statements refer to generated code (each file carries its
// inputSourceMap). Merge the per-page files, then map them back to source lines.
const e2e = libCoverage.createCoverageMap({});
const e2eDir = resolve(web, '../../tests/e2e/test-results/coverage');
if (existsSync(e2eDir)) {
  for (const name of readdirSync(e2eDir).filter((n) => n.endsWith('.json'))) {
    try { e2e.merge(JSON.parse(readFileSync(join(e2eDir, name), 'utf8'))); files++; } catch { /* partial file from an interrupted page */ }
  }
}
// Source maps name files by their container path (/app/src/...): remap after transforming.
const map = libCoverage.createCoverageMap(remap(JSON.parse(JSON.stringify(await store.transformCoverage(e2e)))));

// Unit: Vitest with the Istanbul provider reports source lines already (transformed anyway, harmless).
const unit = join(web, 'coverage', 'coverage-final.json');
if (existsSync(unit)) { map.merge(await store.transformCoverage(libCoverage.createCoverageMap(remap(JSON.parse(readFileSync(unit, 'utf8')))))); files++; }

map.filter((file) => file.startsWith(`${web}/src/`) && !/\.test\.tsx?$/.test(file));
const context = libReport.createContext({ dir: join(web, 'coverage-merged'), coverageMap: map, defaultSummarizer: 'nested' });
for (const kind of ['text-summary', 'html', 'json-summary']) reports.create(kind).execute(context);
console.log(`merged ${files} coverage files`);
