"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import {
  buildDefaultCombatDamageSteps,
  CARD_LIBRARY,
  CARD_LIBRARY_UPDATED,
  COMMANDER_BRACKETS,
  counterBacks,
  DECK_PROFILES,
  GAME_CHANGER_CARDS,
  generateEvent,
  GLOSSARY_DEFINITIONS,
  nonnegativeSafeInteger,
  normalizeCommanderBracket,
  opponentCommanderKey,
  PROFILE_LABELS,
  resolveCombatDamage,
  rollDefense,
  SIGNATURE_REVEAL_TEMPLATE_ID,
  userCommanderKey,
  type Attacker,
  type CombatDamageStep,
  type CommanderBracket,
  type CommanderSlot,
  type DefenseResult,
  type GlossaryKey,
  type Keyword,
  type Opponent,
  type ProfileId,
  type ResponseOption,
  type SignatureFollowUp,
  type SimEvent,
} from "./simulator";
import {
  decodeGameState,
  GAME_STATE_VERSION,
  type GameState,
  type HistoryEntry,
  type HistoryTone,
} from "./session";
import { scryfallImageUrl } from "./scryfall";

type OutgoingAttacker = {
  id: string;
  name: string;
  power: number;
  isCommander: boolean;
  commanderSlot?: CommanderSlot;
  keywords: Keyword[];
};

// Keep the legacy key so existing saved sessions survive the product rename.
const STORAGE_KEY = "goldfish-lab-session-v1";
const COMBAT_KEYWORDS: Keyword[] = ["Flying", "Trample", "Menace", "Deathtouch", "First strike", "Double strike", "Lifelink", "Infect"];
const USER_COMMANDER_LABELS = {
  [userCommanderKey("primary")]: "Your commander",
  [userCommanderKey("partner")]: "Your partner commander",
};

const DEFAULT_OPPONENTS: Opponent[] = [
  { id: "mara", name: "Mara", profile: "graveyard", bracket: 3, life: 40, poisonCounters: 0, commanderDamage: {}, eliminated: false },
  { id: "theo", name: "Theo", profile: "control", bracket: 4, life: 40, poisonCounters: 0, commanderDamage: {}, eliminated: false },
  { id: "ari", name: "Ari", profile: "swarm", bracket: 2, life: 40, poisonCounters: 0, commanderDamage: {}, eliminated: false },
];

function cloneOpponents(opponents: readonly Opponent[]): Opponent[] {
  return opponents.map((opponent) => ({
    ...opponent,
    bracket: normalizeCommanderBracket(opponent.bracket),
    poisonCounters: nonnegativeSafeInteger(opponent.poisonCounters) ?? 0,
    commanderDamage: { ...opponent.commanderDamage },
  }));
}

function createInitialGame(seed = "GILDED-732", opponents: readonly Opponent[] = DEFAULT_OPPONENTS): GameState {
  const safeOpponents = cloneOpponents(opponents);
  const currentEvent = generateEvent({
    turn: 1,
    counter: 1,
    seed,
    opponents: safeOpponents,
    recentTemplateIds: [],
    activeThreat: false,
    combatResolvedTurn: null,
  });
  return {
    version: GAME_STATE_VERSION,
    turn: 1,
    eventCounter: 1,
    defenseCounter: 0,
    seed,
    opponents: safeOpponents,
    userLife: 40,
    userPoisonCounters: 0,
    userCommanderDamage: {},
    currentEvent,
    responseStage: "prompt",
    resolution: "",
    activeThreat: null,
    recentTemplateIds: [],
    history: [{ id: "session-start", turn: 1, title: "Session started", detail: "The simulated table is live.", tone: "neutral" }],
    answeredCount: 0,
    combatResolvedTurn: null,
    counterExchange: 0,
    gameOver: null,
  };
}

function historyEntry(state: GameState, title: string, detail: string, tone: HistoryTone): HistoryEntry {
  return { id: crypto.randomUUID(), turn: state.turn, title, detail, tone };
}

function highestCommanderDamage(damage: Record<string, number>) {
  return Math.max(0, ...Object.values(damage));
}

function damageFromForm(data: FormData, name: string, fallback = 0) {
  return nonnegativeSafeInteger(Number(data.get(name))) ?? fallback;
}

function addSafeInteger(value: number, delta: number) {
  const result = value + delta;
  if (Number.isSafeInteger(result)) return result;
  return delta >= 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

function damageFieldName(prefix: string, step: CombatDamageStep["step"], field: "life" | "poison" | "lifelink" | "commander", commanderId = "") {
  return `${prefix}-${step}-${field}${commanderId ? `-${encodeURIComponent(commanderId)}` : ""}`;
}

function stepsFromForm(data: FormData, prefix: string, defaults: readonly CombatDamageStep[]): CombatDamageStep[] {
  return defaults.map((step) => ({
    step: step.step,
    lifeDamage: damageFromForm(data, damageFieldName(prefix, step.step, "life"), step.lifeDamage),
    poisonCounters: damageFromForm(data, damageFieldName(prefix, step.step, "poison"), step.poisonCounters),
    lifelinkGain: damageFromForm(data, damageFieldName(prefix, step.step, "lifelink"), step.lifelinkGain),
    commanderHits: Object.fromEntries(Object.keys(step.commanderHits).map((commanderId) => [
      commanderId,
      damageFromForm(data, damageFieldName(prefix, step.step, "commander", commanderId), step.commanderHits[commanderId]),
    ])),
  }));
}

function zeroCombatSteps(steps: readonly CombatDamageStep[]): CombatDamageStep[] {
  const source = steps.length ? steps : [{ step: "regular" as const, lifeDamage: 0, poisonCounters: 0, lifelinkGain: 0, commanderHits: {} }];
  return source.map((step) => ({ ...step, lifeDamage: 0, poisonCounters: 0, lifelinkGain: 0, commanderHits: Object.fromEntries(Object.keys(step.commanderHits).map((id) => [id, 0])) }));
}

function bracketLabel(value: unknown) {
  const bracket = normalizeCommanderBracket(value);
  return `B${bracket} ${COMMANDER_BRACKETS[bracket].label}`;
}

function signatureFollowUpFor(state: Pick<GameState, "currentEvent" | "responseStage">): SignatureFollowUp | null {
  const event = state.currentEvent;
  return state.responseStage === "resolved" && event.templateId === SIGNATURE_REVEAL_TEMPLATE_ID
    ? { sourceId: event.sourceId, card: event.card }
    : null;
}

const EVENT_PRESENTATION = {
  targeted: { label: "Single-target interaction", glyph: "↗" },
  wipe: { label: "Board wipe", glyph: "✺" },
  counter: { label: "Stack interaction", glyph: "↯" },
  disruption: { label: "Table disruption", glyph: "◇" },
  attack: { label: "Incoming combat", glyph: "⚔" },
  threat: { label: "Game-ending threat", glyph: "!" },
  development: { label: "Signature card reveal", glyph: "…" },
  signature: { label: "Signature card encounter", glyph: "✦" },
} satisfies Record<SimEvent["kind"], { label: string; glyph: string }>;

const RESPONSE_PRESENTATION: Record<ResponseOption, { title: string; detail: string }> = {
  counter: { title: "Counter it", detail: "The source may fight back." },
  protect: { title: "Use protection", detail: "Resolve a legal protection effect in your playtester." },
  redirect: { title: "Redirect it", detail: "Choose a new legal target." },
  custom: { title: "Other legal answer", detail: "Record the exact line in your playtester." },
};

const GLOSSARY_MATCHES = {
  ...Object.fromEntries(Object.keys(GLOSSARY_DEFINITIONS).map((term) => [term.toLowerCase(), term as GlossaryKey])),
  countered: "Counter",
  counters: "Counter",
  destroyed: "Destroy",
  destroys: "Destroy",
  exiled: "Exile",
  exiles: "Exile",
  goaded: "Goad",
  "phased out": "Phase out",
  sacrificed: "Sacrifice",
  blinked: "Blink",
  bounced: "Bounce",
} as Record<string, GlossaryKey>;
const GLOSSARY_PATTERN = new RegExp(`\\b(${Object.keys(GLOSSARY_MATCHES).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

function CardPreview({ name, lookupName = name }: { name: string; lookupName?: string | null }) {
  const previewId = useId();
  const [loadedImage, setLoadedImage] = useState<string>();
  const [failedImage, setFailedImage] = useState<string>();

  if (!lookupName) return name;
  const cardName = lookupName;
  const image = scryfallImageUrl(cardName);

  return (
    <span className="card-preview">
      <button
        className="preview-trigger card-preview-trigger"
        type="button"
        aria-describedby={previewId}
        popoverTarget={previewId}
        popoverTargetAction="toggle"
      >{name}</button>
      <span className="preview-panel card-preview-panel" id={previewId} role="tooltip" popover="auto">
        {loadedImage !== image && failedImage !== image && <span className="card-preview-status" role="status">Loading card image…</span>}
        {failedImage === image && <span className="card-preview-status" role="status">Card image unavailable.</span>}
        {/* eslint-disable-next-line @next/next/no-img-element -- render the trusted Scryfall image endpoint directly */}
        {failedImage !== image && <img className={loadedImage === image ? "" : "pending"} src={image} alt={`${cardName} card`} decoding="async" loading="lazy" onLoad={() => setLoadedImage(image)} onError={() => setFailedImage(image)} />}
      </span>
    </span>
  );
}

function GlossaryTerm({ term, children = term, className = "" }: { term: GlossaryKey; children?: React.ReactNode; className?: string }) {
  const previewId = useId();
  return (
    <span className={`glossary-preview${className ? ` ${className}` : ""}`}>
      <button
        className="preview-trigger glossary-preview-trigger"
        type="button"
        aria-describedby={previewId}
        popoverTarget={previewId}
        popoverTargetAction="toggle"
      >{children}</button>
      <span className="preview-panel glossary-preview-panel" id={previewId} role="tooltip" popover="auto">
        {GLOSSARY_DEFINITIONS[term]}
      </span>
    </span>
  );
}

function GlossaryExplanation({ terms }: { terms: readonly GlossaryKey[] }) {
  if (terms.length === 1) return GLOSSARY_DEFINITIONS[terms[0]];
  return <span className="glossary-definition-list">{terms.map((term) => <span key={term}><strong>{term}</strong><span>{GLOSSARY_DEFINITIONS[term]}</span></span>)}</span>;
}

function GlossaryHelp({ terms, label = "Rules help" }: { terms: readonly GlossaryKey[]; label?: string }) {
  const previewId = useId();
  return (
    <span className="glossary-help">
      <button
        className="preview-trigger glossary-help-trigger"
        type="button"
        aria-describedby={previewId}
        popoverTarget={previewId}
        popoverTargetAction="toggle"
      ><span aria-hidden="true">?</span> {label}</button>
      <span className="preview-panel glossary-preview-panel" id={previewId} role="tooltip" popover="auto">
        <GlossaryExplanation terms={terms} />
      </span>
    </span>
  );
}

function glossaryText(text: string, seen?: Set<GlossaryKey>) {
  return text.split(GLOSSARY_PATTERN).map((part, index) => {
    const term = GLOSSARY_MATCHES[part.toLowerCase()];
    if (!term || seen?.has(term)) return part;
    seen?.add(term);
    return <GlossaryTerm term={term} key={`${part}-${index}`}>{part}</GlossaryTerm>;
  });
}

function GlossaryText({ text }: { text: string }) {
  return glossaryText(text);
}

function Modal({ title, subtitle, onClose, children, wide = false, dismissible = true }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const handleCancel = useEffectEvent((event: Event) => { event.preventDefault(); if (dismissible) onClose(); });

  useEffect(() => {
    const modal = dialog.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modal) modal.oncancel = handleCancel;
    if (modal && !modal.open) modal.showModal();
    return () => {
      if (modal?.open) modal.close();
      returnFocus?.focus();
    };
  }, []);

  return (
    <dialog ref={dialog} className={`modal ${wide ? "modal-wide" : ""}`} aria-labelledby={titleId} aria-describedby={subtitle ? descriptionId : undefined}>
      <header className="modal-header">
        <div><span className="eyebrow">MTG Betafish</span><h2 id={titleId}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</div>
        {dismissible && <button className="icon-button" type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button>}
      </header>
      {children}
    </dialog>
  );
}

function KeywordChip({ keyword }: { keyword: Keyword }) {
  return <GlossaryTerm term={keyword} className="keyword-chip" />;
}

function CommanderLedger({ damage, labels = {}, dark = false }: { damage: Record<string, number>; labels?: Record<string, string>; dark?: boolean }) {
  const entries = Object.entries(damage).filter(([, total]) => total > 0);
  return (
    <details className={`commander-ledger ${dark ? "commander-ledger-dark" : ""}`}>
      <summary>CD {highestCommanderDamage(damage)}</summary>
      <ul>{entries.length ? entries.map(([commander, total]) => <li key={commander}><span>{labels[commander] ?? commander}</span><b>{total}/21</b></li>) : <li><span>No commander damage</span><b>0/21</b></li>}</ul>
    </details>
  );
}

function CombatDamageFields({
  prefix,
  steps,
  commanderLabels,
}: {
  prefix: string;
  steps: readonly CombatDamageStep[];
  commanderLabels: Record<string, string>;
}) {
  return (
    <div className="damage-steps">
      {steps.map((step) => (
        <fieldset className="damage-step" key={step.step}>
          <legend>{step.step === "first" ? "First-strike combat damage step" : "Regular combat damage step"}</legend>
          <div className="damage-inputs">
            <label>Life damage<input name={damageFieldName(prefix, step.step, "life")} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={step.lifeDamage} /></label>
            <label>Poison counters added<input name={damageFieldName(prefix, step.step, "poison")} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={step.poisonCounters} /></label>
            {Object.entries(step.commanderHits).map(([commanderId, damage]) => (
              <label key={commanderId}>{commanderLabels[commanderId] ?? commanderId} damage<input name={damageFieldName(prefix, step.step, "commander", commanderId)} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={damage} /></label>
            ))}
            <label>Lifelink life gained<input name={damageFieldName(prefix, step.step, "lifelink")} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={step.lifelinkGain} /></label>
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const gameRef = useRef(game);
  const [hydrated, setHydrated] = useState(false);
  const undoStack = useRef<GameState[]>([]);
  const encounterHeading = useRef<HTMLHeadingElement>(null);
  const responseStep = useRef<HTMLSpanElement>(null);
  const previousEventKey = useRef(`${game.seed}:${game.eventCounter}`);
  const previousResponseStage = useRef(game.responseStage);
  const defenseResult = useRef<HTMLDivElement>(null);
  const threatHeading = useRef<HTMLHeadingElement>(null);
  const threatAnswerButton = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const attackerNameInput = useRef<HTMLInputElement>(null);
  const outgoingList = useRef<HTMLDivElement>(null);

  const [activeModal, setActiveModal] = useState<"settings" | "library" | "combat" | "reset" | null>(null);
  const [settingsOpponents, setSettingsOpponents] = useState<Opponent[]>([]);
  const [settingsSeed, setSettingsSeed] = useState("");

  const [combatTarget, setCombatTarget] = useState("");
  const [outgoingAttackers, setOutgoingAttackers] = useState<OutgoingAttacker[]>([]);
  const [attackerName, setAttackerName] = useState("");
  const [attackerPower, setAttackerPower] = useState(1);
  const [attackerCommander, setAttackerCommander] = useState(false);
  const [attackerCommanderSlot, setAttackerCommanderSlot] = useState<CommanderSlot>("primary");
  const [attackerKeywords, setAttackerKeywords] = useState<Keyword[]>([]);
  const [defense, setDefense] = useState<DefenseResult | null>(null);
  const [defenseRollCounter, setDefenseRollCounter] = useState(0);
  const [defenseAnswered, setDefenseAnswered] = useState(false);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // Persistence is best-effort: private browsing and storage policies may disable it.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const decoded = decodeGameState(JSON.parse(saved));
        if (!decoded) window.localStorage.removeItem(STORAGE_KEY);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate client-only persisted state after mount
        else setGame(decoded);
      }
    } catch {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game)); } catch { /* Continue without persistence. */ }
  }, [game, hydrated]);

  // Move focus only when the encounter or response step changes.
  useEffect(() => {
    const eventKey = `${game.seed}:${game.eventCounter}`;
    if (previousEventKey.current !== eventKey) encounterHeading.current?.focus();
    else if (previousResponseStage.current !== game.responseStage) responseStep.current?.focus();
    previousEventKey.current = eventKey;
    previousResponseStage.current = game.responseStage;
  }, [game.eventCounter, game.responseStage, game.seed]);

  useEffect(() => {
    if (activeModal === "combat" && defense) defenseResult.current?.focus();
  }, [activeModal, defense]);

  // Keep ten reversible game states in memory; local storage only persists the current state.
  function commit(update: (previous: GameState) => GameState) {
    const previous = gameRef.current;
    const next = update(previous);
    undoStack.current = [...undoStack.current.slice(-9), previous];
    gameRef.current = next;
    setGame(next);
  }

  const sourceOpponent = game.opponents.find((opponent) => opponent.id === game.currentEvent.sourceId);
  const incomingDamageSteps = game.currentEvent.attackers
    ? buildDefaultCombatDamageSteps(game.currentEvent.attackers)
    : [];
  const incomingLifeTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, step.lifeDamage), 0);
  const incomingPoisonTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, step.poisonCounters), 0);
  const incomingCommanderTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, Object.values(step.commanderHits).reduce((subtotal, damage) => addSafeInteger(subtotal, damage), 0)), 0);
  const incomingLifelinkTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, step.lifelinkGain), 0);
  const incomingCommanderLabels = Object.fromEntries((game.currentEvent.attackers ?? [])
    .filter((attacker) => attacker.isCommander && attacker.commanderId)
    .map((attacker) => [attacker.commanderId as string, attacker.commanderLabel ?? attacker.name]));
  const livingOpponents = game.opponents.filter((opponent) => !opponent.eliminated);
  const canCounterAgain = game.currentEvent.responseOptions.includes("counter");

  function resolveEvent(title: string, detail: string, tone: HistoryTone, patch: Partial<GameState> = {}, answered = false) {
    commit((previous) => ({
      ...previous,
      ...patch,
      answeredCount: addSafeInteger(previous.answeredCount, Number(answered)),
      responseStage: "resolved",
      resolution: detail,
      history: [historyEntry(previous, title, detail, tone), ...previous.history].slice(0, 40),
    }));
  }

  function letEventResolve() {
    const event = game.currentEvent;
    if (event.kind === "attack") return;
    if (event.templateId === SIGNATURE_REVEAL_TEMPLATE_ID) {
      resolveEvent("Signature card revealed", `${event.sourceName} revealed ${event.card}. Their next generated action will use this exact card if they remain on the same profile and bracket.`, "neutral");
      return;
    }
    if (event.kind === "signature") {
      resolveEvent("Signature card used", `${event.sourceName} follows through with the previously revealed ${event.card}. Apply its printed rules text in your playtester.`, "warning");
      return;
    }
    if (event.kind === "threat" && event.threat) {
      resolveEvent("Threat established", `${event.sourceName}’s ${event.card} is now on a ${event.threat.remaining}-turn clock.`, "warning", { activeThreat: event.threat });
      return;
    }
    resolveEvent("Table action resolves", `${event.card}: apply the generated outcome in your playtester, then advance the table.`, event.kind === "wipe" ? "warning" : "damage");
  }

  function answerEvent(answer: ResponseOption) {
    const event = game.currentEvent;
    if ((game.responseStage !== "choose" && game.responseStage !== "counterback") || !event.responseOptions.includes(answer)) return;
    if (answer === "counter") {
      const profile = sourceOpponent?.profile ?? "midrange";
      const bracket = normalizeCommanderBracket(sourceOpponent?.bracket);
      const counterExchange = addSafeInteger(game.counterExchange, 1);
      if (counterBacks({
        profile,
        bracket,
        seed: game.seed,
        turn: game.turn,
        eventCounter: game.eventCounter,
        exchange: counterExchange,
      })) {
        commit((previous) => ({
          ...previous,
          responseStage: "counterback",
          counterExchange,
          resolution: "Your counter is countered. The response window remains open.",
          history: [historyEntry(previous, "Counter exchange", `${event.sourceName} counters your answer in exchange ${counterExchange}.`, "warning"), ...previous.history].slice(0, 40),
        }));
        return;
      }
      resolveEvent("Action answered", "Your counter resolves and stops the table action.", "success", { counterExchange }, true);
      return;
    }
    const labels: Record<Exclude<ResponseOption, "counter">, string> = {
      protect: "Resolve the legal protection effect you used in your playtester.",
      redirect: "You changed the target; apply the new target in your playtester.",
      custom: "You supplied another legal answer; apply its exact result in your playtester.",
    };
    resolveEvent("Action answered", event.kind === "signature" ? `${event.card}: ${labels[answer]}` : labels[answer], "success", {}, true);
  }

  function applyIncoming(steps: readonly CombatDamageStep[], label: string, answered = false, lossPrevented = false) {
    commit((previous) => {
      const result = resolveCombatDamage({
        state: {
          life: previous.userLife,
          poisonCounters: previous.userPoisonCounters,
          commanderDamage: previous.userCommanderDamage,
        },
        steps,
        lossPrevented,
      });
      const commanderDamage = result.stepsApplied.reduce((total, stepName) => {
        const step = steps.find((candidate) => candidate.step === stepName);
        return addSafeInteger(total, Object.values(step?.commanderHits ?? {}).reduce((subtotal, damage) => addSafeInteger(subtotal, damage), 0));
      }, 0);
      const sourceName = previous.currentEvent.sourceName;
      const opponents = previous.opponents.map((opponent) => opponent.id === previous.currentEvent.sourceId
        ? { ...opponent, life: addSafeInteger(opponent.life, result.lifelinkGain) }
        : opponent);
      const lossReason = result.lossReason === "life"
        ? `You reached ${result.life} life after ${sourceName}’s attack`
        : result.lossReason === "poison"
          ? `You reached ${result.poisonCounters} poison counters`
          : result.lossReason === "commander"
            ? `${incomingCommanderLabels[result.lethalCommander ?? ""] ?? result.lethalCommander ?? "A commander"} reached 21 commander damage`
            : null;
      const parts = [
        `${result.stepsApplied.map((step) => step === "first" ? "first-strike" : "regular").join(" and ") || "no"} damage step${result.stepsApplied.length === 1 ? "" : "s"} applied`,
        `${result.lifeDamage} life damage`,
        `${result.poisonAdded} poison`,
        `${commanderDamage} commander damage`,
        `${sourceName} gained ${result.lifelinkGain} life from lifelink`,
      ];
      if (lossPrevented) parts.push("a stated rule or effect prevented the normal loss for this resolution");
      if (lossReason) parts.push(lossReason);
      const detail = `${parts.join("; ")}.`;
      return {
        ...previous,
        userLife: result.life,
        userPoisonCounters: result.poisonCounters,
        userCommanderDamage: result.commanderDamage,
        opponents,
        gameOver: result.defeated && lossReason ? `${lossReason}.` : previous.gameOver,
        combatResolvedTurn: previous.turn,
        answeredCount: addSafeInteger(previous.answeredCount, Number(answered)),
        responseStage: "resolved",
        resolution: detail,
        history: [historyEntry(previous, label, detail, result.lifeDamage || result.poisonAdded || commanderDamage ? "damage" : "success"), ...previous.history].slice(0, 40),
      };
    });
  }

  function submitIncomingDamage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    applyIncoming(stepsFromForm(data, "incoming", incomingDamageSteps), "Combat resolved", false, data.get("incoming-loss-prevented") === "on");
  }

  function advanceTurn() {
    commit((previous) => {
      if (previous.opponents.every((opponent) => opponent.eliminated)) {
        return { ...previous, gameOver: "You eliminated every simulated opponent." };
      }
      const turn = addSafeInteger(previous.turn, 1);
      let activeThreat = previous.activeThreat;
      if (activeThreat) {
        activeThreat = { ...activeThreat, remaining: Math.max(0, addSafeInteger(activeThreat.remaining, -1)) };
        if (activeThreat.remaining <= 0) {
          const owner = previous.opponents.find((opponent) => opponent.id === activeThreat?.ownerId);
          const threatTitle = activeThreat.title.replace(/[.!?]+$/, "");
          const reason = `${owner?.name ?? "An opponent"} completes ${threatTitle}. The unresolved threat wins the simulated game.`;
          return {
            ...previous,
            turn,
            activeThreat,
            gameOver: reason,
            history: [historyEntry({ ...previous, turn }, "Threat triggered", reason, "warning"), ...previous.history].slice(0, 40),
          };
        }
      }
      const recentTemplateIds = [previous.currentEvent.templateId, ...previous.recentTemplateIds].slice(0, 3);
      const eventCounter = addSafeInteger(previous.eventCounter, 1);
      const currentEvent = generateEvent({
        turn,
        counter: eventCounter,
        seed: previous.seed,
        opponents: previous.opponents,
        recentTemplateIds,
        activeThreat: Boolean(activeThreat),
        combatResolvedTurn: previous.combatResolvedTurn,
        signatureFollowUp: signatureFollowUpFor(previous),
      });
      return {
        ...previous,
        turn,
        eventCounter,
        currentEvent,
        responseStage: "prompt",
        resolution: "",
        counterExchange: 0,
        activeThreat,
        recentTemplateIds,
      };
    });
  }

  function continueAfterGameOver() {
    setGame((previous) => {
      if (!previous.activeThreat || previous.activeThreat.remaining > 0) return { ...previous, gameOver: null };
      const recentTemplateIds = [previous.currentEvent.templateId, ...previous.recentTemplateIds].slice(0, 3);
      const eventCounter = addSafeInteger(previous.eventCounter, 1);
      return {
        ...previous,
        gameOver: null,
        activeThreat: null,
        eventCounter,
        recentTemplateIds,
        currentEvent: generateEvent({
          turn: previous.turn,
          counter: eventCounter,
          seed: previous.seed,
          opponents: previous.opponents,
          recentTemplateIds,
          activeThreat: false,
          combatResolvedTurn: previous.combatResolvedTurn,
          signatureFollowUp: signatureFollowUpFor(previous),
        }),
        responseStage: "prompt",
        resolution: "",
        counterExchange: 0,
      };
    });
  }

  function adjustPlayerStat(target: "user" | string, stat: "life" | "poison", amount: number) {
    commit((previous) => {
      if (target === "user") {
        if (stat === "life") {
          const userLife = addSafeInteger(previous.userLife, amount);
          return { ...previous, userLife, gameOver: userLife <= 0 ? `You reached ${userLife} life.` : previous.gameOver };
        }
        const userPoisonCounters = Math.max(0, addSafeInteger(previous.userPoisonCounters, amount));
        return { ...previous, userPoisonCounters, gameOver: userPoisonCounters >= 10 ? `You reached ${userPoisonCounters} poison counters.` : previous.gameOver };
      }

      const opponents = previous.opponents.map((opponent) => {
        if (opponent.id !== target) return opponent;
        const life = stat === "life" ? addSafeInteger(opponent.life, amount) : opponent.life;
        const poisonCounters = stat === "poison" ? Math.max(0, addSafeInteger(opponent.poisonCounters, amount)) : opponent.poisonCounters;
        const commanderDefeated = Object.values(opponent.commanderDamage).some((damage) => damage >= 21);
        const defeated = stat === "life" ? life <= 0 || poisonCounters >= 10 || commanderDefeated : poisonCounters >= 10;
        return { ...opponent, life, poisonCounters, eliminated: opponent.eliminated || defeated };
      });
      const targetEliminated = opponents.find((opponent) => opponent.id === target)?.eliminated;
      const activeThreat = targetEliminated && previous.activeThreat?.ownerId === target ? null : previous.activeThreat;
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const sourceEliminated = previous.responseStage !== "resolved" && opponents.some((opponent) => opponent.id === previous.currentEvent.sourceId && opponent.eliminated);
      const sourceResolution = `${previous.currentEvent.sourceName} left the game, so their pending action was removed from the stack or combat.`;
      return {
        ...previous,
        opponents,
        activeThreat,
        gameOver: tableDefeated ? "You eliminated every simulated opponent." : previous.gameOver,
        ...(sourceEliminated ? {
          responseStage: "resolved" as const,
          resolution: sourceResolution,
          history: [historyEntry(previous, "Pending action cancelled", sourceResolution, "neutral"), ...previous.history].slice(0, 40),
        } : {}),
      };
    });
  }

  function adjustLife(target: "user" | string, amount: number) {
    adjustPlayerStat(target, "life", amount);
  }

  function adjustPoison(target: "user" | string, amount: number) {
    adjustPlayerStat(target, "poison", amount);
  }

  function stopThreat() {
    if (!game.activeThreat) return;
    commit((previous) => ({
      ...previous,
      activeThreat: null,
      answeredCount: addSafeInteger(previous.answeredCount, 1),
      history: [historyEntry(previous, "Threat answered", `${previous.activeThreat?.title.replace(/[.!?]+$/, "") ?? "The active threat"} is no longer threatening the table.`, "success"), ...previous.history].slice(0, 40),
    }));
    requestAnimationFrame(() => threatHeading.current?.focus());
  }

  function delayThreat() {
    if (!game.activeThreat || game.activeThreat.delayed) return;
    commit((previous) => ({
      ...previous,
      activeThreat: previous.activeThreat ? { ...previous.activeThreat, remaining: addSafeInteger(previous.activeThreat.remaining, 1), delayed: true } : null,
      history: [historyEntry(previous, "Threat delayed", "You bought one additional turn.", "success"), ...previous.history].slice(0, 40),
    }));
    requestAnimationFrame(() => threatAnswerButton.current?.focus());
  }

  function removeSettingsOpponent(id: string, index: number) {
    setSettingsOpponents((current) => current.filter((opponent) => opponent.id !== id));
    requestAnimationFrame(() => {
      const inputs = settingsPanel.current?.querySelectorAll<HTMLInputElement>(".opponent-setting input");
      const nextInput = inputs?.[Math.min(index, inputs.length - 1)];
      if (nextInput) nextInput.focus();
      else settingsPanel.current?.querySelector<HTMLButtonElement>(".add-opponent")?.focus();
    });
  }

  function addSettingsOpponent() {
    setSettingsOpponents((current) => current.length >= 3 ? current : [...current, { id: crypto.randomUUID(), name: `Opponent ${current.length + 1}`, profile: "midrange", bracket: 3, life: 40, poisonCounters: 0, commanderDamage: {}, eliminated: false }]);
    requestAnimationFrame(() => {
      const inputs = settingsPanel.current?.querySelectorAll<HTMLInputElement>(".opponent-setting input");
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  function openSettings() {
    setSettingsOpponents(cloneOpponents(game.opponents));
    setSettingsSeed(game.seed);
    setActiveModal("settings");
  }

  function saveSettings() {
    const opponents = settingsOpponents.map((opponent, index) => ({
      ...opponent,
      name: opponent.name.trim() || `Opponent ${index + 1}`,
    }));
    const seed = settingsSeed.trim() || "GILDED-732";
    commit((previous) => {
      if (opponents.every((opponent) => opponent.eliminated)) {
        return {
          ...previous,
          seed,
          opponents,
          activeThreat: null,
          gameOver: "You eliminated every simulated opponent.",
        };
      }
      const activeThreat = previous.activeThreat && opponents.some((opponent) => opponent.id === previous.activeThreat?.ownerId) ? previous.activeThreat : null;
      const history = [historyEntry(previous, "Table updated", "Opponent deck profiles and Commander brackets changed.", "neutral"), ...previous.history].slice(0, 40);
      const isFollowUp = previous.responseStage === "resolved";
      const recentTemplateIds = isFollowUp ? [previous.currentEvent.templateId, ...previous.recentTemplateIds].slice(0, 3) : previous.recentTemplateIds;
      const eventCounter = addSafeInteger(previous.eventCounter, 1);
      const generatedEvent = generateEvent({
        turn: previous.turn,
        counter: eventCounter,
        seed,
        opponents,
        recentTemplateIds,
        activeThreat: Boolean(activeThreat),
        combatResolvedTurn: previous.combatResolvedTurn,
        signatureFollowUp: signatureFollowUpFor(previous),
      });
      const currentEvent: SimEvent = isFollowUp
        ? { ...generatedEvent, title: `Follow-up action: ${generatedEvent.title}`, tags: ["Follow-up action", ...generatedEvent.tags] }
        : generatedEvent;
      return {
        ...previous,
        seed,
        opponents,
        eventCounter,
        currentEvent,
        responseStage: "prompt",
        resolution: "",
        counterExchange: 0,
        activeThreat,
        recentTemplateIds,
        history,
      };
    });
    setActiveModal(null);
  }

  function openCombat() {
    const firstTarget = game.opponents.find((opponent) => !opponent.eliminated)?.id ?? game.opponents[0]?.id ?? "";
    setCombatTarget(firstTarget);
    setOutgoingAttackers([]);
    setAttackerName("");
    setAttackerPower(1);
    setAttackerCommander(false);
    setAttackerCommanderSlot("primary");
    setAttackerKeywords([]);
    setDefense(null);
    setDefenseRollCounter(game.defenseCounter);
    setDefenseAnswered(false);
    setActiveModal("combat");
  }

  function addOutgoingAttacker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const power = nonnegativeSafeInteger(attackerPower);
    if (power === null) return;
    const attacker: OutgoingAttacker = {
      id: crypto.randomUUID(),
      name: attackerName.trim() || (attackerCommander ? "Your commander" : `Attacker ${outgoingAttackers.length + 1}`),
      power,
      isCommander: attackerCommander,
      commanderSlot: attackerCommander ? attackerCommanderSlot : undefined,
      keywords: attackerKeywords,
    };
    setOutgoingAttackers((current) => [...current, attacker]);
    setAttackerName("");
    setAttackerPower(1);
    setAttackerCommander(false);
    setAttackerKeywords([]);
    setDefense(null);
    setDefenseAnswered(false);
    requestAnimationFrame(() => attackerNameInput.current?.focus());
  }

  function removeOutgoingAttacker(id: string, index: number) {
    setOutgoingAttackers((current) => current.filter((attacker) => attacker.id !== id));
    setDefense(null);
    setDefenseAnswered(false);
    requestAnimationFrame(() => {
      const buttons = outgoingList.current?.querySelectorAll<HTMLButtonElement>("article > button");
      const nextButton = buttons?.[Math.min(index, buttons.length - 1)];
      if (nextButton) nextButton.focus();
      else attackerNameInput.current?.focus();
    });
  }

  function outgoingCombatAttackers(ignoredId?: string): Attacker[] {
    return outgoingAttackers.filter((attacker) => attacker.id !== ignoredId).map((attacker) => ({
      ...attacker,
      toughness: attacker.power,
      commanderId: attacker.isCommander ? userCommanderKey(attacker.commanderSlot ?? "primary") : undefined,
      commanderLabel: attacker.isCommander ? USER_COMMANDER_LABELS[userCommanderKey(attacker.commanderSlot ?? "primary")] : undefined,
    }));
  }

  function simulateDefense() {
    const target = game.opponents.find((opponent) => opponent.id === combatTarget);
    if (!target || !outgoingAttackers.length) return;
    const nextCounter = addSafeInteger(defenseRollCounter, 1);
    const result = rollDefense({
      profile: target.profile,
      bracket: normalizeCommanderBracket(target.bracket),
      seed: game.seed,
      turn: game.turn,
      counter: nextCounter,
      attackers: outgoingAttackers,
    });
    setDefense(result);
    setDefenseRollCounter(nextCounter);
    setDefenseAnswered(false);
  }

  function answerDefense() {
    if (!defense || defense.type === "none") return;
    setDefense({ type: "none", title: "Defense answered", detail: "Your interaction stops the defensive play. Resolve combat normally." });
    setDefenseAnswered(true);
  }

  function applyOutgoingDamage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = game.opponents.find((opponent) => opponent.id === combatTarget);
    if (!target || !defense) return;
    const data = new FormData(event.currentTarget);
    const steps = stepsFromForm(data, "outgoing", outgoingDamageSteps);
    const lossPrevented = data.get("outgoing-loss-prevented") === "on";
    commit((previous) => {
      const previousTarget = previous.opponents.find((opponent) => opponent.id === target.id);
      if (!previousTarget) return previous;
      const result = resolveCombatDamage({
        state: {
          life: previousTarget.life,
          poisonCounters: previousTarget.poisonCounters,
          commanderDamage: previousTarget.commanderDamage,
        },
        steps,
        lossPrevented,
      });
      const opponents = previous.opponents.map((opponent) => opponent.id === target.id
        ? { ...opponent, life: result.life, poisonCounters: result.poisonCounters, commanderDamage: result.commanderDamage, eliminated: opponent.eliminated || result.defeated }
        : opponent);
      const reason = result.lossReason === "commander"
        ? `${USER_COMMANDER_LABELS[result.lethalCommander ?? ""] ?? result.lethalCommander} reached 21 commander damage.`
        : result.lossReason === "poison"
          ? `${target.name} reached ${result.poisonCounters} poison counters.`
          : result.lossReason === "life"
            ? `${target.name} reached ${result.life} life.`
            : "";
      const detail = `${result.stepsApplied.map((step) => step === "first" ? "First-strike" : "regular").join(" and ") || "No"} damage step${result.stepsApplied.length === 1 ? "" : "s"}: ${result.lifeDamage} life damage and ${result.poisonAdded} poison assigned to ${target.name}. You gained ${result.lifelinkGain} life from lifelink.${lossPrevented ? " A stated rule or effect prevented the normal loss for this resolution." : ""}${reason ? ` ${reason}` : ""}`;
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const sourceEliminated = result.defeated && previous.responseStage !== "resolved" && previous.currentEvent.sourceId === target.id;
      const sourceResolution = `${target.name} left the game, so their pending action was removed from the stack or combat.`;
      const damageHistory = historyEntry(previous, result.defeated ? `${target.name} eliminated` : `Damage assigned to ${target.name}`, detail, result.defeated ? "success" : "damage");
      return {
        ...previous,
        userLife: addSafeInteger(previous.userLife, result.lifelinkGain),
        defenseCounter: defenseRollCounter,
        answeredCount: addSafeInteger(previous.answeredCount, Number(defenseAnswered)),
        opponents,
        activeThreat: result.defeated && previous.activeThreat?.ownerId === target.id ? null : previous.activeThreat,
        gameOver: tableDefeated ? "You eliminated every simulated opponent." : previous.gameOver,
        history: [damageHistory, ...(sourceEliminated ? [historyEntry(previous, "Pending action cancelled", sourceResolution, "neutral")] : []), ...previous.history].slice(0, 40),
        ...(sourceEliminated ? { responseStage: "resolved" as const, resolution: sourceResolution } : {}),
      };
    });
    setActiveModal(null);
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (previous) {
      gameRef.current = previous;
      setGame(previous);
    }
  }

  function resetSession() {
    const seed = `CAST-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    undoStack.current = [];
    const next = createInitialGame(seed, game.opponents.map((opponent) => ({ ...opponent, life: 40, poisonCounters: 0, commanderDamage: {}, eliminated: false })));
    gameRef.current = next;
    setGame(next);
    setActiveModal(null);
  }

  const maxUserCommanderDamage = highestCommanderDamage(game.userCommanderDamage);
  const tableDefeated = game.opponents.every((opponent) => opponent.eliminated);
  const userDefeated = game.userLife <= 0 || game.userPoisonCounters >= 10 || maxUserCommanderDamage >= 21;
  const eventCardLookup = game.currentEvent.kind === "attack" || game.currentEvent.templateId === "random-discard"
    ? null
    : game.currentEvent.card === "Thassa’s Oracle line" ? "Thassa’s Oracle" : game.currentEvent.card;
  // eslint-disable-next-line react-hooks/refs -- commit, undo, and reset pair each stack mutation with a game-state render
  const canUndo = undoStack.current.length > 0;
  const opponentCommanderLabels = Object.fromEntries(game.opponents.flatMap((opponent) => [
    [opponentCommanderKey(opponent.id), `${opponent.name}’s commander`],
    [opponentCommanderKey(opponent.id, "partner"), `${opponent.name}’s partner commander`],
  ]));
  const removedAttackerId = defense?.type === "removal" ? [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id : undefined;
  const outgoingFullDamageSteps = buildDefaultCombatDamageSteps(outgoingCombatAttackers(removedAttackerId));
  const outgoingDamageSteps = defense?.type === "fog" ? zeroCombatSteps(outgoingFullDamageSteps) : outgoingFullDamageSteps;
  const encounterGlossaryTerms = new Set<GlossaryKey>();
  const outgoingDamageTerms: GlossaryKey[] = [];
  if (outgoingAttackers.some((attacker) => attacker.isCommander)) outgoingDamageTerms.push("Commander damage");
  if (outgoingDamageSteps.some((step) => step.lifelinkGain > 0)) outgoingDamageTerms.push("Lifelink");
  const liveMessage = (activeModal === "combat" && defense ? `Defense roll: ${defense.title}. ${defense.detail}` : null)
    ?? (game.responseStage === "counterback" ? canCounterAgain ? "Your counter was countered. Choose whether to counter again or let the original action resolve." : "Your counter was countered. Let the original action resolve." : null)
    ?? (game.responseStage === "choose" ? `Response choices are ready: ${game.currentEvent.responseOptions.join(", ")}.` : null)
    ?? (game.responseStage === "combat" ? "Ordered combat-damage fields are ready. Record life, poison, commander damage, and lifelink for each step." : null)
    ?? (game.responseStage !== "resolved" ? `${EVENT_PRESENTATION[game.currentEvent.kind].label}: ${game.currentEvent.title}` : game.resolution);
  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-workspace">Skip to table workspace</a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{game.gameOver ? "" : liveMessage}</div>

      <header className="topbar">
        <a className="brand" href="#main-workspace" aria-label="MTG Betafish — jump to table workspace">
          <span className="brand-title"><strong>MTG</strong><small>Betafish</small></span>
        </a>
        <div className="turn-strip" aria-label={`Turn ${game.turn}`}>
          <span className="eyebrow">Turn {game.turn}</span>
          <span className="turn-status-row">
            <b>{game.responseStage !== "resolved" ? "Response window open" : "Ready to advance"}</b>
            {game.activeThreat && <span className={`top-threat ${game.activeThreat.remaining <= 1 ? "imminent" : ""}`}>Threat · {game.activeThreat.remaining} {game.activeThreat.remaining === 1 ? "turn" : "turns"}</span>}
          </span>
        </div>
        <button className="link-button top-action" type="button" onClick={openSettings}>Table setup</button>
      </header>

      <section className="workspace" id="main-workspace">
        <section className="encounter-column" aria-labelledby="encounter-title">
          <div className="encounter-intro">
            <div><span className="eyebrow">{game.responseStage !== "resolved" ? "Response window" : "Outcome recorded"}</span><h1 id="encounter-title" ref={encounterHeading} tabIndex={-1}>{game.responseStage !== "resolved" ? "The table acts." : "Action resolved."}</h1></div>
            <span className="event-number">Event {String(game.eventCounter).padStart(2, "0")}</span>
          </div>

          <article className={`encounter-card event-${game.currentEvent.kind}`}>
            <div className="card-topline">
              <span className="event-type"><i aria-hidden="true">✦</i> {glossaryText(EVENT_PRESENTATION[game.currentEvent.kind].label, encounterGlossaryTerms)}</span>
              <span className={game.currentEvent.kind === "threat" ? "danger-badge" : "source-badge"}>{game.currentEvent.sourceName} · Rules reference: <CardPreview name={game.currentEvent.card} lookupName={eventCardLookup} /></span>
            </div>
            <div className={`spell-art spell-art-${game.currentEvent.kind}`} aria-hidden="true"><span>{EVENT_PRESENTATION[game.currentEvent.kind].glyph}</span></div>
            <div className="encounter-copy">
              <p className="source"><span className="avatar avatar-1">{game.currentEvent.sourceName.slice(0, 1)}</span> {game.currentEvent.sourceName} takes an action</p>
              <h2>{glossaryText(game.currentEvent.title, encounterGlossaryTerms)}</h2>
              {(game.currentEvent.kind === "development" || game.currentEvent.kind === "signature") && <p><strong>{game.currentEvent.kind === "development" ? "Signature card revealed:" : "Revealed signature card in use:"}</strong> <CardPreview name={game.currentEvent.card} /></p>}
              <p>{glossaryText(game.currentEvent.prompt, encounterGlossaryTerms)}</p>
              <div className="tag-row">{game.currentEvent.tags.map((tag) => <span className="event-tag" key={tag}>{glossaryText(tag, encounterGlossaryTerms)}</span>)}</div>

              {game.currentEvent.attackers && (
                <>
                <div className="response-heading combat-declaration"><span className="eyebrow">All attackers declared together</span><strong>{game.currentEvent.attackers.length} {game.currentEvent.attackers.length === 1 ? "attacker" : "attackers"}</strong></div>
                <div className="incoming-attackers" role="list" aria-label={`All ${game.currentEvent.attackers.length} ${game.currentEvent.attackers.length === 1 ? "attacker" : "attackers"} declared together for this combat`}>
                  {game.currentEvent.attackers.map((attacker) => (
                    <article key={attacker.id} role="listitem">
                      <div><strong>{attacker.name}</strong>{attacker.isCommander && <span className="commander-badge">Commander</span>}</div>
                      <b className="pt">{attacker.power}/{attacker.toughness}</b>
                      <div className="keyword-row">{attacker.keywords.length ? attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />) : <span className="vanilla">No keywords</span>}</div>
                    </article>
                  ))}
                </div>
                <p className="combat-total"><strong>{incomingLifeTotal}</strong> life damage · <strong>{incomingPoisonTotal}</strong> poison · <strong>{incomingCommanderTotal}</strong> <GlossaryTerm term="Commander damage">commander damage</GlossaryTerm> before blocks or interaction</p>
                </>
              )}
            </div>

            <fieldset className="event-fieldset" disabled={game.responseStage === "resolved"}>
              {game.responseStage === "prompt" && game.currentEvent.kind !== "attack" && game.currentEvent.kind !== "development" && (
                <div className="response-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Do you have a response?</span>{game.currentEvent.kind !== "threat" && (game.currentEvent.kind === "targeted" || game.currentEvent.kind === "counter") && <GlossaryHelp terms={["Legal target"]} />}</div>
                  <div className="response-actions">
                    <button className="primary-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "choose" }))}>Yes, I respond <span aria-hidden="true">→</span></button>
                    <button className="secondary-button" type="button" onClick={letEventResolve}>No response</button>
                    {game.currentEvent.emptyOutcome && <button className="text-button" type="button" onClick={() => resolveEvent("No applicable object", game.currentEvent.emptyOutcome ?? "The table action had no applicable object.", "neutral")}>Action has no applicable object</button>}
                  </div>
                </div>
              )}

              {game.responseStage === "prompt" && game.currentEvent.kind === "development" && (
                <div className="response-box">
                  <span className="eyebrow" ref={responseStep} tabIndex={-1}>No new pressure from this action</span>
                  <div className="response-actions">
                    <button className="primary-button" type="button" onClick={letEventResolve}>Record development <span aria-hidden="true">→</span></button>
                  </div>
                </div>
              )}

              {game.responseStage === "choose" && (
                <div className="response-box response-choice-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Choose the line you used</span><GlossaryHelp terms={["Counter", "Hexproof", "Indestructible", "Phase out", "Legal target", "Sacrifice", "Blink", "Bounce"]} /></div>
                  <div className="choice-grid">{game.currentEvent.responseOptions.map((option) => <button type="button" onClick={() => answerEvent(option)} key={option}><strong>{RESPONSE_PRESENTATION[option].title}</strong><small>{RESPONSE_PRESENTATION[option].detail}</small></button>)}</div>
                  <button className="text-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "prompt" }))}>Back</button>
                </div>
              )}

              {game.responseStage === "counterback" && (
                <div className="response-box counterback-box">
                  <span className="danger-badge" ref={responseStep} tabIndex={-1}><GlossaryTerm term="Counter">Counter</GlossaryTerm> to your counter</span>
                  <h3>Your answer is countered.</h3>
                  <p>{canCounterAgain ? "The response window remains open. Continue the exchange or let the original action resolve." : "No further counter response is listed for this action; let the original action resolve."}</p>
                  <div className={`response-actions ${canCounterAgain ? "two-actions" : ""}`}>
                    {canCounterAgain && <button className="primary-button" type="button" onClick={() => answerEvent("counter")}>I counter again <span aria-hidden="true">→</span></button>}
                    <button className="secondary-button" type="button" onClick={letEventResolve}>Let the original resolve</button>
                  </div>
                  <div className="choice-grid">{game.currentEvent.responseOptions.filter((option) => option !== "counter").map((option) => <button type="button" onClick={() => answerEvent(option)} key={option}><strong>{RESPONSE_PRESENTATION[option].title}</strong><small>{RESPONSE_PRESENTATION[option].detail}</small></button>)}</div>
                </div>
              )}

              {game.responseStage === "prompt" && game.currentEvent.kind === "attack" && (
                <div className="response-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Resolve this combat</span><GlossaryHelp terms={["Fog"]} /></div>
                  <div className="response-actions combat-actions">
                    <button className="primary-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "combat" }))}>Resolve blocks / interaction <span aria-hidden="true">→</span></button>
                    <button className="secondary-button" type="button" onClick={() => applyIncoming(incomingDamageSteps, "Attack connected")}>Take the full attack</button>
                    <button className="text-button" type="button" onClick={() => applyIncoming(zeroCombatSteps(incomingDamageSteps), "Combat prevented", true)}>Fog / stop combat</button>
                  </div>
                </div>
              )}

              {game.responseStage === "combat" && (
                <form className="response-box combat-resolution" onSubmit={submitIncomingDamage}>
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>After blocks and interaction</span><GlossaryHelp terms={incomingLifelinkTotal > 0 ? ["Commander damage", "Lifelink"] : ["Commander damage"]} /></div>
                  <p>Edit the generated defaults after resolving blocks, prevention, replacement effects, and removal. Commander damage follows each displayed original identity even if another player controls that commander.</p>
                  <CombatDamageFields prefix="incoming" steps={incomingDamageSteps} commanderLabels={incomingCommanderLabels} />
                  <label className="check-label loss-override"><input name="incoming-loss-prevented" type="checkbox" />A rule or effect says I can’t lose this resolution; apply every step without ending the run.</label>
                  <div className="modal-actions compact-actions">
                    <button className="text-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "prompt" }))}>Back</button>
                    <button className="primary-button" type="submit">Apply damage <span aria-hidden="true">→</span></button>
                  </div>
                </form>
              )}
            </fieldset>

            {game.responseStage === "resolved" && (
              <div className="resolved-box"><span className="resolved-mark" aria-hidden="true">✓</span><div><span className="eyebrow" ref={responseStep} tabIndex={-1}>Recorded</span><strong>{game.resolution}</strong></div></div>
            )}
          </article>

          <div className="next-action">
            <div><span className="eyebrow">Up next</span><strong>{game.responseStage === "resolved" ? "Advance one full table round." : "Resolve this event, then advance the table."}</strong></div>
            <div className="next-buttons">
              <button className="undo-button" type="button" onClick={undo} disabled={!canUndo}>Undo</button>
              <button className="advance-button" type="button" onClick={advanceTurn} disabled={game.responseStage !== "resolved" || Boolean(game.gameOver)}>Next turn <span aria-hidden="true">→</span></button>
            </div>
          </div>
        </section>

        <aside className="rail opponents-panel" aria-labelledby="opponents-title">
          <div className="section-heading">
            <div><span className="eyebrow">The table</span><h2 id="opponents-title">Opponents</h2></div>
            <button className="icon-button" type="button" onClick={openSettings} aria-label="Edit opponents">+</button>
          </div>
          <div className="opponent-list">
            {game.opponents.map((opponent, index) => (
              <article className={`opponent ${opponent.eliminated ? "eliminated" : ""}`} key={opponent.id}>
                <span className={`avatar avatar-${index + 1}`}>{opponent.name.slice(0, 1).toUpperCase()}</span>
                <div className="opponent-copy"><strong>{opponent.name}</strong><small>{opponent.eliminated ? "Eliminated" : `${PROFILE_LABELS[opponent.profile]} · ${bracketLabel(opponent.bracket)}`}</small><CommanderLedger damage={opponent.commanderDamage} labels={USER_COMMANDER_LABELS} /></div>
                <div className="life-control">
                  <button type="button" onClick={() => adjustLife(opponent.id, -1)} aria-label={`Remove one life from ${opponent.name}`}>−</button>
                  <span className="life" aria-live="polite"><b>{opponent.life}</b><small>life</small></span>
                  <button type="button" onClick={() => adjustLife(opponent.id, 1)} aria-label={`Add one life to ${opponent.name}`}>+</button>
                </div>
                <div className="poison-control"><button type="button" onClick={() => adjustPoison(opponent.id, -1)} aria-label={`Remove one poison counter from ${opponent.name}`}>−</button><span aria-live="polite" aria-atomic="true">Poison {opponent.poisonCounters}/10</span><button type="button" onClick={() => adjustPoison(opponent.id, 1)} aria-label={`Add one poison counter to ${opponent.name}`}>+</button></div>
              </article>
            ))}
          </div>
          <article className="you-card">
            <span className="avatar avatar-you">You</span>
            <div className="opponent-copy"><strong>Your board</strong><small>Highest <GlossaryTerm term="Commander damage">commander damage</GlossaryTerm>: {maxUserCommanderDamage}</small><CommanderLedger damage={game.userCommanderDamage} labels={opponentCommanderLabels} dark /></div>
            <div className="life-control life-control-dark">
              <button type="button" onClick={() => adjustLife("user", -1)} aria-label="Remove one life from you">−</button>
              <span className="life" aria-live="polite"><b>{game.userLife}</b><small>life</small></span>
              <button type="button" onClick={() => adjustLife("user", 1)} aria-label="Add one life to you">+</button>
            </div>
            <div className="poison-control poison-control-dark"><button type="button" onClick={() => adjustPoison("user", -1)} aria-label="Remove one poison counter from you">−</button><span aria-live="polite" aria-atomic="true">Poison {game.userPoisonCounters}/10</span><button type="button" onClick={() => adjustPoison("user", 1)} aria-label="Add one poison counter to you">+</button></div>
          </article>
          <button className="secondary-wide" type="button" onClick={openCombat} disabled={!livingOpponents.length}>Assign your combat damage <span aria-hidden="true">→</span></button>
          <p className="rail-note">Tap attackers in your playtester, then let this table roll a defense.</p>
        </aside>

        <aside className="rail pressure-panel" aria-label="Table pressure">
          <section aria-labelledby="threat-title" aria-live="polite">
            <div className="section-heading">
              <div><h2 id="threat-title" ref={threatHeading} tabIndex={-1}>Active threat</h2></div>
              {game.activeThreat && <span className={`countdown ${game.activeThreat.remaining <= 1 ? "imminent" : ""}`}>{game.activeThreat.remaining} {game.activeThreat.remaining === 1 ? "turn" : "turns"}</span>}
            </div>
            {game.activeThreat ? (
              <article className="threat-card">
                <span className="threat-icon" aria-hidden="true">!</span>
                <div><strong><GlossaryText text={game.activeThreat.title} /></strong><p><GlossaryText text={game.activeThreat.description} /></p></div>
                <div className="threat-actions">
                  <button className="text-button light" type="button" onClick={stopThreat} ref={threatAnswerButton}>I answered this threat</button>
                  <button className="text-button light" type="button" onClick={delayThreat} disabled={game.activeThreat.delayed}>{game.activeThreat.delayed ? "Already delayed" : "Delay +1 turn"}</button>
                </div>
              </article>
            ) : (
              <div className="empty-threat"><span aria-hidden="true">○</span><strong>No active clock</strong><p>Game-ending threat timing follows each opponent’s bracket.</p></div>
            )}
          </section>

          <section className="history" aria-labelledby="history-title">
            <div className="section-heading"><div><span className="eyebrow">This session</span><h2 id="history-title">Recent events</h2></div><button className="link-button" type="button" onClick={undo} disabled={!canUndo}>Undo</button></div>
            <ol>
              {game.history.slice(0, 5).map((entry) => (
                <li key={entry.id}><span className={`history-dot ${entry.tone}`} aria-hidden="true">{entry.tone === "success" ? "✓" : entry.tone === "warning" ? "!" : entry.tone === "damage" ? "−" : "·"}</span><div><strong>{entry.title}</strong><small>Turn {entry.turn} · {entry.detail}</small></div></li>
              ))}
            </ol>
          </section>
        </aside>
      </section>

      <footer className="session-footer">
        <span>Session seed <b>{game.seed}</b></span>
        <button type="button" onClick={() => setActiveModal("library")}>Scenario library · {CARD_LIBRARY_UPDATED}</button>
        <span>{hydrated ? "Autosaves locally when available" : "Loading session…"}</span>
        <button type="button" onClick={() => setActiveModal("reset")}>Restart session</button>
      </footer>

      {activeModal === "settings" && (
        <Modal title="Set up the table" subtitle="Choose one to three matchups. Each profile-and-bracket pairing has its own core-card package, pacing, and interaction frequency." onClose={() => setActiveModal(null)} wide>
          <div className="settings-body">
            <div className="opponent-settings" ref={settingsPanel}>
              {settingsOpponents.map((opponent, index) => {
                const profile = DECK_PROFILES[opponent.profile];
                const bracket = normalizeCommanderBracket(opponent.bracket);
                const bracketRules = COMMANDER_BRACKETS[bracket];
                const coreCards = profile.coreCards[bracket];
                const profileDescriptionId = `profile-description-${opponent.id}`;
                const bracketDescriptionId = `bracket-description-${opponent.id}`;
                return (
                  <fieldset className="opponent-setting" key={opponent.id}>
                    <legend className="sr-only">Opponent {index + 1}</legend>
                    <span className={`avatar avatar-${index + 1}`}>{opponent.name.slice(0, 1).toUpperCase() || index + 1}</span>
                    <label>Name<input value={opponent.name} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, name: event.target.value } : item))} /></label>
                    <label>Deck profile<select value={opponent.profile} aria-describedby={profileDescriptionId} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, profile: event.target.value as ProfileId } : item))}>{Object.entries(PROFILE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                    <label>Commander bracket<select value={bracket} aria-describedby={bracketDescriptionId} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, bracket: Number(event.target.value) as CommanderBracket } : item))}>{Object.entries(COMMANDER_BRACKETS).map(([value, rules]) => <option value={value} key={value}>B{value} {rules.label}</option>)}</select></label>
                    <button className="remove-button" type="button" onClick={() => removeSettingsOpponent(opponent.id, index)} disabled={settingsOpponents.length === 1} aria-label={`Remove ${opponent.name}`}>Remove</button>
                    <div className="profile-setting-copy" id={profileDescriptionId}><p><GlossaryText text={profile.description} /></p><p><strong>B{bracket} core cards:</strong> {coreCards.map((card, cardIndex) => <span key={card}>{cardIndex > 0 && " · "}<CardPreview name={card} />{GAME_CHANGER_CARDS.has(card) && <small className="game-changer-label"> Game Changer</small>}</span>)} <span>(possible matchup sightings; not a complete decklist or guaranteed draw)</span></p></div>
                    <p className="bracket-setting-copy" id={bracketDescriptionId}><strong>{bracketLabel(bracket)}:</strong> {bracketRules.summary} {bracketRules.turnGuide}</p>
                  </fieldset>
                );
              })}
              <button className="add-opponent" type="button" onClick={addSettingsOpponent} disabled={settingsOpponents.length >= 3}>+ Add opponent</button>
            </div>
            <div className="session-settings">
              <label>Session seed<input value={settingsSeed} onChange={(event) => setSettingsSeed(event.target.value.toUpperCase())} maxLength={24} /></label>
              <p>Reuse a seed with the same choices to replay the same event sequence.</p>
              <p>Before resolution, applying changes rerolls the pending action. After resolution, it generates one follow-up action this turn. If combat already occurred, the follow-up will not be another combat.</p>
              <div className="bracket-guide"><span className="eyebrow">Bracket guide</span><strong>Official intent, Betafish-tuned odds</strong><p>MTG Betafish translates Wizards’ turn guidance into when pressure and game-ending clocks may appear. It also scales attacks, counters, removal, and defenses as simulation heuristics.</p><ol>{Object.entries(COMMANDER_BRACKETS).map(([value, rules]) => <li key={value}><b>B{value}</b><span>{rules.label}</span><small>{rules.turnGuide}</small></li>)}</ol><a href="https://magic.wizards.com/en/formats/commander" target="_blank" rel="noreferrer">View Wizards’ beta bracket guide <span aria-hidden="true">↗</span></a></div>
              <p>Profiles are abstract matchup presets, not complete color-identity-checked decklists.</p>
            </div>
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="primary-button" type="button" onClick={saveSettings}>{game.responseStage === "resolved" ? "Apply and generate follow-up" : "Apply and reroll"} <span aria-hidden="true">→</span></button></div>
        </Modal>
      )}

      {activeModal === "combat" && (
        <Modal title="Assign your attack" subtitle="Record one defending player per submission. Reopen this form for another defender or an externally created extra combat; the simulated turn will not advance." onClose={() => setActiveModal(null)} wide>
          <div className="combat-builder">
            <label className="target-select">Attack target<select value={combatTarget} onChange={(event) => { setCombatTarget(event.target.value); setDefense(null); setDefenseAnswered(false); }}>{livingOpponents.map((opponent) => <option value={opponent.id} key={opponent.id}>{opponent.name} · {PROFILE_LABELS[opponent.profile]} · {bracketLabel(opponent.bracket)} · {opponent.life} life · {opponent.poisonCounters} poison</option>)}</select></label>
            <form className="attacker-form" onSubmit={addOutgoingAttacker}>
              <label>Attacker name<input ref={attackerNameInput} placeholder="e.g. Atraxa" value={attackerName} onChange={(event) => setAttackerName(event.target.value)} /></label>
              <label>Power<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" value={attackerPower} onChange={(event) => setAttackerPower(nonnegativeSafeInteger(Number(event.target.value)) ?? 0)} /></label>
              <label className="check-label"><input type="checkbox" checked={attackerCommander} onChange={(event) => setAttackerCommander(event.target.checked)} />Commander</label>
              {attackerCommander && <label>Original commander identity<select value={attackerCommanderSlot} onChange={(event) => setAttackerCommanderSlot(event.target.value as CommanderSlot)}><option value="primary">Primary commander</option><option value="partner">Partner commander</option></select><small>Commander damage follows this card’s original identity even if another player controls it.</small></label>}
              <fieldset className="keyword-picker event-fieldset"><legend className="sr-only">Attacker keywords</legend><GlossaryHelp label="Keyword help" terms={COMBAT_KEYWORDS} />{COMBAT_KEYWORDS.map((keyword) => <label key={keyword}><input type="checkbox" checked={attackerKeywords.includes(keyword)} onChange={() => setAttackerKeywords((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword])} />{keyword}</label>)}</fieldset>
              <button className="secondary-button add-attacker-button" type="submit">Add attacker</button>
            </form>

            <div className="outgoing-list" ref={outgoingList}>
              {outgoingAttackers.length ? outgoingAttackers.map((attacker, index) => (
                <article key={attacker.id}><div><strong>{attacker.name}</strong><small>{attacker.isCommander ? "Commander" : "Creature"}</small></div><b>{attacker.power} power</b><div className="keyword-row">{attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />)}</div><button type="button" onClick={() => removeOutgoingAttacker(attacker.id, index)} aria-label={`Remove ${attacker.name}`}>×</button></article>
              )) : <div className="empty-attackers">No attackers added yet.</div>}
            </div>

            <button className="roll-button" type="button" onClick={simulateDefense} disabled={!outgoingAttackers.length || !combatTarget}>{defense ? "Reroll and replace current defense" : "Roll defending player’s response"} <span aria-hidden="true">↻</span></button>

            {defense && (
              <div className={`defense-result defense-${defense.type}`} ref={defenseResult} tabIndex={-1}>
                <span className="eyebrow">Defense outcome</span><h3><GlossaryText text={defense.title} /></h3><p><GlossaryText text={defense.detail} /></p>
                {defense.type !== "none" && <button className="text-button" type="button" onClick={answerDefense}>I can answer this defense</button>}
              </div>
            )}

            {defense && (
              <form className="damage-confirm" id="outgoing-damage-form" key={`${defenseRollCounter}-${defense.type}`} onSubmit={applyOutgoingDamage}>
                <div className="response-heading"><span className="eyebrow">Damage that gets through</span>{outgoingDamageTerms.length > 0 && <GlossaryHelp terms={outgoingDamageTerms} />}</div>
                <p>Override these defaults after resolving blocks, removal, prevention, replacement effects, and damage assignment in your playtester.</p>
                <CombatDamageFields prefix="outgoing" steps={outgoingDamageSteps} commanderLabels={USER_COMMANDER_LABELS} />
                <label className="check-label loss-override"><input name="outgoing-loss-prevented" type="checkbox" />A rule or effect says this defender can’t lose this resolution; apply every step without eliminating them.</label>
                <p className="boundary-note">This submission records only {game.opponents.find((opponent) => opponent.id === combatTarget)?.name ?? "the selected defender"}. Submit other defenders or extra combats separately.</p>
              </form>
            )}
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="primary-button" type="submit" form="outgoing-damage-form" disabled={!defense}>Apply damage <span aria-hidden="true">→</span></button></div>
        </Modal>
      )}

      {activeModal === "library" && (
        <Modal title="Curated rules-reference library" subtitle="Versioned examples support the simulation; resolve the exact game objects and effects in your playtester." onClose={() => setActiveModal(null)} wide>
          <div className="library-grid">{CARD_LIBRARY.map((group) => <article key={group.archetype}><span className="eyebrow">Archetype</span><h3><GlossaryText text={group.archetype} /></h3><ul>{group.cards.map((card) => <li key={card}><CardPreview name={card} /></li>)}</ul></article>)}</div>
          <div className="library-note"><strong>Rules references updated {CARD_LIBRARY_UPDATED}</strong><p>Scenario language follows Wizards’ definitions for <GlossaryTerm term="Counter">counter</GlossaryTerm>, <GlossaryTerm term="Destroy">destroy</GlossaryTerm>, <GlossaryTerm term="Exile">exile</GlossaryTerm>, <GlossaryTerm term="Flying">flying</GlossaryTerm>, <GlossaryTerm term="Reach">reach</GlossaryTerm>, <GlossaryTerm term="Trample">trample</GlossaryTerm>, <GlossaryTerm term="Menace">menace</GlossaryTerm>, <GlossaryTerm term="Deathtouch">deathtouch</GlossaryTerm>, <GlossaryTerm term="First strike">first strike</GlossaryTerm>, <GlossaryTerm term="Double strike">double strike</GlossaryTerm>, <GlossaryTerm term="Hexproof">hexproof</GlossaryTerm>, and <GlossaryTerm term="Indestructible">indestructible</GlossaryTerm>.</p><a href="https://magic.wizards.com/en/keyword-glossary" target="_blank" rel="noreferrer">Open the official keyword glossary <span aria-hidden="true">↗</span></a></div>
        </Modal>
      )}

      {activeModal === "reset" && (
        <Modal title="Restart this session?" subtitle="This clears life totals, damage, threats, and history. Your opponent profiles stay in place." onClose={() => setActiveModal(null)}>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Keep playing</button><button className="danger-button" type="button" onClick={resetSession}>Restart with a new seed</button></div>
        </Modal>
      )}

      {game.gameOver && (
        <Modal title="The goldfish game ended" subtitle={game.gameOver} dismissible={!tableDefeated && !userDefeated} onClose={continueAfterGameOver}>
          <div className="session-summary"><span><b>{game.turn}</b> turns reached</span><span><b>{game.answeredCount}</b> threats/actions answered</span><span><b>{game.userLife}</b> life · <b>{game.userPoisonCounters}</b> poison</span></div>
          {userDefeated && <p className="terminal-guidance">If a rule or effect prevents this loss, undo when available and resubmit the damage with the loss-prevention override so every ordered damage step is applied.</p>}
          <div className="modal-actions">{canUndo && <button className="secondary-button" type="button" onClick={undo}>Undo last change</button>}{!tableDefeated && !userDefeated && <button className="secondary-button" type="button" onClick={continueAfterGameOver}>Continue anyway</button>}<button className="primary-button" type="button" onClick={resetSession}>Start a new run <span aria-hidden="true">→</span></button></div>
        </Modal>
      )}
    </main>
  );
}
