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
  assert.match(html, /Response window open/);
  assert.match(html, /Rules reference:/);
  assert.match(html, /Poison/);
  assert.match(html, /21 or more combat damage by the same commander/);
  assert.match(html, /https:\/\/mtg-betafish\.example\/og\.png/);

  const encounter = html.indexOf('class="encounter-column"');
  const opponents = html.indexOf('class="rail opponents-panel"');
  const pressure = html.indexOf('class="rail pressure-panel"');
  assert.ok(encounter >= 0 && encounter < opponents && opponents < pressure, "mobile DOM order should be encounter, opponents, pressure");
});

test("game-over recovery preserves the expired turn event, undo, and explicit answer total", () => {
  const continuation = sourceSection(pageSource, "function continueAfterGameOver()", "function adjustLife(");
  assert.match(continuation, /eventCounter = addSafeInteger\(previous\.eventCounter, 1\)/);
  assert.match(continuation, /currentEvent: generateEvent\(\{[\s\S]*?turn: previous\.turn,/);
  assert.match(continuation, /responseStage: "prompt"/);

  const terminal = sourceSection(pageSource, "{game.gameOver && (", "</main>");
  assert.match(terminal, /onClose=\{continueAfterGameOver\}/);
  assert.match(terminal, /!tableDefeated && !userDefeated && <button[^>]+onClick=\{continueAfterGameOver\}>Continue anyway<\/button>/);
  assert.doesNotMatch(terminal, /Continue — an effect prevents this loss/);
  assert.match(terminal, /resubmit the damage with the loss-prevention override so every ordered damage step is applied/);
  assert.match(terminal, /\{canUndo && <button[^>]+onClick=\{undo\}>Undo last change<\/button>\}/);
  assert.match(terminal, /<b>\{game\.answeredCount\}<\/b> threats\/actions answered/);
  assert.doesNotMatch(pageSource, /game\.history\.filter\([^\n]+answered/);

  const hydration = sourceSection(pageSource, "// Persistence is best-effort", "// Move focus only");
  assert.match(hydration, /decodeGameState\(JSON\.parse\(saved\)\)/);
  assert.match(hydration, /if \(!decoded\) window\.localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(pageSource, /resolveEvent\("Action answered", labels\[answer\], "success", \{\}, true\)/);
  assert.match(pageSource, /applyIncoming\(zeroCombatSteps\(incomingDamageSteps\), "Combat prevented", true\)/);
  assert.match(sourceSection(pageSource, "function stopThreat()", "function delayThreat()"), /answeredCount: addSafeInteger\(previous\.answeredCount, 1\)/);
  assert.match(sourceSection(pageSource, "function answerDefense()", "function applyOutgoingDamage("), /setDefenseAnswered\(true\)/);
  assert.match(sourceSection(pageSource, "function applyOutgoingDamage(", "function undo()"), /answeredCount: addSafeInteger\(previous\.answeredCount, Number\(defenseAnswered\)\)/);
});

test("resolved table settings allow follow-ups while preserving the combat lock", () => {
  const settings = sourceSection(pageSource, "function saveSettings()", "function openCombat()");
  const incoming = sourceSection(pageSource, "function applyIncoming(", "function submitIncomingDamage(");
  const hydration = sourceSection(pageSource, "// Persistence is best-effort", "// Move focus only");

  assert.match(settings, /const isFollowUp = previous\.responseStage === "resolved"/);
  assert.match(settings, /const generatedEvent = generateEvent\(\{/);
  assert.match(settings, /combatResolvedTurn: previous\.combatResolvedTurn/);
  assert.match(settings, /title: `Follow-up action:/);
  assert.match(incoming, /combatResolvedTurn: previous\.turn/);
  assert.doesNotMatch(hydration, /parsed\.currentEvent\.kind === "attack"/);
  assert.match(hydration, /decodeGameState\(JSON\.parse\(saved\)\)/);
});

test("table settings expose the selected profile and bracket core", () => {
  const settings = sourceSection(pageSource, '<Modal title="Set up the table"', '{activeModal === "combat"');

  assert.match(settings, /const coreCards = profile\.coreCards\[bracket\]/);
  assert.match(settings, /<strong>B\{bracket\} core cards:<\/strong> \{coreCards\.map/);
  assert.match(settings, /GAME_CHANGER_CARDS\.has\(card\)/);
  assert.match(settings, /possible matchup sightings; not a complete decklist or guaranteed draw/);
  assert.match(settings, /bracket: Number\(event\.target\.value\) as CommanderBracket/);
  assert.doesNotMatch(settings, /guaranteedCards/);
});

test("signature-card reveals expose the exact card through the shared preview", () => {
  const presentation = sourceSection(pageSource, "const EVENT_PRESENTATION", "const GLOSSARY_MATCHES");
  const lookup = sourceSection(pageSource, "const eventCardLookup", "const canUndo");
  const encounter = sourceSection(pageSource, '<article className={`encounter-card', '<div className="tag-row">');

  assert.match(presentation, /development: \{ label: "Signature card reveal"/);
  assert.doesNotMatch(lookup, /kind === "development"/);
  assert.match(encounter, /game\.currentEvent\.kind === "development"[^\n]+<strong>Signature card:<\/strong> <CardPreview name=\{game\.currentEvent\.card\} \/>/);
});

test("accessible client contracts use one game-over announcement and native combat semantics", () => {
  assert.equal(pageSource.match(/role="alert"/g)?.length ?? 0, 0);
  assert.match(pageSource, /aria-live="polite" aria-atomic="true">\{game\.gameOver \? "" : liveMessage\}/);
  assert.equal(pageSource.match(/subtitle=\{game\.gameOver\}/g)?.length ?? 0, 1);
  assert.doesNotMatch(pageSource, /className="resolved-box" role="status"/);
  assert.doesNotMatch(pageSource, /className=\{`defense-result \$\{defense\.type\}`\} role="status"/);
  assert.equal(pageSource.match(/<span aria-live="polite" aria-atomic="true">Poison/g)?.length ?? 0, 2);
  assert.match(pageSource, /className="secondary-wide" type="button" onClick=\{openCombat\}/);
  assert.match(pageSource, /className="link-button top-action" type="button" onClick=\{openSettings\}/);
  assert.match(sourceSection(pageSource, '{game.responseStage === "counterback"', '{game.responseStage === "combat"'), /\{canCounterAgain && <button[\s\S]*?I counter again/);
  assert.match(pageSource, /className="resolved-mark" aria-hidden="true"/);
  assert.match(pageSource, /className="empty-threat"><span aria-hidden="true"/);
  assert.match(pageSource, /className=\{`history-dot \$\{entry\.tone\}`\} aria-hidden="true"/);
  const modal = sourceSection(pageSource, "function Modal(", "function KeywordChip(");
  assert.match(modal, /modal\.oncancel = handleCancel/);
  assert.doesNotMatch(modal, /addEventListener\("cancel"/);
  assert.doesNotMatch(modal, /addEventListener\("keydown"/);
  assert.match(modal, /returnFocus\?\.focus\(\)/);

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

test("mobile turn flow keeps context, existing controls, and touch targets reachable", () => {
  const focusFlow = sourceSection(pageSource, "const encounterHeading", "function commit(");
  assert.match(focusFlow, /const previousEventKey = useRef\(`\$\{game\.seed\}:\$\{game\.eventCounter\}`\)/);
  assert.match(focusFlow, /if \(previousEventKey\.current !== eventKey\) encounterHeading\.current\?\.focus\(\)/);
  assert.match(focusFlow, /else if \(previousResponseStage\.current !== game\.responseStage\) responseStep\.current\?\.focus\(\)/);
  assert.match(pageSource, /<h1 id="encounter-title" ref=\{encounterHeading\} tabIndex=\{-1\}>/);

  const nextAction = pageSource.indexOf('className="next-action"');
  const opponents = pageSource.indexOf('className="rail opponents-panel"');
  assert.ok(nextAction >= 0 && nextAction < opponents, "Next turn should precede the naturally stacked opponent rail");
  const header = sourceSection(pageSource, '<header className="topbar">', "</header>");
  const opponentRail = sourceSection(pageSource, '<aside className="rail opponents-panel"', "</aside>");
  const pressureRail = sourceSection(pageSource, '<aside className="rail pressure-panel"', "</aside>");
  assert.match(header, /game\.activeThreat\.remaining/);
  assert.match(header, /onClick=\{openSettings\}/);
  assert.match(opponentRail, /game\.userLife/);
  assert.match(opponentRail, /game\.userPoisonCounters/);
  assert.match(opponentRail, /onClick=\{openCombat\}/);
  assert.match(pressureRail, /game\.activeThreat\.remaining/);
  assert.doesNotMatch(pageSource, /mobile-turn-summary/);

  const touchStyles = sourceSection(cssSource, "@media (max-width: 900px), (pointer: coarse)", "@media (max-width: 820px)");
  const mobileStyles = sourceSection(cssSource, "@media (max-width: 820px)", "@media (max-width: 520px)");
  assert.match(mobileStyles, /\.workspace \{[^}]*display: flex; flex-direction: column/);
  assert.doesNotMatch(cssSource, /\.mobile-turn-summary/);
  assert.match(touchStyles, /\.life-control > button \{[^}]*width: 44px; height: 44px/);
  assert.match(touchStyles, /\.poison-control button \{[^}]*width: 44px; height: 44px/);
  assert.match(touchStyles, /\.outgoing-list > article > button \{[^}]*width: 44px; height: 44px/);
  assert.match(touchStyles, /\.glossary-help-trigger[^\n]+min-width: 44px; min-height: 44px/);
  assert.match(touchStyles, /\.damage-inputs input[^\n]+font-size: 16px/);
  assert.doesNotMatch(cssSource, /html\s*\{[^}]*\bmin-width\s*:/);
  assert.match(cssSource, /\.outgoing-list article \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(cssSource, /\.history li \{[^}]*grid-template-columns: 32px minmax\(0, 1fr\)/);

  const phoneStyles = sourceSection(cssSource, "@media (max-width: 520px)", "@media (max-width: 460px)");
  assert.match(phoneStyles, /\.modal \{[^}]*width: 100%; max-width: none/);
  assert.match(phoneStyles, /\.modal \{[^}]*max-height: 94dvh/);
  assert.match(phoneStyles, /\.spell-art \{ height: 84px; \}/);
  assert.match(cssSource, /\.modal \{[^}]*max-height: calc\(100dvh - 48px\)/);
  assert.match(cssSource, /\.modal \{[^}]*overflow-wrap: anywhere/);
  assert.match(cssSource, /\.encounter-card \{[^}]*overflow-wrap: anywhere/);
  assert.match(cssSource, /\.modal > \.modal-actions \{[^}]*position: sticky;[^}]*env\(safe-area-inset-bottom\)/);
});

test("glossary previews stay separate from one-click game actions", () => {
  const cardPreview = sourceSection(pageSource, "function CardPreview(", "function GlossaryTerm(");
  const glossaryTerm = sourceSection(pageSource, "function GlossaryTerm(", "function GlossaryExplanation(");
  const glossaryHelp = sourceSection(pageSource, "function GlossaryHelp(", "function glossaryText(");
  const glossaryText = sourceSection(pageSource, "function glossaryText(", "function Modal(");

  assert.doesNotMatch(pageSource, /useHoverPreview|getBoundingClientRect|showPopover\(\)|hidePopover\(\)|hoverTimer/);
  assert.match(cardPreview, /const previewId = useId\(\)/);
  assert.doesNotMatch(cardPreview, /interestfor/);
  assert.match(cardPreview, /popoverTarget=\{previewId\}/);
  assert.match(cardPreview, /popoverTargetAction="toggle"/);
  assert.match(cardPreview, /scryfallImageUrl\(cardName\)/);
  assert.match(cardPreview, /loading="lazy"/);
  assert.match(cardPreview, /Card image unavailable\./);
  assert.match(cardPreview, /alt=\{`\$\{cardName\} card`\}/);
  assert.match(cardPreview, /role="tooltip" popover="auto"/);
  assert.match(glossaryTerm, /const previewId = useId\(\)/);
  assert.doesNotMatch(glossaryTerm, /interestfor/);
  assert.match(glossaryTerm, /aria-describedby=\{previewId\}/);
  assert.match(glossaryTerm, /popoverTarget=\{previewId\}/);
  assert.match(glossaryTerm, /popoverTargetAction="toggle"/);
  assert.match(glossaryTerm, /role="tooltip"/);
  assert.match(glossaryTerm, /popover="auto"/);
  assert.match(glossaryTerm, /GLOSSARY_DEFINITIONS\[term\]/);
  assert.match(glossaryHelp, /label = "Rules help"/);
  assert.doesNotMatch(glossaryHelp, /interestfor/);
  assert.match(glossaryHelp, /popoverTarget=\{previewId\}/);
  assert.match(glossaryHelp, /popoverTargetAction="toggle"/);
  assert.match(glossaryHelp, /popover="auto"/);
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
  assert.match(pageSource, /game\.currentEvent\.responseOptions\.map\(\(option\) => <button type="button" onClick=\{\(\) => answerEvent\(option\)\}/);
  assert.match(pageSource, /<GlossaryHelp terms=\{\["Fog"\]\}/);
  assert.match(pageSource, /applyIncoming\(zeroCombatSteps\(incomingDamageSteps\), "Combat prevented", true\)/);
  assert.match(pageSource, /<CombatDamageFields prefix="incoming" steps=\{incomingDamageSteps\}/);
  assert.match(pageSource, /First-strike combat damage step/);
  assert.match(pageSource, /Poison counters added/);
  assert.match(pageSource, /Lifelink life gained/);
  assert.match(pageSource, /<GlossaryHelp label="Keyword help" terms=\{COMBAT_KEYWORDS\}/);
  assert.match(pageSource, /COMBAT_KEYWORDS\.map\(\(keyword\) => <label key=\{keyword\}><input type="checkbox"[^>]+onChange=/);
  assert.match(pageSource, /<GlossaryText text=\{profile\.description\}/);
  assert.match(pageSource, /<h3><GlossaryText text=\{group\.archetype\}/);
  assert.doesNotMatch(pageSource, /<details className="keyword-chip"/);
  assert.doesNotMatch(pageSource, /GlossaryAction|GlossaryActionText|previewTouch|tap again to choose|aria-pressed=\{selected\}|onToggle/);

  assert.doesNotMatch(cssSource, /interest-delay/);
  assert.match(cssSource, /\.preview-panel \{[^}]*position: fixed;[^}]*position-area: bottom;[^}]*position-try-fallbacks: flip-block/);
  assert.doesNotMatch(cssSource, /preview-panel\[data-side|getBoundingClientRect/);
  assert.match(cssSource, /\.glossary-preview-panel \{[^}]*white-space: normal/);
  assert.match(cssSource, /\.glossary-preview-panel:popover-open/);
  assert.match(cssSource, /\.glossary-help-trigger \{[^}]*min-height: 24px/);
  assert.match(cssSource, /\.keyword-picker label \{/);
  assert.match(cssSource, /\.keyword-picker input \{/);
  assert.doesNotMatch(cssSource, /glossary-touch-hint|glossary-action-term|keyword-option/);
});
