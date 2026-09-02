import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const exportedHtml = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");

function sourceSection(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.ok(startAt >= 0 && endAt > startAt, `Expected source section ${start} … ${end}`);
  return source.slice(startAt, endAt);
}

test("statically exports the MTG Betafish product shell and social metadata", () => {
  const html = exportedHtml;
  assert.match(html, /<title>MTG Betafish — Commander Playtest Companion<\/title>/i);
  assert.match(html, /The table acts\./);
  assert.match(html, /Assign your combat damage/);
  assert.match(html, /Scenario library/);
  assert.match(html, /Response window open/);
  assert.match(html, /Scenario card:/);
  assert.match(html, /Poison/);
  assert.match(html, /21 or more combat damage by the same commander/);
  assert.match(html, /<meta property="og:image" content="https?:\/\/[^"<>]+\/og\.png"/);

  const encounter = html.indexOf('class="encounter-column"');
  const opponents = html.indexOf('class="rail opponents-panel"');
  const pressure = html.indexOf('class="rail pressure-panel"');
  assert.ok(encounter >= 0 && encounter < opponents && opponents < pressure, "mobile DOM order should be encounter, opponents, pressure");
});

test("event source avatar matches the opponent rail by identity", () => {
  const html = exportedHtml.replace(/<!--.*?-->/g, "");
  const source = html.match(/<p class="source"><span class="avatar (avatar-\d+)">([^<]+)<\/span> ([^<]+) takes an action<\/p>/);
  assert.ok(source, "the event should identify its source with an avatar and name");
  const rail = sourceSection(html, 'class="rail opponents-panel"', 'class="rail pressure-panel"');
  assert.ok(rail.includes(`<span class="avatar ${source[1]}">${source[2]}</span><div class="opponent-copy"><strong>${source[3]}</strong>`), "the source colour and initial must match the same opponent in the rail");
  assert.match(pageSource, /const sourceAvatarIndex = game\.opponents\.findIndex\(\(opponent\) => opponent\.id === game\.currentEvent\.sourceId\) \+ 1/);
});

test("theme colour pairs retain readable text and identifiable form fields", () => {
  const tokens = Object.fromEntries([...cssSource.matchAll(/(--[\w-]+):\s*(#[\da-f]{6}|var\(--[\w-]+\));/gi)].map((match) => [match[1], match[2]]));
  const resolve = (value) => value.startsWith("--") ? resolve(tokens[value]) : value.startsWith("var(") ? resolve(value.slice(4, -1)) : value;
  const luminance = (colour) => {
    const channels = resolve(colour).slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrast = (foreground, background) => {
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  };
  const requireContrast = (foreground, background, minimum) => {
    const ratio = contrast(foreground, background);
    assert.ok(ratio >= minimum, `${foreground} on ${background}: ${ratio.toFixed(2)}:1 must reach ${minimum}:1`);
  };
  for (const background of ["--paper", "--surface", "--surface-soft", "--accent-soft", "#f4e9e4", "#ffe9e4"]) {
    requireContrast("--ink", background, 4.5);
    requireContrast("--muted", background, 4.5);
  }
  for (const background of ["--accent", "--accent-hover", "--coral-strong"]) requireContrast("#ffffff", background, 4.5);
  for (const background of ["--ink", "--ink-soft"]) {
    requireContrast("--muted-on-dark", background, 4.5);
    requireContrast("--accent-light", background, 4.5);
  }
  requireContrast("--accent", "--accent-soft", 4.5);
  for (const background of ["--paper", "--surface", "#fff7f3"]) requireContrast("--control-line", background, 3);
  assert.match(cssSource, /\.bracket-guide > \.eyebrow \{ color: var\(--muted-on-dark\); \}/);
  assert.match(cssSource, /\.countdown\.imminent \{ background: var\(--coral-strong\); \}/);
  assert.match(sourceSection(cssSource, ".damage-inputs input, .settings-body input", ".damage-inputs input:focus"), /border: 1px solid var\(--control-line\)/);
  assert.match(cssSource, /\.toxic-payment input, \.correction-form input \{[^}]*border: 1px solid var\(--control-line\)/);
});

test("game-over recovery preserves the expired round event, undo, correction, and explicit answer total", () => {
  const continuation = sourceSection(pageSource, "function continueAfterGameOver()", "function adjustLife(");
  assert.match(continuation, /eventCounter = addSafeInteger\(previous\.eventCounter, 1\)/);
  assert.match(continuation, /currentEvent: generateEvent\(\{[\s\S]*?turn: previous\.turn,/);
  assert.match(continuation, /signatureFollowUp: signatureFollowUpFor\(previous\)/);
  assert.match(continuation, /responseStage: "prompt"/);

  const terminal = sourceSection(pageSource, "{game.gameOver && !activeModal && (", "</main>");
  assert.match(terminal, /onClose=\{continueAfterGameOver\}/);
  assert.match(terminal, /!tableDefeated && !userDefeated && <button[^>]+onClick=\{continueAfterGameOver\}>Continue anyway<\/button>/);
  assert.doesNotMatch(terminal, /Continue — an effect prevents this loss/);
  assert.match(terminal, /correct the affected player/);
  assert.match(terminal, /onClick=\{\(\) => openCorrection\(terminalCorrectionTarget\)\}>Correct tracked totals/);
  assert.match(terminal, /\{canUndo && <button[^>]+onClick=\{undo\}>Undo last change<\/button>\}/);
  assert.match(terminal, /<b>\{game\.answeredCount\}<\/b> threats\/actions answered/);
  assert.doesNotMatch(pageSource, /game\.history\.filter\([^\n]+answered/);

  const hydration = sourceSection(pageSource, "// Persistence is best-effort", "// Move focus only");
  assert.match(hydration, /readStoredSession\(saved\)/);
  assert.match(hydration, /window\.localStorage\.removeItem\(STORAGE_KEY\)/);
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
  assert.match(settings, /signatureFollowUp: signatureFollowUpFor\(previous\)/);
  assert.match(settings, /tags: \["Follow-up action", \.\.\.generatedEvent\.tags\]/);
  assert.doesNotMatch(settings, /title: `Follow-up action:/);
  assert.match(incoming, /combatResolvedTurn: previous\.turn/);
  assert.doesNotMatch(hydration, /parsed\.currentEvent\.kind === "attack"/);
  assert.match(hydration, /readStoredSession\(saved\)/);
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
  assert.match(presentation, /signature: \{ label: "Signature card encounter"/);
  assert.doesNotMatch(lookup, /kind === "development"/);
  assert.match(encounter, /game\.currentEvent\.kind === "development" \|\| game\.currentEvent\.kind === "signature"[^\n]+<CardPreview name=\{game\.currentEvent\.card\} \/>/);
});

test("recorded signature-card reveals feed every next-event generation path exactly once", () => {
  const helper = sourceSection(pageSource, "function signatureFollowUpFor", "const EVENT_PRESENTATION");
  assert.match(helper, /event\.kind === "development"/);
  const advance = sourceSection(pageSource, "function advanceTurn()", "function continueAfterGameOver()");
  const continuation = sourceSection(pageSource, "function continueAfterGameOver()", "function adjustLife(");
  const settings = sourceSection(pageSource, "function saveSettings()", "function openCombat()");

  assert.match(helper, /event\.templateId === SIGNATURE_REVEAL_TEMPLATE_ID/);
  assert.match(helper, /state\.responseStage === "resolved"/);
  assert.match(helper, /profile: source\.profile, bracket: source\.bracket/);
  assert.doesNotMatch(helper, /SIGNATURE_USE_TEMPLATE_ID/);
  for (const source of [advance, continuation, settings]) {
    assert.match(source, /signatureFollowUp: signatureFollowUpFor\(previous\)/);
  }
});

test("ongoing loss protection is initialized, persisted, rechecked, and explicitly ended", () => {
  const initial = sourceSection(pageSource, "const DEFAULT_OPPONENTS", "function historyEntry");
  const incoming = sourceSection(pageSource, "function applyIncoming(", "function submitIncomingDamage(");
  const outgoing = sourceSection(pageSource, "function applyOutgoingDamage(", "function undo()");
  const advance = sourceSection(pageSource, "function advanceTurn()", "function continueAfterGameOver()");
  const ending = sourceSection(pageSource, "function endLossProtection(", "function submitCorrection(");

  assert.match(initial, /lossProtected: false/);
  assert.match(initial, /userLossProtected: false/);
  assert.match(incoming, /lossProtected = game\.userLossProtected/);
  assert.match(incoming, /userLossProtected: lossProtected/);
  assert.match(incoming, /evaluateTrackedLoss\(\{ life: result\.life, poisonCounters: result\.poisonCounters, commanderDamage: result\.commanderDamage \}, lossProtected\)/);
  assert.match(outgoing, /evaluateTrackedLoss\(\{ life: result\.life, poisonCounters: result\.poisonCounters, commanderDamage: result\.commanderDamage \}, lossProtected\)/);
  assert.match(advance, /previous\.userLossProtected/);
  assert.match(advance, /opponent\.lossProtected/);
  assert.match(ending, /userLossProtected: false/);
  assert.match(ending, /lossProtected: false/);
  assert.match(ending, /sourceEliminated = targetEliminated && previous\.responseStage !== "resolved"/);
  assert.match(pageSource, /name="incoming-loss-protected"[^>]+defaultChecked=\{game\.userLossProtected\}/);
  assert.match(pageSource, /name="outgoing-loss-protected"[^>]+defaultChecked=/);
  assert.match(pageSource, />End effect<\/button>/);
  assert.doesNotMatch(pageSource, /loss-prevented|lossPrevented/);
});

test("exact corrections restore safe players and keep every commander identity editable", () => {
  const correction = sourceSection(pageSource, "function submitCorrection(", "function stopThreat()");
  const modal = sourceSection(pageSource, '{activeModal === "totals"', '{activeModal === "reset"');

  assert.match(correction, /safeIntegerFromForm\(data, "correction-life"/);
  assert.match(correction, /damageFromForm\(data, "correction-poison"/);
  assert.match(correction, /correction-commander-\$\{encodeURIComponent\(id\)\}/);
  assert.match(correction, /data\.get\("correction-restore"\) === "on"/);
  assert.match(correction, /const userLoss = trackedLossReason\("You"/);
  assert.match(correction, /gameOver: tableDefeated \? "You eliminated every simulated opponent\." : userLoss/);
  assert.match(correction, /sourceEliminated \? \[historyEntry\(previous, "Pending action cancelled", sourceResolution, "neutral"\)\] : \[\]/);
  assert.match(modal, /Commander damage by original commander/);
  assert.match(modal, /name="correction-loss-protected"/);
  assert.match(modal, /name="correction-restore"/);
  assert.match(pageSource, /\{game\.gameOver && !activeModal && \(/);
  assert.match(pageSource, /id="tracked-player-user" tabIndex=\{-1\}/);
});

test("combat editor exposes optional ordered steps and unique original commander slots", () => {
  const parser = sourceSection(pageSource, "function stepsFromForm(", "function zeroCombatSteps(");
  const fields = sourceSection(pageSource, "function CombatDamageStepFields(", "export default function Home()");
  const addAttacker = sourceSection(pageSource, "function addOutgoingAttacker(", "function removeOutgoingAttacker(");

  assert.match(parser, /\["first", "regular"\][\s\S]*?filter\(\(step\) => data\.get\(damageStepEnabledName/);
  assert.match(fields, /\(\["first", "regular"\] as const\)\.map/);
  assert.match(sourceSection(fields, "<legend>", "</legend>"), /type="checkbox" checked=\{enabled\}/);
  assert.match(fields, /<fieldset className="damage-step" disabled=\{!enabled\}>\s*<legend>/);
  assert.match(cssSource, /\.damage-step:disabled \.damage-inputs\s*\{/);
  assert.match(addAttacker, /usedCommanderSlots\.has\(attackerCommanderSlot\)/);
  assert.match(addAttacker, /USER_COMMANDER_LABELS\[userCommanderKey\(attackerCommanderSlot\)\]/);
  assert.match(pageSource, /Your primary commander<\/option>/);
  assert.match(pageSource, /Your partner commander<\/option>/);
  assert.match(pageSource, /const incomingCommanderLabels = \{[\s\S]*?Object\.fromEntries[\s\S]*?\.\.\.USER_COMMANDER_LABELS,[\s\S]*?\.\.\.opponentCommanderLabels,/);
  assert.match(pageSource, /incomingCommanderLabels\[attacker\.commanderId \?\? ""\] \?\? attacker\.commanderLabel/);
  assert.equal((pageSource.match(/<CommanderLedger damage=\{[^}]+\} labels=\{incomingCommanderLabels\}/g) ?? []).length, 2);
  assert.match(pageSource, /name="incoming-answered"/);
});

test("local persistence uses revision envelopes, raw legacy reads, and explicit conflict choices", () => {
  const persistence = sourceSection(pageSource, "// Persistence is best-effort", "// Move focus only");
  const startRun = sourceSection(pageSource, "function startRun(", "function startSeededRun()");

  assert.match(persistence, /const serialized = serializeGameState\(game\)/);
  assert.match(persistence, /const currentSerialization = serializeGameState\(gameRef\.current\)/);
  assert.match(persistence, /hasCompetingStoredSession\(stored, storageRevision\.current, savedSerialization\.current\)/);
  assert.match(persistence, /stored\.revision === storageRevision\.current && stored\.serialized === savedSerialization\.current/);
  assert.match(persistence, /nextStorageRevision\(storageRevision\.current\)[\s\S]*?writeStoredSession\(window\.localStorage/);
  assert.match(persistence, /decideStorageEvent\(event\.newValue, window\.localStorage\.getItem\(STORAGE_KEY\)\)/);
  assert.match(persistence, /setStorageConflict\(stored\)/);
  assert.match(sourceSection(pageSource, "function loadSavedConflict()", "function keepLocalConflict()"), /newestStoredSession\(selected, raw\)[\s\S]*?currentStored \? selected\.serialized : ""/);
  assert.match(sourceSection(pageSource, "function keepLocalConflict()", "// Move focus only"), /nextStorageRevision\(storageRevision\.current, storageConflict\.revision, stored\?\.revision \?\? 0\)/);
  assert.equal((sourceSection(pageSource, "function loadSavedConflict()", "// Move focus only").match(/encounterHeading\.current\?\.focus\(\)/g) ?? []).length, 2);
  assert.match(pageSource, /const storageConflictNotice = storageConflict \?/);
  assert.match(pageSource, /\{!hasOpenDialog && storageConflictNotice\}/);
  assert.equal((pageSource.match(/\{storageConflictNotice\}/g) ?? []).length, 6);
  assert.match(pageSource, />Load saved version<\/button>/);
  assert.match(pageSource, />Keep this tab<\/button>/);
  assert.match(startRun, /createInitialGame\(seed, opponents\.map/);
  assert.match(startRun, /life: 40,[\s\S]*?poisonCounters: 0,[\s\S]*?commanderDamage: \{\},[\s\S]*?lossProtected: false,[\s\S]*?eliminated: false/);
  assert.match(startRun, /undoStack\.current = \[\]/);
  assert.match(startRun, /gameRef\.current = next[\s\S]*?setGame\(next\)[\s\S]*?setActiveModal\(null\)/);
  assert.match(pageSource, />Start new run with this seed/);
});

test("state replacement clears Toxic input and table edits retain commander identity clarity", () => {
  const commanderGuard = sourceSection(pageSource, "function hasTrackedCommanderDamageFromRemovedOpponent", "function trackedLossReason");
  const loadConflict = sourceSection(pageSource, "function loadSavedConflict()", "function keepLocalConflict()");
  const saveSettings = sourceSection(pageSource, "function saveSettings()", "function startRun(");
  const startRun = sourceSection(pageSource, "function startRun(", "function startSeededRun()");
  const seededRun = sourceSection(pageSource, "function startSeededRun()", "function openCombat()");
  const reset = sourceSection(pageSource, "function resetSession()", "const maxUserCommanderDamage");

  assert.match(commanderGuard, /opponentCommanderKey\(opponent\.id\), opponentCommanderKey\(opponent\.id, "partner"\)/);
  assert.match(commanderGuard, /retainedLedgers\.some\(\(ledger\) => \(ledger\[commanderId\] \?\? 0\) > 0\)/);
  assert.match(saveSettings, /hasTrackedCommanderDamageFromRemovedOpponent\(game, opponents\)/);
  assert.match(saveSettings, /Use Start new run with this seed to remove them without losing the original commander identity/);
  assert.doesNotMatch(saveSettings, /startRun\(/);
  assert.match(seededRun, /configuredSettingsOpponents\(\)[\s\S]*?if \(!configured\) return;[\s\S]*?startRun\(settingsSeed\.trim\(\) \|\| "GILDED-732", configured\)/);
  assert.match(reset, /startRun\(`CAST-\$\{Date\.now\(\)\.toString\(36\)\.slice\(-6\)\.toUpperCase\(\)\}`, game\.opponents\)/);

  for (const replacement of [loadConflict, saveSettings, startRun]) {
    assert.match(replacement, /setToxicPaymentDraft\(\{ eventId: "", value: "0" \}\)/);
    assert.match(replacement, /setToxicPaymentError\(""\)/);
  }
});

test("tracked scenario outcomes and player-facing round language match the simulator contract", () => {
  const accounting = sourceSection(pageSource, "function readToxicPayment(", "function letEventResolve()");
  const resolution = sourceSection(pageSource, "function letEventResolve()", "function answerEvent(");
  const answering = sourceSection(pageSource, "function answerEvent(", "function applyIncoming(");
  const settings = sourceSection(pageSource, "function configuredSettingsOpponents()", "function saveSettings()");

  assert.match(resolution, /event\.templateId === "early-rock"[\s\S]*?userLife: addSafeInteger\(previous\.userLife, 4\)/);
  assert.match(accounting, /toxicPaymentDraft\.eventId === event\.id/);
  assert.match(accounting, /const life = addSafeInteger\(opponent\.life, -amount\)/);
  assert.match(accounting, /function recordEmptyOutcome\(\)[\s\S]*?"minus-wipe"[\s\S]*?"remove-engine"[\s\S]*?sourceLifeLossPatch/);
  assert.match(accounting, /function beginResponse\(\)[\s\S]*?readToxicPayment\(event\)[\s\S]*?sourceLifeLossPatch[\s\S]*?responseStage: sourceEliminated \? "resolved" : "choose"/);
  assert.match(accounting, /function resolveToxicFromPrompt\([\s\S]*?sourceEliminated[\s\S]*?spell was removed from the stack/);
  assert.match(resolution, /event\.templateId === "remove-engine" \|\| event\.templateId === "minus-wipe"/);
  assert.match(resolution, /paymentAlreadyRecorded/);
  assert.doesNotMatch(answering, /readToxicPayment\(event\)/);
  assert.match(answering, /Toxic Deluge’s \$\{lockedToxicPayment\}-life casting cost was already recorded/);
  assert.match(answering, /event\.templateId === "remove-engine" && answer === "redirect"/);
  assert.match(pageSource, /Owner: \{activeThreatOwner\.name\}/);
  assert.match(settings, /new Set\(normalizedNames\)\.size !== normalizedNames\.length/);
  assert.match(pageSource, /Scenario card:/);
  assert.match(pageSource, />Generated action does not affect me<\/button>/);
  assert.match(pageSource, /game\.currentEvent\.templateId === "minus-wipe" && game\.responseStage === "prompt"/);
  assert.match(pageSource, /className="toxic-payment-locked"[\s\S]*?casting cost is paid and locked/);
  assert.match(pageSource, /id="toxic-payment-error" role="alert"/);
  assert.match(pageSource, />Next round /);
  assert.match(pageSource, /Round \{entry\.turn\}/);
  assert.doesNotMatch(pageSource, />Next turn |Rules reference:|Curated rules-reference library/);
});

test("accessible client contracts use one game-over announcement and native combat semantics", () => {
  assert.match(pageSource, /className="storage-conflict" role="alert" aria-labelledby="storage-conflict-title"/);
  assert.match(pageSource, /id="storage-conflict-title" ref=\{storageConflictHeading\} tabIndex=\{-1\}/);
  assert.match(pageSource, /aria-live="polite" aria-atomic="true">\{game\.gameOver \? "" : liveMessage\}/);
  assert.equal(pageSource.match(/subtitle=\{game\.gameOver\}/g)?.length ?? 0, 1);
  assert.doesNotMatch(pageSource, /className="resolved-box" role="status"/);
  assert.doesNotMatch(pageSource, /className=\{`defense-result \$\{defense\.type\}`\} role="status"/);
  assert.equal(pageSource.match(/<span aria-live="polite" aria-atomic="true">Poison/g)?.length ?? 0, 2);
  assert.match(pageSource, /className="secondary-wide" type="button" onClick=\{openCombat\}/);
  assert.match(pageSource, /className="link-button top-action" type="button" onClick=\{openSettings\}/);
  const counterback = sourceSection(pageSource, '{game.responseStage === "counterback"', '{game.responseStage === "prompt" && game.currentEvent.kind === "attack"');
  assert.match(counterback, /onClick=\{\(\) => answerEvent\("counter"\)\}>I counter again/);
  assert.match(counterback, /onClick=\{letEventResolve\}>Let the original resolve/);
  assert.match(counterback, /responseOptions\.filter\(\(option\) => option !== "counter"\)/);
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
  assert.ok(nextAction >= 0 && nextAction < opponents, "Next round should precede the naturally stacked opponent rail");
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
  assert.match(cssSource, /\[tabindex="-1"\] \{ scroll-margin-block: 96px 24px; \}/);
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
