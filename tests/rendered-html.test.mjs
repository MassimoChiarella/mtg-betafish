import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../dist/server/index.js";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function sourceSection(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.ok(startAt >= 0 && endAt > startAt, `Expected source section ${start} … ${end}`);
  return source.slice(startAt, endAt);
}

async function render() {
  return worker.fetch(
    new Request("https://goldfish-lab.example/", { headers: { accept: "text/html", host: "goldfish-lab.example" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Goldfish Lab product shell and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Goldfish Lab — Commander Playtest Companion<\/title>/i);
  assert.match(html, /The table acts\./);
  assert.match(html, /Assign your combat damage/);
  assert.match(html, /Scenario library/);
  assert.match(html, /https:\/\/goldfish-lab\.example\/og\.png/);

  const encounter = html.indexOf('class="encounter-column"');
  const opponents = html.indexOf('class="rail opponents-panel"');
  const pressure = html.indexOf('class="rail pressure-panel"');
  assert.ok(encounter >= 0 && encounter < opponents && opponents < pressure, "mobile DOM order should be encounter, opponents, pressure");
});

test("game-over recovery preserves the expired turn event, undo, and explicit answer total", () => {
  const continuation = sourceSection(pageSource, "function continueAfterGameOver()", "function adjustLife(");
  assert.match(continuation, /eventCounter = previous\.eventCounter \+ 1/);
  assert.match(continuation, /currentEvent: generateEvent\(\{[\s\S]*?turn: previous\.turn,/);
  assert.match(continuation, /responseStage: "prompt"/);

  const terminal = sourceSection(pageSource, "{game.gameOver && (", "</main>");
  assert.match(terminal, /onClose=\{continueAfterGameOver\}/);
  assert.match(terminal, /onClick=\{continueAfterGameOver\}>Continue anyway<\/button>/);
  assert.match(terminal, /\{canUndo && <button[^>]+onClick=\{undo\}>Undo last change<\/button>\}/);
  assert.match(terminal, /<b>\{game\.answeredCount\}<\/b> threats\/actions answered/);
  assert.doesNotMatch(pageSource, /game\.history\.filter\([^\n]+answered/);

  const migration = sourceSection(pageSource, "const migratedAnsweredCount", "// eslint-disable-next-line react-hooks/set-state-in-effect");
  assert.match(migration, /\["Action answered", "Threat answered", "Combat prevented"\]/);
  assert.match(pageSource, /answeredCount: Number\.isFinite\(parsed\.answeredCount\)[^\n]+: migratedAnsweredCount/);
  assert.match(pageSource, /resolveEvent\("Action answered", labels\[answer\], "success", \{\}, true\)/);
  assert.match(pageSource, /applyIncoming\(0, 0, "Combat prevented", 0, true\)/);
  assert.match(sourceSection(pageSource, "function stopThreat()", "function delayThreat()"), /answeredCount: previous\.answeredCount \+ 1/);
  assert.match(sourceSection(pageSource, "function answerDefense()", "function applyOutgoingDamage("), /answeredCount: previous\.answeredCount \+ 1/);
});

test("accessible client contracts use one game-over announcement and native combat semantics", () => {
  assert.equal(pageSource.match(/role="alert"/g)?.length ?? 0, 0);
  assert.match(pageSource, /aria-live="polite" aria-atomic="true">\{game\.gameOver \? "" : liveMessage\}/);
  assert.equal(pageSource.match(/subtitle=\{game\.gameOver\}/g)?.length ?? 0, 1);

  assert.match(pageSource, /<form className="attacker-form" onSubmit=\{addOutgoingAttacker\}>/);
  assert.match(sourceSection(pageSource, "function addOutgoingAttacker(", "function removeOutgoingAttacker("), /event\.preventDefault\(\)/);
  assert.match(pageSource, /<fieldset className="keyword-picker event-fieldset"><legend className="sr-only">Attacker keywords<\/legend>/);
  assert.match(pageSource, /add-attacker-button" type="submit">Add attacker<\/button>/);

  assert.match(cssSource, /\.workspace \{[^}]*grid-template-areas: "opponents encounter pressure"/);
  assert.match(cssSource, /\.opponents-panel \{ grid-area: opponents; \}/);
  assert.match(cssSource, /\.encounter-column \{ grid-area: encounter;/);
  assert.match(cssSource, /\.pressure-panel \{ grid-area: pressure; \}/);
  const mobileStyles = sourceSection(cssSource, "@media (max-width: 820px)", "@media (max-width: 520px)");
  assert.match(mobileStyles, /\.workspace \{[^}]*display: flex/);
  assert.doesNotMatch(mobileStyles, /order\s*:/);
});
