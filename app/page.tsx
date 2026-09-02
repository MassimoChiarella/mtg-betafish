"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import {
  buildDefaultCombatDamageSteps,
  CARD_LIBRARY,
  CARD_LIBRARY_UPDATED,
  COMMANDER_BRACKETS,
  counterBacks,
  DECK_PROFILES,
  evaluateTrackedLoss,
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
  GAME_STATE_VERSION,
  type GameState,
  type HistoryEntry,
  type HistoryTone,
} from "./session";
import {
  decideStorageEvent,
  hasCompetingStoredSession,
  newestStoredSession,
  nextStorageRevision,
  readStoredSession,
  serializeGameState,
  writeStoredSession,
  type StorageConflict,
} from "./storage-session";
import { scryfallImageUrl } from "./scryfall";

type OutgoingAttacker = {
  id: string;
  name: string;
  power: number;
  isCommander: boolean;
  commanderSlot?: CommanderSlot;
  keywords: Keyword[];
};

type SaveStatus = "loading" | "saved" | "unsaved" | "conflict" | "discarded";

// Keep the legacy key so existing saved sessions survive the product rename.
const STORAGE_KEY = "goldfish-lab-session-v1";
const COMBAT_KEYWORDS: Keyword[] = ["Flying", "Trample", "Menace", "Deathtouch", "First strike", "Double strike", "Lifelink", "Infect"];
const USER_COMMANDER_LABELS = {
  [userCommanderKey("primary")]: "Your primary commander",
  [userCommanderKey("partner")]: "Your partner commander",
};

const DEFAULT_OPPONENTS: Opponent[] = [
  { id: "mara", name: "Mara", profile: "graveyard", bracket: 3, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false },
  { id: "theo", name: "Theo", profile: "control", bracket: 4, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false },
  { id: "ari", name: "Ari", profile: "swarm", bracket: 2, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false },
];

function cloneOpponents(opponents: readonly Opponent[]): Opponent[] {
  return opponents.map((opponent) => ({
    ...opponent,
    bracket: normalizeCommanderBracket(opponent.bracket),
    poisonCounters: nonnegativeSafeInteger(opponent.poisonCounters) ?? 0,
    commanderDamage: { ...opponent.commanderDamage },
    lossProtected: opponent.lossProtected ?? false,
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
    userLossProtected: false,
    userCommanderDamage: {},
    currentEvent,
    responseStage: "prompt",
    resolution: "",
    toxicDelugePayment: null,
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

function hasTrackedCommanderDamageFromRemovedOpponent(state: GameState, configured: readonly Opponent[]) {
  const configuredIds = new Set(configured.map((opponent) => opponent.id));
  const removedCommanderIds = state.opponents
    .filter((opponent) => !configuredIds.has(opponent.id))
    .flatMap((opponent) => [opponentCommanderKey(opponent.id), opponentCommanderKey(opponent.id, "partner")]);
  const retainedLedgers = [state.userCommanderDamage, ...configured.map((opponent) => opponent.commanderDamage)];
  return removedCommanderIds.some((commanderId) => retainedLedgers.some((ledger) => (ledger[commanderId] ?? 0) > 0));
}

function trackedLossReason(name: string, life: number, poisonCounters: number, commanderDamage: Record<string, number>, lossProtected = false) {
  const loss = evaluateTrackedLoss({ life, poisonCounters, commanderDamage }, lossProtected);
  if (!loss) return null;
  if (loss.reason === "life") return `${name} reached ${life} life.`;
  if (loss.reason === "poison") return `${name} reached ${poisonCounters} poison counters.`;
  return `${name} reached 21 commander damage from one commander.`;
}

function damageFromForm(data: FormData, name: string, fallback = 0) {
  return nonnegativeSafeInteger(Number(data.get(name))) ?? fallback;
}

function safeIntegerFromForm(data: FormData, name: string, fallback = 0) {
  const value = Number(data.get(name));
  return Number.isSafeInteger(value) ? value : fallback;
}

function addSafeInteger(value: number, delta: number) {
  const result = value + delta;
  if (Number.isSafeInteger(result)) return result;
  return delta >= 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

function damageFieldName(prefix: string, step: CombatDamageStep["step"], field: "life" | "poison" | "lifelink" | "commander", commanderId = "") {
  return `${prefix}-${step}-${field}${commanderId ? `-${encodeURIComponent(commanderId)}` : ""}`;
}

function damageStepEnabledName(prefix: string, step: CombatDamageStep["step"]) {
  return `${prefix}-${step}-enabled`;
}

function combatStepDefaults(defaults: readonly CombatDamageStep[], stepName: CombatDamageStep["step"], commanderIds: readonly string[]): CombatDamageStep {
  const found = defaults.find((step) => step.step === stepName);
  return {
    step: stepName,
    lifeDamage: found?.lifeDamage ?? 0,
    poisonCounters: found?.poisonCounters ?? 0,
    lifelinkGain: found?.lifelinkGain ?? 0,
    commanderHits: Object.fromEntries(commanderIds.map((commanderId) => [commanderId, found?.commanderHits[commanderId] ?? 0])),
  };
}

function stepsFromForm(data: FormData, prefix: string, defaults: readonly CombatDamageStep[], commanderIds: readonly string[]): CombatDamageStep[] {
  return (["first", "regular"] as const).filter((step) => data.get(damageStepEnabledName(prefix, step)) === "on").map((stepName) => {
    const step = combatStepDefaults(defaults, stepName, commanderIds);
    return {
      step: step.step,
      lifeDamage: damageFromForm(data, damageFieldName(prefix, step.step, "life"), step.lifeDamage),
      poisonCounters: damageFromForm(data, damageFieldName(prefix, step.step, "poison"), step.poisonCounters),
      lifelinkGain: damageFromForm(data, damageFieldName(prefix, step.step, "lifelink"), step.lifelinkGain),
      commanderHits: Object.fromEntries(commanderIds.map((commanderId) => [
        commanderId,
        damageFromForm(data, damageFieldName(prefix, step.step, "commander", commanderId), step.commanderHits[commanderId]),
      ])),
    };
  });
}

function zeroCombatSteps(steps: readonly CombatDamageStep[]): CombatDamageStep[] {
  const source = steps.length ? steps : [{ step: "regular" as const, lifeDamage: 0, poisonCounters: 0, lifelinkGain: 0, commanderHits: {} }];
  return source.map((step) => ({ ...step, lifeDamage: 0, poisonCounters: 0, lifelinkGain: 0, commanderHits: Object.fromEntries(Object.keys(step.commanderHits).map((id) => [id, 0])) }));
}

function bracketLabel(value: unknown) {
  const bracket = normalizeCommanderBracket(value);
  return `B${bracket} ${COMMANDER_BRACKETS[bracket].label}`;
}

function signatureFollowUpFor(state: Pick<GameState, "currentEvent" | "responseStage" | "opponents">): SignatureFollowUp | null {
  const event = state.currentEvent;
  const source = state.opponents.find((opponent) => opponent.id === event.sourceId);
  return state.responseStage === "resolved" && event.kind === "development" && event.templateId === SIGNATURE_REVEAL_TEMPLATE_ID
    && source
    ? { sourceId: event.sourceId, card: event.card, profile: source.profile, bracket: source.bracket }
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
        <div><span className="eyebrow">MTG Betafish</span><h2 id={titleId} tabIndex={-1}>{title}</h2>{subtitle && <p id={descriptionId}>{subtitle}</p>}</div>
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
      <summary>Commander damage {highestCommanderDamage(damage)}/21</summary>
      <ul>{entries.length ? entries.map(([commander, total]) => <li key={commander}><span>{labels[commander] ?? commander}</span><b>{total}/21</b></li>) : <li><span>No commander damage</span><b>0/21</b></li>}</ul>
    </details>
  );
}

function CombatDamageStepFields({
  prefix,
  step,
  enabledByDefault,
  commanderLabels,
}: {
  prefix: string;
  step: CombatDamageStep;
  enabledByDefault: boolean;
  commanderLabels: Record<string, string>;
}) {
  const [enabled, setEnabled] = useState(enabledByDefault);
  return (
    <fieldset className="damage-step" disabled={!enabled}>
      <legend>
        <label className="damage-step-toggle">
          <input name={damageStepEnabledName(prefix, step.step)} type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          {step.step === "first" ? "First-strike combat damage step" : "Regular combat damage step"}
        </label>
      </legend>
      <div className="damage-inputs">
        <label>Life damage<input name={damageFieldName(prefix, step.step, "life")} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={step.lifeDamage} /></label>
        <label>Poison counters added<input name={damageFieldName(prefix, step.step, "poison")} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={step.poisonCounters} /></label>
        {Object.entries(step.commanderHits).map(([commanderId, damage]) => (
          <label key={commanderId}>{commanderLabels[commanderId] ?? commanderId} damage<input name={damageFieldName(prefix, step.step, "commander", commanderId)} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={damage} /></label>
        ))}
        <label>Lifelink life gained<input name={damageFieldName(prefix, step.step, "lifelink")} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={step.lifelinkGain} /></label>
      </div>
    </fieldset>
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
  const commanderIds = Object.keys(commanderLabels);
  return (
    <div className="damage-steps">
      {(["first", "regular"] as const).map((stepName) => (
        <CombatDamageStepFields
          commanderLabels={commanderLabels}
          enabledByDefault={steps.some((step) => step.step === stepName)}
          key={stepName}
          prefix={prefix}
          step={combatStepDefaults(steps, stepName, commanderIds)}
        />
      ))}
    </div>
  );
}

export default function Home() {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const gameRef = useRef(game);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [storageConflict, setStorageConflict] = useState<StorageConflict | null>(null);
  const storageRevision = useRef(0);
  const savedSerialization = useRef("");
  const undoStack = useRef<GameState[]>([]);
  const storageConflictHeading = useRef<HTMLHeadingElement>(null);
  const encounterHeading = useRef<HTMLHeadingElement>(null);
  const responseStep = useRef<HTMLSpanElement>(null);
  const previousEventKey = useRef(`${game.seed}:${game.eventCounter}`);
  const previousResponseStage = useRef(game.responseStage);
  const defenseResult = useRef<HTMLDivElement>(null);
  const threatHeading = useRef<HTMLHeadingElement>(null);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const attackerNameInput = useRef<HTMLInputElement>(null);
  const outgoingList = useRef<HTMLDivElement>(null);

  const [activeModal, setActiveModal] = useState<"settings" | "library" | "combat" | "totals" | "reset" | null>(null);
  const [settingsOpponents, setSettingsOpponents] = useState<Opponent[]>([]);
  const [settingsSeed, setSettingsSeed] = useState("");
  const [settingsNameError, setSettingsNameError] = useState("");
  const [settingsTableError, setSettingsTableError] = useState("");
  const [correctionTarget, setCorrectionTarget] = useState<"user" | string>("user");

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
  const [outgoingAttackerError, setOutgoingAttackerError] = useState("");
  const [toxicPaymentDraft, setToxicPaymentDraft] = useState<{ eventId: string; value: string }>({ eventId: "", value: "0" });
  const [toxicPaymentError, setToxicPaymentError] = useState("");

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // Persistence is best-effort: private browsing and storage policies may disable it.
  useEffect(() => {
    let loadedState: GameState | null = null;
    let initialStatus: SaveStatus = "saved";
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const stored = readStoredSession(saved);
        if (!stored) {
          window.localStorage.removeItem(STORAGE_KEY);
          const revision = 1;
          if (writeStoredSession(window.localStorage, STORAGE_KEY, revision, gameRef.current)) {
            storageRevision.current = revision;
            savedSerialization.current = serializeGameState(gameRef.current) ?? "";
            initialStatus = "discarded";
          } else {
            initialStatus = "unsaved";
          }
        }
        else {
          storageRevision.current = stored.revision;
          savedSerialization.current = stored.serialized;
          gameRef.current = stored.state;
          loadedState = stored.state;
        }
      }
    } catch {
      initialStatus = "unsaved";
    }
    queueMicrotask(() => {
      if (loadedState) setGame(loadedState);
      setSaveStatus(initialStatus);
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated || storageConflict) return;
    const serialized = serializeGameState(game);
    if (serialized === null) {
      queueMicrotask(() => setSaveStatus("unsaved"));
      return;
    }
    if (serialized === savedSerialization.current) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      let stored: StorageConflict | null = null;
      let discardedInvalid = false;
      if (raw) {
        stored = readStoredSession(raw);
        if (!stored) {
          const decision = decideStorageEvent(raw, window.localStorage.getItem(STORAGE_KEY));
          if (decision.action === "valid") {
            stored = decision.stored;
          } else {
            if (window.localStorage.getItem(STORAGE_KEY) !== decision.expectedRaw) {
              queueMicrotask(() => setSaveStatus("unsaved"));
              return;
            }
            if (decision.expectedRaw !== null) window.localStorage.removeItem(STORAGE_KEY);
            discardedInvalid = decision.expectedRaw !== null;
          }
        }
      }
      if (stored && stored.serialized === serialized) {
        storageRevision.current = Math.max(storageRevision.current, stored.revision);
        savedSerialization.current = stored.serialized;
        queueMicrotask(() => setSaveStatus(discardedInvalid ? "discarded" : "saved"));
        return;
      }
      if (stored && hasCompetingStoredSession(stored, storageRevision.current, savedSerialization.current)) {
        queueMicrotask(() => { setStorageConflict(stored); setSaveStatus("conflict"); });
        return;
      }
      if (stored && stored.revision > storageRevision.current) storageRevision.current = stored.revision;
      const revision = nextStorageRevision(storageRevision.current);
      if (revision === null || !writeStoredSession(window.localStorage, STORAGE_KEY, revision, game)) {
        queueMicrotask(() => setSaveStatus("unsaved"));
        return;
      }
      storageRevision.current = revision;
      savedSerialization.current = serialized;
      queueMicrotask(() => setSaveStatus(discardedInvalid ? "discarded" : "saved"));
    } catch {
      queueMicrotask(() => setSaveStatus("unsaved"));
    }
  }, [game, hydrated, storageConflict]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      try {
        const decision = decideStorageEvent(event.newValue, window.localStorage.getItem(STORAGE_KEY));
        if (decision.action === "restore") {
            if (window.localStorage.getItem(STORAGE_KEY) !== decision.expectedRaw) return;
            if (decision.expectedRaw !== null) window.localStorage.removeItem(STORAGE_KEY);
            const revision = nextStorageRevision(storageRevision.current);
            if (revision === null || !writeStoredSession(window.localStorage, STORAGE_KEY, revision, gameRef.current)) {
              setSaveStatus("unsaved");
              return;
            }
            storageRevision.current = revision;
            savedSerialization.current = serializeGameState(gameRef.current) ?? "";
            setSaveStatus("discarded");
            return;
        }
        const stored = decision.stored;
        const currentSerialization = serializeGameState(gameRef.current);
        if (currentSerialization === null) {
          setSaveStatus("unsaved");
          return;
        }
        if (stored.serialized === currentSerialization) {
          if (stored.revision >= storageRevision.current) {
            storageRevision.current = stored.revision;
            savedSerialization.current = stored.serialized;
            setSaveStatus("saved");
          }
          return;
        }
        if (stored.revision < storageRevision.current
          || (stored.revision === storageRevision.current && stored.serialized === savedSerialization.current)) return;
        setStorageConflict(stored);
        setSaveStatus("conflict");
      } catch {
          setSaveStatus("unsaved");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function loadSavedConflict() {
    if (!storageConflict) return;
    let selected = storageConflict;
    let currentStored = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      selected = newestStoredSession(selected, raw);
      currentStored = Boolean(raw && readStoredSession(raw)?.serialized === selected.serialized);
    } catch { /* keep the last valid conflict below */ }
    undoStack.current = [];
    storageRevision.current = selected.revision;
    savedSerialization.current = currentStored ? selected.serialized : "";
    gameRef.current = selected.state;
    setToxicPaymentDraft({ eventId: "", value: "0" });
    setToxicPaymentError("");
    setActiveModal(null);
    setGame(selected.state);
    setStorageConflict(null);
    setSaveStatus(currentStored ? "saved" : "unsaved");
    requestAnimationFrame(() => selected.state.gameOver
      ? document.querySelector<HTMLHeadingElement>("dialog[open] .modal-header h2")?.focus()
      : encounterHeading.current?.focus());
  }

  function keepLocalConflict() {
    if (!storageConflict) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      let stored: StorageConflict | null = null;
      if (raw) {
        stored = readStoredSession(raw);
        if (!stored) {
          if (window.localStorage.getItem(STORAGE_KEY) !== raw) {
            setSaveStatus("unsaved");
            return;
          }
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
      const revision = nextStorageRevision(storageRevision.current, storageConflict.revision, stored?.revision ?? 0);
      if (revision === null || !writeStoredSession(window.localStorage, STORAGE_KEY, revision, gameRef.current)) {
        setSaveStatus("unsaved");
        return;
      }
      storageRevision.current = revision;
      savedSerialization.current = serializeGameState(gameRef.current) ?? "";
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
      return;
    }
    setStorageConflict(null);
    requestAnimationFrame(() => activeModal || game.gameOver
      ? document.querySelector<HTMLHeadingElement>("dialog[open] .modal-header h2")?.focus()
      : encounterHeading.current?.focus());
  }

  // Move focus only when the encounter or response step changes.
  useEffect(() => {
    const eventKey = `${game.seed}:${game.eventCounter}`;
    if (previousEventKey.current !== eventKey) encounterHeading.current?.focus();
    else if (previousResponseStage.current !== game.responseStage) responseStep.current?.focus();
    previousEventKey.current = eventKey;
    previousResponseStage.current = game.responseStage;
  }, [game.eventCounter, game.responseStage, game.seed]);

  useEffect(() => {
    if (storageConflict) storageConflictHeading.current?.focus();
  }, [activeModal, game.gameOver, storageConflict]);

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
  const sourceAvatarIndex = game.opponents.findIndex((opponent) => opponent.id === game.currentEvent.sourceId) + 1;
  const incomingDamageSteps = game.currentEvent.attackers
    ? buildDefaultCombatDamageSteps(game.currentEvent.attackers)
    : [];
  const incomingLifeTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, step.lifeDamage), 0);
  const incomingPoisonTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, step.poisonCounters), 0);
  const incomingCommanderTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, Object.values(step.commanderHits).reduce((subtotal, damage) => addSafeInteger(subtotal, damage), 0)), 0);
  const incomingLifelinkTotal = incomingDamageSteps.reduce((sum, step) => addSafeInteger(sum, step.lifelinkGain), 0);
  const opponentCommanderLabels = Object.fromEntries(game.opponents.flatMap((opponent) => [
    [opponentCommanderKey(opponent.id), `${opponent.name}’s primary commander`],
    [opponentCommanderKey(opponent.id, "partner"), `${opponent.name}’s partner commander`],
  ]));
  const incomingCommanderLabels = {
    ...Object.fromEntries((game.currentEvent.attackers ?? [])
      .filter((attacker) => attacker.isCommander && attacker.commanderId)
      .map((attacker) => [attacker.commanderId as string, attacker.commanderLabel ?? attacker.name])),
    ...USER_COMMANDER_LABELS,
    ...opponentCommanderLabels,
  };
  const livingOpponents = game.opponents.filter((opponent) => !opponent.eliminated);
  const activeThreatOwner = game.activeThreat ? game.opponents.find((opponent) => opponent.id === game.activeThreat?.ownerId) : undefined;
  const usedCommanderSlots = new Set(outgoingAttackers.flatMap((attacker) => attacker.isCommander && attacker.commanderSlot ? [attacker.commanderSlot] : []));

  function resolveEvent(title: string, detail: string, tone: HistoryTone, patch: Partial<GameState> | ((previous: GameState) => Partial<GameState>) = {}, answered = false) {
    commit((previous) => ({
      ...previous,
      ...(typeof patch === "function" ? patch(previous) : patch),
      answeredCount: addSafeInteger(previous.answeredCount, Number(answered)),
      responseStage: "resolved",
      resolution: detail,
      history: [historyEntry(previous, title, detail, tone), ...previous.history].slice(0, 40),
    }));
  }

  function readToxicPayment(event: SimEvent) {
    const paymentText = toxicPaymentDraft.eventId === event.id ? toxicPaymentDraft.value.trim() : "0";
    const payment = paymentText ? Number(paymentText) : Number.NaN;
    const actingOpponent = game.opponents.find((opponent) => opponent.id === event.sourceId);
    if (!Number.isSafeInteger(payment) || payment < 0 || payment > Math.max(0, actingOpponent?.life ?? 0)) {
      setToxicPaymentError(payment > Math.max(0, actingOpponent?.life ?? 0)
        ? "The life payment cannot exceed the acting opponent’s current life."
        : "Enter a nonnegative whole-number life payment.");
      return null;
    }
    return payment;
  }

  function sourceLifeLossPatch(previous: GameState, event: SimEvent, amount: number, extra: Partial<GameState> = {}): Partial<GameState> {
    let sourceEliminated = false;
    const opponents = previous.opponents.map((opponent) => {
      if (opponent.id !== event.sourceId) return opponent;
      const life = addSafeInteger(opponent.life, -amount);
      const loss = trackedLossReason(opponent.name, life, opponent.poisonCounters, opponent.commanderDamage, opponent.lossProtected);
      sourceEliminated = Boolean(loss);
      return { ...opponent, life, eliminated: opponent.eliminated || sourceEliminated };
    });
    return {
      ...extra,
      opponents,
      activeThreat: sourceEliminated && previous.activeThreat?.ownerId === event.sourceId ? null : previous.activeThreat,
      gameOver: opponents.every((opponent) => opponent.eliminated) ? "Every simulated opponent has left the game." : previous.gameOver,
    };
  }

  function resolveToxicFromPrompt(event: SimEvent, amount: number, title: string, detail: string, tone: HistoryTone) {
    commit((previous) => {
      const patch = sourceLifeLossPatch(previous, event, amount, { toxicDelugePayment: { eventId: event.id, amount } });
      const sourceEliminated = patch.opponents?.find((opponent) => opponent.id === event.sourceId)?.eliminated ?? false;
      const finalDetail = sourceEliminated
        ? `${event.sourceName} paid ${amount} life for Toxic Deluge, then left the game before priority; their spell was removed from the stack.`
        : detail;
      return {
        ...previous,
        ...patch,
        responseStage: "resolved",
        resolution: finalDetail,
        history: [historyEntry(previous, sourceEliminated ? "Casting cost paid" : title, finalDetail, sourceEliminated ? "warning" : tone), ...previous.history].slice(0, 40),
      };
    });
    setToxicPaymentError("");
  }

  function recordEmptyOutcome() {
    const event = game.currentEvent;
    if (event.templateId === "minus-wipe") {
      const payment = readToxicPayment(event);
      if (payment === null) return;
      resolveToxicFromPrompt(
        event,
        payment,
        "Action does not affect you",
        `${event.emptyOutcome ?? "The table action did not affect you."} ${event.sourceName} still pays ${payment} life as Toxic Deluge’s additional cost.`,
        "neutral",
      );
      return;
    }
    const sourceLifeLoss = event.templateId === "remove-engine" ? 3 : undefined;
    const accounting = event.templateId === "remove-engine"
      ? ` ${event.sourceName} loses 3 life after the spell resolves on another legal target.`
      : "";
    resolveEvent(
      "Action does not affect you",
      `${event.emptyOutcome ?? "The table action did not affect you."}${accounting}`,
      "neutral",
      sourceLifeLoss === undefined
        ? {}
        : (previous) => sourceLifeLossPatch(previous, event, sourceLifeLoss),
    );
    setToxicPaymentError("");
  }

  function beginResponse() {
    const event = game.currentEvent;
    if (event.templateId !== "minus-wipe") {
      setGame((previous) => ({ ...previous, responseStage: "choose" }));
      return;
    }
    const payment = readToxicPayment(event);
    if (payment === null) return;
    commit((previous) => {
      const patch = sourceLifeLossPatch(previous, event, payment, { toxicDelugePayment: { eventId: event.id, amount: payment } });
      const sourceEliminated = patch.opponents?.find((opponent) => opponent.id === event.sourceId)?.eliminated ?? false;
      const detail = sourceEliminated
        ? `${event.sourceName} paid ${payment} life for Toxic Deluge, then left the game before the response window; their spell was removed from the stack.`
        : `${event.sourceName} paid ${payment} life for Toxic Deluge. X is locked at ${payment} for this response window.`;
      return {
        ...previous,
        ...patch,
        responseStage: sourceEliminated ? "resolved" : "choose",
        resolution: detail,
        history: [historyEntry(previous, "Casting cost paid", detail, sourceEliminated ? "warning" : "damage"), ...previous.history].slice(0, 40),
      };
    });
    setToxicPaymentError("");
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
      resolveEvent("Threat established", `${event.sourceName}’s ${event.card} is now on a ${event.threat.remaining}-round clock.`, "warning", { activeThreat: event.threat });
      return;
    }
    if (event.templateId === "early-rock") {
      const detail = `${event.card} resolves. You gain 4 life; apply the generated outcome in your playtester.`;
      resolveEvent("Table action resolves", detail, "damage", (previous) => ({ userLife: addSafeInteger(previous.userLife, 4) }));
      return;
    }
    if (event.templateId === "remove-engine" || event.templateId === "minus-wipe") {
      const lockedPayment = game.toxicDelugePayment?.eventId === event.id ? game.toxicDelugePayment.amount : undefined;
      const paymentAlreadyRecorded = event.templateId === "minus-wipe" && lockedPayment !== undefined;
      if (event.templateId === "minus-wipe" && game.responseStage !== "prompt" && lockedPayment === undefined) {
        setGame((previous) => ({ ...previous, responseStage: "prompt", counterExchange: 0 }));
        setToxicPaymentError("Re-enter the life payment before reopening the response window.");
        return;
      }
      const amount = event.templateId === "minus-wipe" ? (paymentAlreadyRecorded ? lockedPayment : readToxicPayment(event)) : 3;
      if (amount === null) return;
      const detail = event.templateId === "remove-engine"
        ? `${event.card} resolves. ${event.sourceName} loses 3 life; apply the generated outcome in your playtester.`
        : paymentAlreadyRecorded
          ? `${event.card} resolves with the ${lockedPayment}-life payment already recorded; apply X = ${lockedPayment} in your playtester.`
          : `${event.sourceName} pays ${amount} life for ${event.card}; apply X = ${amount} in your playtester.`;
      if (event.templateId === "minus-wipe" && !paymentAlreadyRecorded) {
        resolveToxicFromPrompt(event, amount, "Table action resolves", detail, "warning");
        return;
      }
      resolveEvent(
        "Table action resolves",
        detail,
        event.kind === "wipe" ? "warning" : "damage",
        event.templateId === "remove-engine"
          ? (previous) => sourceLifeLossPatch(previous, event, amount)
          : {},
      );
      setToxicPaymentError("");
      return;
    }
    resolveEvent("Table action resolves", `${event.card}: apply the generated outcome in your playtester, then advance the table.`, event.kind === "wipe" ? "warning" : "damage");
  }

  function answerEvent(answer: ResponseOption) {
    const event = game.currentEvent;
    if ((game.responseStage !== "choose" && game.responseStage !== "counterback") || !event.responseOptions.includes(answer)) return;
    const lockedToxicPayment = game.toxicDelugePayment?.eventId === event.id ? game.toxicDelugePayment.amount : undefined;
    if (event.templateId === "minus-wipe" && lockedToxicPayment === undefined) {
      setGame((previous) => ({ ...previous, responseStage: "prompt", counterExchange: 0 }));
      setToxicPaymentError("Re-enter the life payment before reopening the response window.");
      return;
    }
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
      resolveEvent(
        "Action answered",
        `Your counter resolves and stops the table action.${event.templateId === "minus-wipe" ? ` Toxic Deluge’s ${lockedToxicPayment}-life casting cost was already recorded.` : ""}`,
        "success",
        { counterExchange },
        true,
      );
      setToxicPaymentError("");
      return;
    }
    const labels: Record<Exclude<ResponseOption, "counter">, string> = {
      protect: "Resolve the legal protection effect you used in your playtester.",
      redirect: "You changed the target; apply the new target in your playtester.",
      custom: "You supplied another legal answer; apply its exact result in your playtester.",
    };
    const redirectedAnguishedUnmaking = event.templateId === "remove-engine" && answer === "redirect";
    const sourceLifeLoss = redirectedAnguishedUnmaking ? 3 : undefined;
    const accounting = event.templateId === "minus-wipe"
      ? ` Toxic Deluge’s ${lockedToxicPayment}-life casting cost was already recorded.`
      : redirectedAnguishedUnmaking
        ? ` ${event.sourceName} loses 3 life after the redirected spell resolves.`
        : "";
    const detail = event.kind === "signature" ? `${event.card}: ${labels[answer]}` : labels[answer];
    resolveEvent(
      "Action answered",
      `${detail}${accounting}`,
      "success",
      sourceLifeLoss === undefined ? {} : (previous) => sourceLifeLossPatch(previous, event, sourceLifeLoss),
      true,
    );
    setToxicPaymentError("");
  }

  function applyIncoming(steps: readonly CombatDamageStep[], label: string, answered = false, lossProtected = game.userLossProtected) {
    commit((previous) => {
      const result = resolveCombatDamage({
        state: {
          life: previous.userLife,
          poisonCounters: previous.userPoisonCounters,
          commanderDamage: previous.userCommanderDamage,
        },
        steps,
        lossProtected,
      });
      const trackedLoss = evaluateTrackedLoss({ life: result.life, poisonCounters: result.poisonCounters, commanderDamage: result.commanderDamage }, lossProtected);
      const commanderDamage = result.stepsApplied.reduce((total, stepName) => {
        const step = steps.find((candidate) => candidate.step === stepName);
        return addSafeInteger(total, Object.values(step?.commanderHits ?? {}).reduce((subtotal, damage) => addSafeInteger(subtotal, damage), 0));
      }, 0);
      const sourceName = previous.currentEvent.sourceName;
      const opponents = previous.opponents.map((opponent) => opponent.id === previous.currentEvent.sourceId
        ? { ...opponent, life: addSafeInteger(opponent.life, result.lifelinkGain) }
        : opponent);
      const lossReason = trackedLoss?.reason === "life"
        ? `You reached ${result.life} life after ${sourceName}’s attack`
        : trackedLoss?.reason === "poison"
          ? `You reached ${result.poisonCounters} poison counters`
          : trackedLoss?.reason === "commander"
            ? `${incomingCommanderLabels[trackedLoss.lethalCommander ?? ""] ?? trackedLoss.lethalCommander ?? "A commander"} reached 21 commander damage`
            : null;
      const parts = [
        `${result.stepsApplied.map((step) => step === "first" ? "first-strike" : "regular").join(" and ") || "no"} damage step${result.stepsApplied.length === 1 ? "" : "s"} applied`,
        `${result.lifeDamage} life damage`,
        `${result.poisonAdded} poison`,
        `${commanderDamage} commander damage`,
        `${sourceName} gained ${result.lifelinkGain} life from lifelink`,
      ];
      if (lossProtected) parts.push("your ongoing effect says you can’t lose until you end it");
      if (lossReason) parts.push(lossReason);
      const detail = `${parts.join("; ")}.`;
      return {
        ...previous,
        userLife: result.life,
        userPoisonCounters: result.poisonCounters,
        userLossProtected: lossProtected,
        userCommanderDamage: result.commanderDamage,
        opponents,
        gameOver: trackedLoss && lossReason ? `${lossReason}.` : previous.gameOver,
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
    applyIncoming(
      stepsFromForm(data, "incoming", incomingDamageSteps, Object.keys(incomingCommanderLabels)),
      "Combat resolved",
      data.get("incoming-answered") === "on",
      data.get("incoming-loss-protected") === "on",
    );
  }

  function advanceTurn() {
    commit((previous) => {
      const userLoss = trackedLossReason("You", previous.userLife, previous.userPoisonCounters, previous.userCommanderDamage, previous.userLossProtected);
      if (userLoss) return { ...previous, gameOver: userLoss };
      const opponents = previous.opponents.map((opponent) => ({
        ...opponent,
        eliminated: opponent.eliminated || Boolean(trackedLossReason(opponent.name, opponent.life, opponent.poisonCounters, opponent.commanderDamage, opponent.lossProtected)),
      }));
      if (opponents.every((opponent) => opponent.eliminated)) {
        return { ...previous, opponents, activeThreat: null, gameOver: "You eliminated every simulated opponent." };
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
            activeThreat: null,
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
        opponents,
        recentTemplateIds,
        activeThreat: Boolean(activeThreat),
        combatResolvedTurn: previous.combatResolvedTurn,
        signatureFollowUp: signatureFollowUpFor(previous),
      });
      return {
        ...previous,
        turn,
        opponents,
        eventCounter,
        currentEvent,
        responseStage: "prompt",
        resolution: "",
        toxicDelugePayment: null,
        counterExchange: 0,
        activeThreat,
        recentTemplateIds,
      };
    });
  }

  function continueAfterGameOver() {
    setGame((previous) => {
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
        toxicDelugePayment: null,
        counterExchange: 0,
      };
    });
  }

  function adjustPlayerStat(target: "user" | string, stat: "life" | "poison", amount: number) {
    commit((previous) => {
      if (target === "user") {
        if (stat === "life") {
          const userLife = addSafeInteger(previous.userLife, amount);
          const gameOver = trackedLossReason("You", userLife, previous.userPoisonCounters, previous.userCommanderDamage, previous.userLossProtected);
          return { ...previous, userLife, gameOver: gameOver ?? previous.gameOver };
        }
        const userPoisonCounters = Math.max(0, addSafeInteger(previous.userPoisonCounters, amount));
        const gameOver = trackedLossReason("You", previous.userLife, userPoisonCounters, previous.userCommanderDamage, previous.userLossProtected);
        return { ...previous, userPoisonCounters, gameOver: gameOver ?? previous.gameOver };
      }

      const opponents = previous.opponents.map((opponent) => {
        if (opponent.id !== target) return opponent;
        const life = stat === "life" ? addSafeInteger(opponent.life, amount) : opponent.life;
        const poisonCounters = stat === "poison" ? Math.max(0, addSafeInteger(opponent.poisonCounters, amount)) : opponent.poisonCounters;
        const defeated = Boolean(trackedLossReason(opponent.name, life, poisonCounters, opponent.commanderDamage, opponent.lossProtected));
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

  function focusPlayer(target: "user" | string) {
    requestAnimationFrame(() => document.getElementById(target === "user" ? "tracked-player-user" : `tracked-player-${encodeURIComponent(target)}`)?.focus());
  }

  function openCorrection(target: "user" | string) {
    setCorrectionTarget(target);
    setActiveModal("totals");
  }

  function endLossProtection(target: "user" | string) {
    let terminal = false;
    commit((previous) => {
      if (target === "user") {
        const gameOver = trackedLossReason("You", previous.userLife, previous.userPoisonCounters, previous.userCommanderDamage);
        terminal = Boolean(gameOver);
        const detail = gameOver ? `Your loss-prevention effect ended. ${gameOver}` : "Your loss-prevention effect ended at safe tracked totals.";
        return {
          ...previous,
          userLossProtected: false,
          gameOver: gameOver ?? previous.gameOver,
          history: [historyEntry(previous, "Loss prevention ended", detail, gameOver ? "warning" : "neutral"), ...previous.history].slice(0, 40),
        };
      }
      let targetEliminated = false;
      const opponents = previous.opponents.map((opponent) => {
        if (opponent.id !== target) return opponent;
        targetEliminated = Boolean(trackedLossReason(opponent.name, opponent.life, opponent.poisonCounters, opponent.commanderDamage));
        return { ...opponent, lossProtected: false, eliminated: opponent.eliminated || targetEliminated };
      });
      terminal = targetEliminated;
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const detail = targetEliminated ? "The ongoing loss-prevention effect ended at lethal tracked totals." : "The ongoing loss-prevention effect ended at safe tracked totals.";
      const sourceEliminated = targetEliminated && previous.responseStage !== "resolved" && previous.currentEvent.sourceId === target;
      const sourceResolution = `${previous.currentEvent.sourceName} left the game, so their pending action was removed from the stack or combat.`;
      return {
        ...previous,
        opponents,
        activeThreat: targetEliminated && previous.activeThreat?.ownerId === target ? null : previous.activeThreat,
        gameOver: tableDefeated ? "You eliminated every simulated opponent." : previous.gameOver,
        history: [historyEntry(previous, "Loss prevention ended", detail, targetEliminated ? "warning" : "neutral"), ...(sourceEliminated ? [historyEntry(previous, "Pending action cancelled", sourceResolution, "neutral")] : []), ...previous.history].slice(0, 40),
        ...(sourceEliminated ? { responseStage: "resolved" as const, resolution: sourceResolution } : {}),
      };
    });
    if (!terminal) focusPlayer(target);
  }

  function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const target = correctionTarget;
    let terminal = false;
    commit((previous) => {
      if (target === "user") {
        const commanderIds = [...new Set([...Object.keys(incomingCommanderLabels), ...Object.keys(previous.userCommanderDamage)])];
        const userLife = safeIntegerFromForm(data, "correction-life", previous.userLife);
        const userPoisonCounters = damageFromForm(data, "correction-poison", previous.userPoisonCounters);
        const userCommanderDamage = Object.fromEntries(commanderIds.map((id) => [id, damageFromForm(data, `correction-commander-${encodeURIComponent(id)}`, previous.userCommanderDamage[id] ?? 0)]));
        const userLossProtected = data.get("correction-loss-protected") === "on";
        const gameOver = trackedLossReason("You", userLife, userPoisonCounters, userCommanderDamage, userLossProtected)
          ?? (previous.opponents.every((opponent) => opponent.eliminated) ? "You eliminated every simulated opponent." : null);
        terminal = Boolean(gameOver);
        const detail = `Corrected your totals to ${userLife} life, ${userPoisonCounters} poison, and ${highestCommanderDamage(userCommanderDamage)} highest commander damage${userLossProtected ? "; ongoing loss prevention is active" : ""}.`;
        return {
          ...previous,
          userLife,
          userPoisonCounters,
          userCommanderDamage,
          userLossProtected,
          gameOver,
          history: [historyEntry(previous, "Tracked totals corrected", detail, "neutral"), ...previous.history].slice(0, 40),
        };
      }

      let correctedName = "Opponent";
      let targetEliminated = false;
      const opponents = previous.opponents.map((opponent) => {
        if (opponent.id !== target) return opponent;
        correctedName = opponent.name;
        const commanderIds = [...new Set([...Object.keys(incomingCommanderLabels), ...Object.keys(opponent.commanderDamage)])];
        const life = safeIntegerFromForm(data, "correction-life", opponent.life);
        const poisonCounters = damageFromForm(data, "correction-poison", opponent.poisonCounters);
        const commanderDamage = Object.fromEntries(commanderIds.map((id) => [id, damageFromForm(data, `correction-commander-${encodeURIComponent(id)}`, opponent.commanderDamage[id] ?? 0)]));
        const lossProtected = data.get("correction-loss-protected") === "on";
        const trackedLoss = trackedLossReason(opponent.name, life, poisonCounters, commanderDamage, lossProtected);
        const restore = data.get("correction-restore") === "on";
        targetEliminated = Boolean(trackedLoss) || (opponent.eliminated && !restore);
        return { ...opponent, life, poisonCounters, commanderDamage, lossProtected, eliminated: targetEliminated };
      });
      const corrected = opponents.find((opponent) => opponent.id === target);
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const userLoss = trackedLossReason("You", previous.userLife, previous.userPoisonCounters, previous.userCommanderDamage, previous.userLossProtected);
      terminal = tableDefeated || Boolean(userLoss);
      const sourceEliminated = targetEliminated && previous.responseStage !== "resolved" && previous.currentEvent.sourceId === target;
      const sourceResolution = `${correctedName} left the game, so their pending action was removed from the stack or combat.`;
      const detail = corrected
        ? `Corrected ${corrected.name} to ${corrected.life} life, ${corrected.poisonCounters} poison, and ${highestCommanderDamage(corrected.commanderDamage)} highest commander damage${corrected.lossProtected ? "; ongoing loss prevention is active" : ""}${!corrected.eliminated && data.get("correction-restore") === "on" ? "; restored to the table" : ""}.`
        : "Corrected tracked totals.";
      return {
        ...previous,
        opponents,
        activeThreat: targetEliminated && previous.activeThreat?.ownerId === target ? null : previous.activeThreat,
        gameOver: tableDefeated ? "You eliminated every simulated opponent." : userLoss,
        history: [historyEntry(previous, "Tracked totals corrected", detail, "neutral"), ...(sourceEliminated ? [historyEntry(previous, "Pending action cancelled", sourceResolution, "neutral")] : []), ...previous.history].slice(0, 40),
        ...(sourceEliminated ? { responseStage: "resolved" as const, resolution: sourceResolution } : {}),
      };
    });
    setActiveModal(null);
    if (!terminal) focusPlayer(target);
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
      history: [historyEntry(previous, "Threat delayed", "You bought one additional round.", "success"), ...previous.history].slice(0, 40),
    }));
    requestAnimationFrame(() => threatHeading.current?.focus());
  }

  function removeSettingsOpponent(id: string, index: number) {
    setSettingsNameError("");
    setSettingsTableError("");
    setSettingsOpponents((current) => current.filter((opponent) => opponent.id !== id));
    requestAnimationFrame(() => {
      const inputs = settingsPanel.current?.querySelectorAll<HTMLInputElement>(".opponent-setting input");
      const nextInput = inputs?.[Math.min(index, inputs.length - 1)];
      if (nextInput) nextInput.focus();
      else settingsPanel.current?.querySelector<HTMLButtonElement>(".add-opponent")?.focus();
    });
  }

  function addSettingsOpponent() {
    setSettingsNameError("");
    setSettingsTableError("");
    setSettingsOpponents((current) => current.length >= 3 ? current : [...current, { id: crypto.randomUUID(), name: `Opponent ${current.length + 1}`, profile: "midrange", bracket: 3, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false }]);
    requestAnimationFrame(() => {
      const inputs = settingsPanel.current?.querySelectorAll<HTMLInputElement>(".opponent-setting input");
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  function openSettings() {
    setSettingsOpponents(cloneOpponents(game.opponents));
    setSettingsSeed(game.seed);
    setSettingsNameError("");
    setSettingsTableError("");
    setActiveModal("settings");
  }

  function configuredSettingsOpponents() {
    const names = settingsOpponents.map((opponent) => opponent.name.trim());
    if (names.some((name) => !name)) {
      setSettingsNameError("Give every opponent a name.");
      return null;
    }
    const normalizedNames = names.map((name) => name.toLocaleLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setSettingsNameError("Opponent names must be unique.");
      return null;
    }
    setSettingsNameError("");
    return settingsOpponents.map((opponent, index) => ({ ...opponent, name: names[index] }));
  }

  function saveSettings() {
    const opponents = configuredSettingsOpponents();
    if (!opponents) return;
    if (hasTrackedCommanderDamageFromRemovedOpponent(game, opponents)) {
      setSettingsTableError("This run has commander damage recorded from an opponent you removed. Use Start new run with this seed to remove them without losing the original commander identity.");
      return;
    }
    if (opponents.every((opponent) => opponent.eliminated)) {
      setSettingsTableError("The current run needs at least one active opponent. Start a new run to reset these matchups instead.");
      return;
    }
    setSettingsTableError("");
    const seed = settingsSeed.trim() || "GILDED-732";
    commit((previous) => {
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
      const currentEvent: SimEvent = isFollowUp ? { ...generatedEvent, tags: ["Follow-up action", ...generatedEvent.tags] } : generatedEvent;
      return {
        ...previous,
        seed,
        opponents,
        eventCounter,
        currentEvent,
        responseStage: "prompt",
        resolution: "",
        toxicDelugePayment: null,
        counterExchange: 0,
        activeThreat,
        recentTemplateIds,
        history,
      };
    });
    setToxicPaymentDraft({ eventId: "", value: "0" });
    setToxicPaymentError("");
    setActiveModal(null);
  }

  function startRun(seed: string, opponents: readonly Opponent[]) {
    const next = createInitialGame(seed, opponents.map((opponent) => ({
      ...opponent,
      life: 40,
      poisonCounters: 0,
      commanderDamage: {},
      lossProtected: false,
      eliminated: false,
    })));
    undoStack.current = [];
    gameRef.current = next;
    setToxicPaymentDraft({ eventId: "", value: "0" });
    setToxicPaymentError("");
    setGame(next);
    setActiveModal(null);
  }

  function startSeededRun() {
    const configured = configuredSettingsOpponents();
    if (!configured) return;
    setSettingsTableError("");
    startRun(settingsSeed.trim() || "GILDED-732", configured);
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
    setOutgoingAttackerError("");
    setActiveModal("combat");
  }

  function addOutgoingAttacker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const power = nonnegativeSafeInteger(attackerPower);
    if (power === null) return;
    if (attackerCommander && usedCommanderSlots.has(attackerCommanderSlot)) {
      setOutgoingAttackerError(`${USER_COMMANDER_LABELS[userCommanderKey(attackerCommanderSlot)]} is already in this attacking group.`);
      return;
    }
    const attacker: OutgoingAttacker = {
      id: crypto.randomUUID(),
      name: attackerName.trim() || (attackerCommander ? USER_COMMANDER_LABELS[userCommanderKey(attackerCommanderSlot)] : `Attacker ${outgoingAttackers.length + 1}`),
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
    setOutgoingAttackerError("");
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
    const steps = stepsFromForm(data, "outgoing", outgoingDamageSteps, Object.keys(USER_COMMANDER_LABELS));
    const lossProtected = data.get("outgoing-loss-protected") === "on";
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
        lossProtected,
      });
      const trackedLoss = evaluateTrackedLoss({ life: result.life, poisonCounters: result.poisonCounters, commanderDamage: result.commanderDamage }, lossProtected);
      const opponents = previous.opponents.map((opponent) => opponent.id === target.id
        ? { ...opponent, life: result.life, poisonCounters: result.poisonCounters, commanderDamage: result.commanderDamage, lossProtected, eliminated: opponent.eliminated || Boolean(trackedLoss) }
        : opponent);
      const reason = trackedLoss?.reason === "commander"
        ? `${USER_COMMANDER_LABELS[trackedLoss.lethalCommander ?? ""] ?? trackedLoss.lethalCommander} reached 21 commander damage.`
        : trackedLoss?.reason === "poison"
          ? `${target.name} reached ${result.poisonCounters} poison counters.`
          : trackedLoss?.reason === "life"
            ? `${target.name} reached ${result.life} life.`
            : "";
      const detail = `${result.stepsApplied.map((step) => step === "first" ? "First-strike" : "regular").join(" and ") || "No"} damage step${result.stepsApplied.length === 1 ? "" : "s"}: ${result.lifeDamage} life damage and ${result.poisonAdded} poison assigned to ${target.name}. You gained ${result.lifelinkGain} life from lifelink.${lossProtected ? ` ${target.name}’s ongoing effect says they can’t lose until you end it.` : ""}${reason ? ` ${reason}` : ""}`;
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const sourceEliminated = Boolean(trackedLoss) && previous.responseStage !== "resolved" && previous.currentEvent.sourceId === target.id;
      const sourceResolution = `${target.name} left the game, so their pending action was removed from the stack or combat.`;
      const damageHistory = historyEntry(previous, trackedLoss ? `${target.name} eliminated` : `Damage assigned to ${target.name}`, detail, trackedLoss ? "success" : "damage");
      return {
        ...previous,
        userLife: addSafeInteger(previous.userLife, result.lifelinkGain),
        defenseCounter: defenseRollCounter,
        answeredCount: addSafeInteger(previous.answeredCount, Number(defenseAnswered)),
        opponents,
        activeThreat: trackedLoss && previous.activeThreat?.ownerId === target.id ? null : previous.activeThreat,
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
    startRun(`CAST-${Date.now().toString(36).slice(-6).toUpperCase()}`, game.opponents);
  }

  const maxUserCommanderDamage = highestCommanderDamage(game.userCommanderDamage);
  const tableDefeated = game.opponents.every((opponent) => opponent.eliminated);
  const userDefeated = Boolean(evaluateTrackedLoss({ life: game.userLife, poisonCounters: game.userPoisonCounters, commanderDamage: game.userCommanderDamage }, game.userLossProtected));
  const eventCardLookup = game.currentEvent.kind === "attack" || game.currentEvent.templateId === "random-discard"
    ? null
    : game.currentEvent.card === "Thassa’s Oracle line" ? "Thassa’s Oracle" : game.currentEvent.card;
  // eslint-disable-next-line react-hooks/refs -- commit, undo, and reset pair each stack mutation with a game-state render
  const canUndo = undoStack.current.length > 0;
  const removedAttackerId = defense?.type === "removal" ? [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id : undefined;
  const outgoingFullDamageSteps = buildDefaultCombatDamageSteps(outgoingCombatAttackers(removedAttackerId));
  const outgoingDamageSteps = defense?.type === "fog" ? zeroCombatSteps(outgoingFullDamageSteps) : outgoingFullDamageSteps;
  const encounterGlossaryTerms = new Set<GlossaryKey>();
  const outgoingDamageTerms: GlossaryKey[] = [];
  if (outgoingAttackers.some((attacker) => attacker.isCommander)) outgoingDamageTerms.push("Commander damage");
  if (outgoingDamageSteps.some((step) => step.lifelinkGain > 0)) outgoingDamageTerms.push("Lifelink");
  const correctionOpponent = correctionTarget === "user" ? undefined : game.opponents.find((opponent) => opponent.id === correctionTarget);
  const correctionDamage = correctionTarget === "user" ? game.userCommanderDamage : correctionOpponent?.commanderDamage ?? {};
  const correctionLabels = incomingCommanderLabels;
  const correctionCommanderIds = [...new Set([...Object.keys(correctionLabels), ...Object.keys(correctionDamage)])];
  const correctionLife = correctionTarget === "user" ? game.userLife : correctionOpponent?.life ?? 40;
  const correctionPoison = correctionTarget === "user" ? game.userPoisonCounters : correctionOpponent?.poisonCounters ?? 0;
  const correctionLossProtected = correctionTarget === "user" ? game.userLossProtected : correctionOpponent?.lossProtected ?? false;
  const terminalCorrectionTarget: "user" | string = userDefeated ? "user" : game.opponents.find((opponent) => opponent.eliminated)?.id ?? "user";
  const saveStatusText: Record<SaveStatus, string> = {
    loading: "Loading saved session…",
    saved: "Saved locally",
    unsaved: "Changes are not saved",
    conflict: "Save conflict needs a choice",
    discarded: "Invalid saved draft discarded",
  };
  const liveMessage = (activeModal === "combat" && defense ? `Defense roll: ${defense.title}. ${defense.detail}` : null)
    ?? (game.responseStage === "counterback" ? "Your counter was countered. Choose whether to counter again or let the original action resolve." : null)
    ?? (game.responseStage === "choose" ? `Response choices are ready: ${game.currentEvent.responseOptions.join(", ")}.` : null)
    ?? (game.responseStage === "combat" ? "Ordered combat-damage fields are ready. Record life, poison, commander damage, and lifelink for each step." : null)
    ?? (game.responseStage !== "resolved" ? `${EVENT_PRESENTATION[game.currentEvent.kind].label}: ${game.currentEvent.title}` : game.resolution);
  const storageConflictNotice = storageConflict ? (
    <section className="storage-conflict" role="alert" aria-labelledby="storage-conflict-title">
      <div><h2 id="storage-conflict-title" ref={storageConflictHeading} tabIndex={-1}>This session changed in another tab.</h2><span>Choose which version to keep; nothing will be overwritten until you decide.</span></div>
      <div><button type="button" onClick={loadSavedConflict}>Load saved version</button><button type="button" onClick={keepLocalConflict}>Keep this tab</button></div>
    </section>
  ) : null;
  const hasOpenDialog = Boolean(activeModal || game.gameOver);
  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-workspace">Skip to table workspace</a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{game.gameOver ? "" : liveMessage}</div>

      {!hasOpenDialog && storageConflictNotice}

      <header className="topbar">
        <a className="brand" href="#main-workspace" aria-label="MTG Betafish — jump to table workspace">
          <span className="brand-fish" aria-hidden="true" />
          <span className="brand-title"><strong>MTG</strong><small>Betafish</small></span>
        </a>
        <div className="turn-strip" aria-label={`Round ${game.turn}`}>
          <span className="eyebrow">Round {game.turn}</span>
          <span className="turn-status-row">
            <b>{game.responseStage !== "resolved" ? "Response window open" : "Ready to advance"}</b>
            {game.activeThreat && <span className={`top-threat ${game.activeThreat.remaining <= 1 ? "imminent" : ""}`}>Threat · {game.activeThreat.remaining} {game.activeThreat.remaining === 1 ? "round" : "rounds"}</span>}
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
              <span className={game.currentEvent.kind === "threat" ? "danger-badge" : "source-badge"}>{game.currentEvent.sourceName} · Scenario card: <CardPreview name={game.currentEvent.card} lookupName={eventCardLookup} /></span>
            </div>
            <div className={`spell-art spell-art-${game.currentEvent.kind}`} aria-hidden="true"><span>{EVENT_PRESENTATION[game.currentEvent.kind].glyph}</span></div>
            <div className="encounter-copy">
              <p className="source"><span className={`avatar avatar-${sourceAvatarIndex}`}>{game.currentEvent.sourceName.slice(0, 1).toUpperCase()}</span> {game.currentEvent.sourceName} takes an action</p>
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
                      <div><strong>{attacker.name}</strong>{attacker.isCommander && <><span className="commander-badge">Commander</span><small className="commander-identity">{incomingCommanderLabels[attacker.commanderId ?? ""] ?? attacker.commanderLabel ?? "Original commander identity"}</small></>}</div>
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
              {game.currentEvent.templateId === "minus-wipe" && game.responseStage === "prompt" && (
                <label className="toxic-payment">Life paid for X
                  <input
                    aria-describedby={toxicPaymentError ? "toxic-payment-error" : undefined}
                    aria-invalid={Boolean(toxicPaymentError)}
                    min="0"
                    max={Math.max(0, sourceOpponent?.life ?? 0)}
                    required
                    step="1"
                    type="number"
                    value={toxicPaymentDraft.eventId === game.currentEvent.id ? toxicPaymentDraft.value : "0"}
                    onChange={(event) => { setToxicPaymentDraft({ eventId: game.currentEvent.id, value: event.target.value }); setToxicPaymentError(""); }}
                  />
                  <small>Enter the exact life {game.currentEvent.sourceName} pays. This sets Toxic Deluge’s X.</small>
                  {toxicPaymentError && <span className="inline-error" id="toxic-payment-error" role="alert">{toxicPaymentError}</span>}
                </label>
              )}
              {game.currentEvent.templateId === "minus-wipe"
                && (game.responseStage === "choose" || game.responseStage === "counterback")
                && game.toxicDelugePayment?.eventId === game.currentEvent.id
                && <p className="toxic-payment-locked">Toxic Deluge’s casting cost is paid and locked: {game.toxicDelugePayment.amount} life, so X = {game.toxicDelugePayment.amount} for this response window.</p>}
              {game.responseStage === "prompt" && game.currentEvent.kind !== "attack" && game.currentEvent.kind !== "development" && (
                <div className="response-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Do you have a response?</span>{game.currentEvent.kind !== "threat" && (game.currentEvent.kind === "targeted" || game.currentEvent.kind === "counter") && <GlossaryHelp terms={["Legal target"]} />}</div>
                  <div className="response-actions">
                    <button className="primary-button" type="button" onClick={beginResponse}>Yes, I respond <span aria-hidden="true">→</span></button>
                    <button className="secondary-button" type="button" onClick={letEventResolve}>No response</button>
                    {game.currentEvent.emptyOutcome && <button className="text-button" type="button" onClick={recordEmptyOutcome}>Generated action does not affect me</button>}
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
                  {game.currentEvent.templateId !== "minus-wipe" && <button className="text-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "prompt" }))}>Back</button>}
                </div>
              )}

              {game.responseStage === "counterback" && (
                <div className="response-box counterback-box">
                  <span className="danger-badge" ref={responseStep} tabIndex={-1}><GlossaryTerm term="Counter">Counter</GlossaryTerm> to your counter</span>
                  <h3>Your answer is countered.</h3>
                  <p>The response window remains open. Continue the exchange or let the original action resolve.</p>
                  <div className="response-actions two-actions">
                    <button className="primary-button" type="button" onClick={() => answerEvent("counter")}>I counter again <span aria-hidden="true">→</span></button>
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
                  <label className="check-label loss-override"><input name="incoming-loss-protected" type="checkbox" defaultChecked={game.userLossProtected} />An ongoing rule or effect says I can’t lose. Keep tracking lethal totals until I end that effect.</label>
                  <label className="check-label"><input name="incoming-answered" type="checkbox" />I answered part or all of this attack.</label>
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
              <button className="advance-button" type="button" onClick={advanceTurn} disabled={game.responseStage !== "resolved" || Boolean(game.gameOver)}>Next round <span aria-hidden="true">→</span></button>
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
              <article className={`opponent ${opponent.eliminated ? "eliminated" : ""}`} id={`tracked-player-${encodeURIComponent(opponent.id)}`} key={opponent.id} tabIndex={-1}>
                <span className={`avatar avatar-${index + 1}`}>{opponent.name.slice(0, 1).toUpperCase()}</span>
                <div className="opponent-copy"><strong>{opponent.name}</strong><small>{opponent.eliminated ? "Eliminated" : `${PROFILE_LABELS[opponent.profile]} · ${bracketLabel(opponent.bracket)}`}</small>{opponent.lossProtected && <span className="protection-badge">Can’t lose · ongoing</span>}<CommanderLedger damage={opponent.commanderDamage} labels={incomingCommanderLabels} /></div>
                <div className="life-control">
                  <button type="button" onClick={() => adjustLife(opponent.id, -1)} aria-label={`Remove one life from ${opponent.name}`}>−</button>
                  <span className="life" aria-live="polite"><b>{opponent.life}</b><small>life</small></span>
                  <button type="button" onClick={() => adjustLife(opponent.id, 1)} aria-label={`Add one life to ${opponent.name}`}>+</button>
                </div>
                <div className="poison-control"><button type="button" onClick={() => adjustPoison(opponent.id, -1)} aria-label={`Remove one poison counter from ${opponent.name}`}>−</button><span aria-live="polite" aria-atomic="true">Poison {opponent.poisonCounters}/10</span><button type="button" onClick={() => adjustPoison(opponent.id, 1)} aria-label={`Add one poison counter to ${opponent.name}`}>+</button></div>
                <div className="tracked-actions"><button type="button" onClick={() => openCorrection(opponent.id)}>Correct totals</button>{opponent.lossProtected && <button type="button" onClick={() => endLossProtection(opponent.id)}>End effect</button>}</div>
              </article>
            ))}
          </div>
          <article className="you-card" id="tracked-player-user" tabIndex={-1}>
            <span className="avatar avatar-you">You</span>
            <div className="opponent-copy"><strong>Your board</strong><small>Highest <GlossaryTerm term="Commander damage">commander damage</GlossaryTerm>: {maxUserCommanderDamage}</small>{game.userLossProtected && <span className="protection-badge protection-badge-dark">Can’t lose · ongoing</span>}<CommanderLedger damage={game.userCommanderDamage} labels={incomingCommanderLabels} dark /></div>
            <div className="life-control life-control-dark">
              <button type="button" onClick={() => adjustLife("user", -1)} aria-label="Remove one life from you">−</button>
              <span className="life" aria-live="polite"><b>{game.userLife}</b><small>life</small></span>
              <button type="button" onClick={() => adjustLife("user", 1)} aria-label="Add one life to you">+</button>
            </div>
            <div className="poison-control poison-control-dark"><button type="button" onClick={() => adjustPoison("user", -1)} aria-label="Remove one poison counter from you">−</button><span aria-live="polite" aria-atomic="true">Poison {game.userPoisonCounters}/10</span><button type="button" onClick={() => adjustPoison("user", 1)} aria-label="Add one poison counter to you">+</button></div>
            <div className="tracked-actions tracked-actions-dark"><button type="button" onClick={() => openCorrection("user")}>Correct totals</button>{game.userLossProtected && <button type="button" onClick={() => endLossProtection("user")}>End effect</button>}</div>
          </article>
          <button className="secondary-wide" type="button" onClick={openCombat} disabled={!livingOpponents.length}>Assign your combat damage <span aria-hidden="true">→</span></button>
          <p className="rail-note">Tap attackers in your playtester, then let this table roll a defense.</p>
        </aside>

        <aside className="rail pressure-panel" aria-label="Table pressure">
          <section aria-labelledby="threat-title" aria-live="polite">
            <div className="section-heading">
              <div><h2 id="threat-title" ref={threatHeading} tabIndex={-1}>Active threat</h2></div>
              {game.activeThreat && <span className={`countdown ${game.activeThreat.remaining <= 1 ? "imminent" : ""}`}>{game.activeThreat.remaining} {game.activeThreat.remaining === 1 ? "round" : "rounds"}</span>}
            </div>
            {game.activeThreat ? (
              <article className="threat-card">
                <span className="threat-icon" aria-hidden="true">!</span>
                <div><strong><GlossaryText text={game.activeThreat.title} /></strong>{activeThreatOwner && <small className="threat-owner">Owner: {activeThreatOwner.name} · {PROFILE_LABELS[activeThreatOwner.profile]} · {bracketLabel(activeThreatOwner.bracket)}</small>}<p><GlossaryText text={game.activeThreat.description} /></p></div>
                <div className="threat-actions">
                  <button className="text-button light" type="button" onClick={stopThreat}>I answered this threat</button>
                  <button className="text-button light" type="button" onClick={delayThreat} disabled={game.activeThreat.delayed}>{game.activeThreat.delayed ? "Already delayed" : "Delay +1 round"}</button>
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
                <li key={entry.id}><span className={`history-dot ${entry.tone}`} aria-hidden="true">{entry.tone === "success" ? "✓" : entry.tone === "warning" ? "!" : entry.tone === "damage" ? "−" : "·"}</span><div><strong>{entry.title}</strong><small>Round {entry.turn} · {entry.detail}</small></div></li>
              ))}
            </ol>
          </section>
        </aside>
      </section>

      <footer className="session-footer">
        <span>Session seed <b>{game.seed}</b></span>
        <button type="button" onClick={() => setActiveModal("library")}>Scenario library · {CARD_LIBRARY_UPDATED}</button>
        <span className={`save-status save-status-${saveStatus}`} role="status">{hydrated ? saveStatusText[saveStatus] : "Loading saved session…"}</span>
        <button type="button" onClick={() => setActiveModal("reset")}>Restart session</button>
      </footer>

      {activeModal === "settings" && (
        <Modal title="Set up the table" subtitle="Choose one to three matchups. Each profile-and-bracket pairing has its own core-card package, pacing, and interaction frequency." onClose={() => setActiveModal(null)} wide>
          {storageConflictNotice}
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
                    <label>Name<input aria-describedby={settingsNameError ? "settings-name-error" : undefined} aria-invalid={Boolean(settingsNameError)} value={opponent.name} onChange={(event) => { setSettingsNameError(""); setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, name: event.target.value } : item)); }} /></label>
                    <label>Deck profile<select value={opponent.profile} aria-describedby={profileDescriptionId} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, profile: event.target.value as ProfileId } : item))}>{Object.entries(PROFILE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                    <label>Commander bracket<select value={bracket} aria-describedby={bracketDescriptionId} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, bracket: Number(event.target.value) as CommanderBracket } : item))}>{Object.entries(COMMANDER_BRACKETS).map(([value, rules]) => <option value={value} key={value}>B{value} {rules.label}</option>)}</select></label>
                    <button className="remove-button" type="button" onClick={() => removeSettingsOpponent(opponent.id, index)} disabled={settingsOpponents.length === 1} aria-label={`Remove ${opponent.name}`}>Remove</button>
                    <div className="profile-setting-copy" id={profileDescriptionId}><p><GlossaryText text={profile.description} /></p><p><strong>B{bracket} core cards:</strong> {coreCards.map((card, cardIndex) => <span key={card}>{cardIndex > 0 && " · "}<CardPreview name={card} />{GAME_CHANGER_CARDS.has(card) && <small className="game-changer-label"> Game Changer</small>}</span>)} <span>(possible matchup sightings; not a complete decklist or guaranteed draw)</span></p></div>
                    <p className="bracket-setting-copy" id={bracketDescriptionId}><strong>{bracketLabel(bracket)}:</strong> {bracketRules.summary} {bracketRules.turnGuide}</p>
                  </fieldset>
                );
              })}
              {settingsNameError && <p className="inline-error settings-error" id="settings-name-error" role="alert">{settingsNameError}</p>}
              {settingsTableError && <p className="inline-error settings-error" role="alert">{settingsTableError}</p>}
              <button className="add-opponent" type="button" onClick={addSettingsOpponent} disabled={settingsOpponents.length >= 3}>+ Add opponent</button>
            </div>
            <div className="session-settings">
              <label>Session seed<input value={settingsSeed} onChange={(event) => setSettingsSeed(event.target.value.toUpperCase())} maxLength={24} /></label>
              <p>Reuse a seed with the same choices to replay the same event sequence.</p>
              <p>Apply and reroll updates this run. After resolution, it generates one follow-up action this round; if combat already occurred, that follow-up will not be another combat. Start a new run resets to round 1 and event 1 using this exact seed.</p>
              <div className="bracket-guide"><span className="eyebrow">Bracket guide</span><strong>Official intent, Betafish-tuned odds</strong><p>MTG Betafish translates Wizards’ bracket pacing guidance into when pressure and game-ending clocks may appear. It also scales attacks, counters, removal, and defenses as simulation heuristics.</p><ol>{Object.entries(COMMANDER_BRACKETS).map(([value, rules]) => <li key={value}><b>B{value}</b><span>{rules.label}</span><small>{rules.turnGuide}</small></li>)}</ol><a href="https://magic.wizards.com/en/formats/commander" target="_blank" rel="noreferrer">View Wizards’ beta bracket guide <span aria-hidden="true">↗</span></a></div>
              <p>Profiles are abstract matchup presets, not complete color-identity-checked decklists.</p>
            </div>
          </div>
          <div className="modal-actions settings-actions"><button className="text-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="secondary-button" type="button" onClick={saveSettings}>{game.responseStage === "resolved" ? "Apply and generate follow-up" : "Apply and reroll"}</button><button className="primary-button" type="button" onClick={startSeededRun}>Start new run with this seed <span aria-hidden="true">→</span></button></div>
        </Modal>
      )}

      {activeModal === "combat" && (
        <Modal title="Assign your attack" subtitle="Record one defending player per submission. Reopen this form for another defender or an externally created extra combat; the simulated round will not advance." onClose={() => setActiveModal(null)} wide>
          {storageConflictNotice}
          <div className="combat-builder">
            <label className="target-select">Attack target<select value={combatTarget} onChange={(event) => { setCombatTarget(event.target.value); setDefense(null); setDefenseAnswered(false); }}>{livingOpponents.map((opponent) => <option value={opponent.id} key={opponent.id}>{opponent.name} · {PROFILE_LABELS[opponent.profile]} · {bracketLabel(opponent.bracket)} · {opponent.life} life · {opponent.poisonCounters} poison</option>)}</select></label>
            <form className="attacker-form" onSubmit={addOutgoingAttacker}>
              <label>Attacker name<input ref={attackerNameInput} placeholder="e.g. Atraxa" value={attackerName} onChange={(event) => setAttackerName(event.target.value)} /></label>
              <label>Power<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" value={attackerPower} onChange={(event) => setAttackerPower(nonnegativeSafeInteger(Number(event.target.value)) ?? 0)} /></label>
              <label className="check-label"><input type="checkbox" checked={attackerCommander} onChange={(event) => { const checked = event.target.checked; setAttackerCommander(checked); setOutgoingAttackerError(""); if (checked && usedCommanderSlots.has(attackerCommanderSlot)) setAttackerCommanderSlot(usedCommanderSlots.has("primary") ? "partner" : "primary"); }} />Commander</label>
              {attackerCommander && <label>Original commander identity<select aria-describedby={outgoingAttackerError ? "outgoing-attacker-error" : undefined} aria-invalid={Boolean(outgoingAttackerError)} value={attackerCommanderSlot} onChange={(event) => { setAttackerCommanderSlot(event.target.value as CommanderSlot); setOutgoingAttackerError(""); }}><option value="primary" disabled={usedCommanderSlots.has("primary")}>Your primary commander</option><option value="partner" disabled={usedCommanderSlots.has("partner")}>Your partner commander</option></select><small>Commander damage follows this card’s original identity even if another player controls it. Each identity can appear once in this attacking group.</small></label>}
              <fieldset className="keyword-picker event-fieldset"><legend className="sr-only">Attacker keywords</legend><GlossaryHelp label="Keyword help" terms={COMBAT_KEYWORDS} />{COMBAT_KEYWORDS.map((keyword) => <label key={keyword}><input type="checkbox" checked={attackerKeywords.includes(keyword)} onChange={() => setAttackerKeywords((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword])} />{keyword}</label>)}</fieldset>
              <button className="secondary-button add-attacker-button" type="submit">Add attacker</button>
              {outgoingAttackerError && <p className="inline-error attacker-error" id="outgoing-attacker-error" role="alert">{outgoingAttackerError}</p>}
            </form>

            <div className="outgoing-list" ref={outgoingList}>
              {outgoingAttackers.length ? outgoingAttackers.map((attacker, index) => (
                <article key={attacker.id}><div><strong>{attacker.name}</strong><small>{attacker.isCommander ? USER_COMMANDER_LABELS[userCommanderKey(attacker.commanderSlot ?? "primary")] : "Creature"}</small></div><b>{attacker.power} power</b><div className="keyword-row">{attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />)}</div><button type="button" onClick={() => removeOutgoingAttacker(attacker.id, index)} aria-label={`Remove ${attacker.name}`}>×</button></article>
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
                <label className="check-label loss-override"><input name="outgoing-loss-protected" type="checkbox" defaultChecked={game.opponents.find((opponent) => opponent.id === combatTarget)?.lossProtected} />An ongoing rule or effect says this defender can’t lose. Keep tracking lethal totals until that effect ends.</label>
                <p className="boundary-note">This submission records only {game.opponents.find((opponent) => opponent.id === combatTarget)?.name ?? "the selected defender"}. Submit other defenders or extra combats separately.</p>
              </form>
            )}
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="primary-button" type="submit" form="outgoing-damage-form" disabled={!defense}>Apply damage <span aria-hidden="true">→</span></button></div>
        </Modal>
      )}

      {activeModal === "library" && (
        <Modal title="Curated scenario-card library" subtitle="Versioned examples support the simulation; resolve the exact game objects and effects in your playtester." onClose={() => setActiveModal(null)} wide>
          {storageConflictNotice}
          <div className="library-grid">{CARD_LIBRARY.map((group) => <article key={group.archetype}><span className="eyebrow">Archetype</span><h3><GlossaryText text={group.archetype} /></h3><ul>{group.cards.map((card) => <li key={card}><CardPreview name={card} /></li>)}</ul></article>)}</div>
          <div className="library-note"><strong>Scenario cards updated {CARD_LIBRARY_UPDATED}</strong><p>Scenario language follows Wizards’ definitions for <GlossaryTerm term="Counter">counter</GlossaryTerm>, <GlossaryTerm term="Destroy">destroy</GlossaryTerm>, <GlossaryTerm term="Exile">exile</GlossaryTerm>, <GlossaryTerm term="Flying">flying</GlossaryTerm>, <GlossaryTerm term="Reach">reach</GlossaryTerm>, <GlossaryTerm term="Trample">trample</GlossaryTerm>, <GlossaryTerm term="Menace">menace</GlossaryTerm>, <GlossaryTerm term="Deathtouch">deathtouch</GlossaryTerm>, <GlossaryTerm term="First strike">first strike</GlossaryTerm>, <GlossaryTerm term="Double strike">double strike</GlossaryTerm>, <GlossaryTerm term="Hexproof">hexproof</GlossaryTerm>, and <GlossaryTerm term="Indestructible">indestructible</GlossaryTerm>.</p><a href="https://magic.wizards.com/en/keyword-glossary" target="_blank" rel="noreferrer">Open the official keyword glossary <span aria-hidden="true">↗</span></a></div>
        </Modal>
      )}

      {activeModal === "totals" && (
        <Modal title={`Correct ${correctionTarget === "user" ? "your" : correctionOpponent?.name ?? "player"} tracked totals`} subtitle="Enter exact values from the tabletop. The simulator immediately rechecks life, poison, and each original commander identity." onClose={() => setActiveModal(null)} wide>
          {storageConflictNotice}
          <form className="correction-form" onSubmit={submitCorrection}>
            <div className="correction-primary-fields">
              <label>Life total<input name="correction-life" type="number" min={Number.MIN_SAFE_INTEGER} max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={correctionLife} required /></label>
              <label>Poison counters<input name="correction-poison" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={correctionPoison} required /></label>
            </div>
            <fieldset className="correction-commanders">
              <legend>Commander damage by original commander</legend>
              <div>{correctionCommanderIds.map((commanderId) => <label key={commanderId}>{correctionLabels[commanderId] ?? commanderId}<input name={`correction-commander-${encodeURIComponent(commanderId)}`} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={correctionDamage[commanderId] ?? 0} required /></label>)}</div>
            </fieldset>
            <label className="check-label correction-protection"><input name="correction-loss-protected" type="checkbox" defaultChecked={correctionLossProtected} />An ongoing rule or effect says this player can’t lose. Keep tracking lethal totals until the effect ends.</label>
            {correctionOpponent?.eliminated && <label className="check-label correction-restore"><input name="correction-restore" type="checkbox" />Restore {correctionOpponent.name} to the table if the corrected totals are safe.</label>}
            <p className="boundary-note">This corrects tracked numeric state only. Resolve untracked permanents, counters, replacement effects, and commander identity in your playtester.</p>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="primary-button" type="submit">Save exact totals <span aria-hidden="true">→</span></button></div>
          </form>
        </Modal>
      )}

      {activeModal === "reset" && (
        <Modal title="Restart this session?" subtitle="This clears life totals, damage, threats, and history. Your opponent profiles stay in place." onClose={() => setActiveModal(null)}>
          {storageConflictNotice}
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Keep playing</button><button className="danger-button" type="button" onClick={resetSession}>Restart with a new seed</button></div>
        </Modal>
      )}

      {game.gameOver && !activeModal && (
        <Modal title="The goldfish game ended" subtitle={game.gameOver} dismissible={!tableDefeated && !userDefeated} onClose={continueAfterGameOver}>
          {storageConflictNotice}
          <div className="session-summary"><span><b>{game.turn}</b> {game.turn === 1 ? "round" : "rounds"} reached</span><span><b>{game.answeredCount}</b> threats/actions answered</span><span><b>{game.userLife}</b> life · <b>{game.userPoisonCounters}</b> poison</span></div>
          {(userDefeated || tableDefeated) && <p className="terminal-guidance">If the recorded totals or an ongoing can’t-lose effect were missed, correct the affected player. Safe corrected totals can restore an eliminated opponent after a reload.</p>}
          <div className="modal-actions">{canUndo && <button className="secondary-button" type="button" onClick={undo}>Undo last change</button>}{(userDefeated || tableDefeated) && <button className="secondary-button" type="button" onClick={() => openCorrection(terminalCorrectionTarget)}>Correct tracked totals</button>}{!tableDefeated && !userDefeated && <button className="secondary-button" type="button" onClick={continueAfterGameOver}>Continue anyway</button>}<button className="primary-button" type="button" onClick={resetSession}>Start a new run <span aria-hidden="true">→</span></button></div>
        </Modal>
      )}
    </main>
  );
}
