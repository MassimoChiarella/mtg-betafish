import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { fixture } from "../tests/browser/fixtures.mjs";
import { generateEvent } from "../app/simulator.ts";
import { serializeGameState, readStoredSession, writeStoredSession } from "../app/storage-session.ts";

const root = new URL("../dist/client/", import.meta.url);
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const { fileURLToPath } = await import("node:url");
const assets = files(fileURLToPath(root)).filter((path) => /\.(js|css)$/.test(path)).map((path) => {
  const body = readFileSync(path);
  return { path, raw: body.length, gzip: gzipSync(body).length };
});
const js = assets.filter(({ path }) => path.endsWith(".js"));
const css = assets.filter(({ path }) => path.endsWith(".css"));
const pages = js.filter(({ path }) => /[/\\]page-[^/\\]+\.js$/.test(path));
const total = (items, key) => items.reduce((sum, item) => sum + item[key], 0);
const sizes = { jsChunks: js.length, jsRaw: total(js, "raw"), jsGzip: total(js, "gzip"), pageGzip: total(pages, "gzip"), cssGzip: total(css, "gzip") };
assert.ok(js.length && css.length && pages.length, "Build the production export before measuring assets.");
const budgets = { jsGzip: 225 * 1024, pageGzip: 64 * 1024, cssGzip: 16 * 1024 };
for (const [key, limit] of Object.entries(budgets)) assert.ok(sizes[key] <= limit, `${key}: ${sizes[key]} bytes exceeds ${limit}; investigate before raising this budget.`);

const state = fixture(undefined, { history: Array.from({ length: 40 }, (_, index) => ({ id: `perf-${index}`, turn: 6, title: "Recorded table action", detail: "Confirmed costs, targets, combat and tracked totals in the playtester. ".repeat(3), tone: "neutral" })) });
const serialized = serializeGameState(state);
assert.ok(serialized);
const raw = JSON.stringify({ revision: 1, state });
const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
function sample(action) {
  for (let index = 0; index < 200; index++) action();
  const samples = Array.from({ length: 25 }, () => {
    const start = performance.now();
    for (let index = 0; index < 100; index++) action();
    return (performance.now() - start) / 100;
  }).sort((a, b) => a - b);
  return { medianMs: +samples[12].toFixed(4), p95BatchMeanMs: +samples[23].toFixed(4) };
}
let counter = 0;
const timings = {
  serializeValidated: sample(() => assert.ok(serializeGameState(state))),
  readValidated: sample(() => assert.ok(readStoredSession(raw))),
  saveAndBackupInMemory: sample(() => assert.ok(writeStoredSession(storage, "perf", ++counter, state))),
  generateEvent: sample(() => generateEvent({ turn: 6, counter: ++counter, seed: "PERF", opponents: state.opponents, recentTemplateIds: [], activeThreat: false })),
};
console.log(JSON.stringify({ node: process.version, sizes, budgets, sessionBytes: Buffer.byteLength(serialized), timings, scope: "Native warmed lab batches; memory-backed storage excludes browser I/O. All emitted client JS is counted, not only initial-route transfer. Browser interaction report is a separate Playwright attachment." }, null, 2));
