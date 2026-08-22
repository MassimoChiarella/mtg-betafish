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
    new Request("https://mtg-betafish.example/", { headers: { accept: "text/html", host: "mtg-betafish.example" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MTG Betafish product shell and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MTG Betafish — Commander Playtest Companion<\/title>/i);
  assert.match(html, /The table acts\./);
  assert.match(html, /Assign your combat damage/);
  assert.match(html, /Scenario library/);
  assert.match(html, /The permission to cast spells, activate abilities/);
  assert.match(html, /21 or more combat damage by the same commander/);
  assert.match(html, /https:\/\/mtg-betafish\.example\/og\.png/);

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

test("resolved table settings cannot create a second opponent action in the same turn", () => {
  const settings = sourceSection(pageSource, "function saveSettings()", "function openCombat()");
  const resolvedBranch = sourceSection(settings, "if (previous.responseStage === \"resolved\")", "const eventCounter");

  assert.match(resolvedBranch, /return \{ \.\.\.previous, seed, opponents, activeThreat, history \}/);
  assert.doesNotMatch(resolvedBranch, /generateEvent|eventCounter/);
  assert.match(settings, /activeThreat: Boolean\(activeThreat\)/);
});

test("accessible client contracts use one game-over announcement and native combat semantics", () => {
  assert.equal(pageSource.match(/role="alert"/g)?.length ?? 0, 0);
  assert.match(pageSource, /aria-live="polite" aria-atomic="true">\{game\.gameOver \? "" : liveMessage\}/);
  assert.equal(pageSource.match(/subtitle=\{game\.gameOver\}/g)?.length ?? 0, 1);
  assert.doesNotMatch(pageSource, /className="resolved-box" role="status"/);
  assert.doesNotMatch(pageSource, /className=\{`defense-result \$\{defense\.type\}`\} role="status"/);

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
  assert.doesNotMatch(mobileStyles, /(?:^|[;{])\s*order\s*:/m);
});

test("mobile turn flow keeps context, shortcuts, and touch controls reachable", () => {
  const focusFlow = sourceSection(pageSource, "const encounterHeading", "function commit(");
  assert.match(focusFlow, /const previousEventKey = useRef\(`\$\{game\.seed\}:\$\{game\.eventCounter\}`\)/);
  assert.match(focusFlow, /if \(previousEventKey\.current !== eventKey\) encounterHeading\.current\?\.focus\(\)/);
  assert.match(focusFlow, /else if \(previousResponseStage\.current !== game\.responseStage\) responseStep\.current\?\.focus\(\)/);
  assert.match(pageSource, /<h1 id="encounter-title" ref=\{encounterHeading\} tabIndex=\{-1\}>/);

  const summary = pageSource.indexOf('className="mobile-turn-summary"');
  const nextAction = pageSource.indexOf('className="next-action"');
  const opponents = pageSource.indexOf('className="rail opponents-panel"');
  assert.ok(summary >= 0 && summary < nextAction && nextAction < opponents, "mobile turn shortcuts should precede Next turn and the long opponent rail");
  const summarySource = sourceSection(pageSource, '<section className="mobile-turn-summary"', '<div className="next-action">');
  assert.match(summarySource, /game\.userLife/);
  assert.match(summarySource, /game\.activeThreat\.remaining/);
  assert.match(summarySource, /onClick=\{openCombat\}/);
  assert.match(summarySource, /onClick=\{openSettings\}/);

  const touchStyles = sourceSection(cssSource, "@media (max-width: 900px), (pointer: coarse)", "@media (max-width: 820px)");
  const mobileStyles = sourceSection(cssSource, "@media (max-width: 820px)", "@media (max-width: 520px)");
  assert.match(mobileStyles, /\.mobile-turn-summary \{[^}]*display: grid/);
  assert.match(touchStyles, /\.life-control > button \{[^}]*width: 44px; height: 44px/);
  assert.match(touchStyles, /\.outgoing-list > article > button \{[^}]*width: 44px; height: 44px/);
  assert.match(touchStyles, /\.glossary-help-trigger[^\n]+min-width: 44px; min-height: 44px/);
  assert.match(touchStyles, /\.damage-inputs input[^\n]+font-size: 16px/);

  const phoneStyles = sourceSection(cssSource, "@media (max-width: 520px)", "@media (max-width: 460px)");
  assert.match(phoneStyles, /\.modal \{[^}]*max-height: 94dvh/);
  assert.match(phoneStyles, /\.spell-art \{ height: 84px; \}/);
  assert.match(cssSource, /\.modal \{[^}]*max-height: calc\(100dvh - 48px\)/);
  assert.match(cssSource, /\.modal > \.modal-actions \{[^}]*position: sticky;[^}]*env\(safe-area-inset-bottom\)/);
});

test("glossary previews stay separate from one-click game actions", () => {
  const hoverHook = sourceSection(pageSource, "function useHoverPreview<", "function CardPreview(");
  const cardPreview = sourceSection(pageSource, "function CardPreview(", "function GlossaryTerm(");
  const glossaryTerm = sourceSection(pageSource, "function GlossaryTerm(", "function GlossaryExplanation(");
  const glossaryHelp = sourceSection(pageSource, "function GlossaryHelp(", "function glossaryText(");
  const glossaryText = sourceSection(pageSource, "function glossaryText(", "function Modal(");

  assert.match(hoverHook, /getBoundingClientRect\(\)/);
  assert.match(hoverHook, /function preparePreview\(\)/);
  assert.match(hoverHook, /if \(!panel\.matches\(":popover-open"\)\) onShow\?\.\(\)/);
  assert.match(hoverHook, /showPopover\(\)/);
  assert.match(hoverHook, /hidePopover\(\)/);
  assert.match(hoverHook, /clearTimeout\(hoverTimer\.current\)/);
  assert.match(cardPreview, /useHoverPreview<HTMLButtonElement>/);
  assert.match(cardPreview, /popoverTarget=\{previewId\}/);
  assert.match(cardPreview, /popoverTargetAction="toggle"/);
  assert.match(cardPreview, /onClick=\{preparePreview\}/);
  assert.match(glossaryTerm, /useHoverPreview<HTMLButtonElement>/);
  assert.match(glossaryTerm, /aria-describedby=\{previewId\}/);
  assert.match(glossaryTerm, /popoverTarget=\{previewId\}/);
  assert.match(glossaryTerm, /popoverTargetAction="toggle"/);
  assert.match(glossaryTerm, /onPointerEnter=[^\n]+showPreview\(160\)/);
  assert.match(glossaryTerm, /onPointerLeave=[^\n]+closePreview\(160\)/);
  assert.match(glossaryTerm, /matches\(":focus-visible"\)/);
  assert.match(glossaryTerm, /onBlur=/);
  assert.match(glossaryTerm, /onClick=\{preparePreview\}/);
  assert.match(glossaryTerm, /event\.key === "Escape"/);
  assert.match(glossaryTerm, /role="tooltip"/);
  assert.match(glossaryTerm, /popover="auto"/);
  assert.match(glossaryTerm, /GLOSSARY_DEFINITIONS\[term\]/);
  assert.match(glossaryHelp, /label = "Rules help"/);
  assert.match(glossaryHelp, /popoverTarget=\{previewId\}/);
  assert.match(glossaryHelp, /popoverTargetAction="toggle"/);
  assert.match(glossaryHelp, /onClick=\{preparePreview\}/);
  assert.match(glossaryHelp, /<GlossaryExplanation terms=\{terms\}/);
  assert.match(glossaryText, /text\.split\(GLOSSARY_PATTERN\)/);
  assert.match(glossaryText, /seen\?\.has\(term\)/);
  assert.match(glossaryText, /seen\?\.add\(term\)/);
  assert.match(glossaryText, /<GlossaryTerm term=\{term\}/);

  assert.match(pageSource, /glossaryText\(EVENT_PRESENTATION\[game\.currentEvent\.kind\]\.label, encounterGlossaryTerms\)/);
  assert.match(pageSource, /glossaryText\(game\.currentEvent\.prompt, encounterGlossaryTerms\)/);
  assert.match(pageSource, /glossaryText\(tag, encounterGlossaryTerms\)/);
  assert.match(pageSource, /<GlossaryHelp terms=\{\["Legal target"\]\}/);
  assert.match(pageSource, /<GlossaryHelp terms=\{\["Counter", "Hexproof", "Indestructible", "Phase out", "Legal target", "Sacrifice", "Blink", "Bounce"\]\}/);
  assert.match(pageSource, /<button type="button" onClick=\{\(\) => answerEvent\("protect"\)\}/);
  assert.match(pageSource, /<GlossaryHelp terms=\{\["Fog"\]\}/);
  assert.match(pageSource, /<button className="text-button" type="button" onClick=\{\(\) => applyIncoming\(0, 0, "Combat prevented", 0, true\)\}>Fog \/ stop combat<\/button>/);
  assert.match(pageSource, /<label>Commander combat damage<input name="incoming-commander"/);
  assert.match(pageSource, /<label>Lifelink damage dealt<input name="incoming-lifelink"/);
  assert.match(pageSource, /<GlossaryHelp label="Keyword help" terms=\{COMBAT_KEYWORDS\}/);
  assert.match(pageSource, /COMBAT_KEYWORDS\.map\(\(keyword\) => <label key=\{keyword\}><input type="checkbox"[^>]+onChange=/);
  assert.match(pageSource, /<GlossaryText text=\{profile\.description\}/);
  assert.match(pageSource, /<h3><GlossaryText text=\{group\.archetype\}/);
  assert.doesNotMatch(pageSource, /<details className="keyword-chip"/);
  assert.doesNotMatch(pageSource, /GlossaryAction|GlossaryActionText|previewTouch|tap again to choose|aria-pressed=\{selected\}|onToggle/);

  assert.match(cssSource, /\.preview-panel \{[^}]*position: fixed/);
  assert.match(cssSource, /\.preview-panel\[data-side="above"\]/);
  assert.match(cssSource, /\.glossary-preview-panel \{[^}]*white-space: normal/);
  assert.match(cssSource, /\.glossary-preview-panel:popover-open/);
  assert.match(cssSource, /\.glossary-help-trigger \{[^}]*min-height: 24px/);
  assert.match(cssSource, /\.keyword-picker label \{/);
  assert.match(cssSource, /\.keyword-picker input \{/);
  assert.doesNotMatch(cssSource, /glossary-touch-hint|glossary-action-term|keyword-option/);
});
