"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  applyCombatDamage,
  CARD_LIBRARY,
  CARD_LIBRARY_UPDATED,
  COMMANDER_BRACKETS,
  counterBacks,
  DECK_PROFILES,
  generateEvent,
  GLOSSARY_DEFINITIONS,
  incomingCommanderDamage,
  incomingDamage,
  normalizeCommanderBracket,
  opponentCommanderKey,
  PROFILE_LABELS,
  rollDefense,
  userCommanderKey,
  type CommanderBracket,
  type CommanderSlot,
  type DefenseResult,
  type GlossaryKey,
  type Keyword,
  type Opponent,
  type ProfileId,
  type SimEvent,
  type Threat,
} from "./simulator";
import { loadCardImage } from "./scryfall";

type ResponseStage = "prompt" | "choose" | "counterback" | "combat" | "resolved";
type HistoryTone = "success" | "damage" | "warning" | "neutral";

type HistoryEntry = {
  id: string;
  turn: number;
  title: string;
  detail: string;
  tone: HistoryTone;
};

type GameState = {
  version: 3;
  turn: number;
  eventCounter: number;
  defenseCounter: number;
  seed: string;
  opponents: Opponent[];
  userLife: number;
  userCommanderDamage: Record<string, number>;
  currentEvent: SimEvent;
  responseStage: ResponseStage;
  resolution: string;
  activeThreat: Threat | null;
  recentTemplateIds: string[];
  history: HistoryEntry[];
  answeredCount: number;
  gameOver: string | null;
};

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
const COMBAT_KEYWORDS: Keyword[] = ["Flying", "Trample", "Menace", "Deathtouch", "First strike", "Double strike", "Lifelink"];
const USER_COMMANDER_LABELS = {
  [userCommanderKey("primary")]: "Your commander",
  [userCommanderKey("partner")]: "Your partner commander",
};

const DEFAULT_OPPONENTS: Opponent[] = [
  { id: "mara", name: "Mara", profile: "graveyard", bracket: 3, life: 40, commanderDamage: {}, eliminated: false },
  { id: "theo", name: "Theo", profile: "control", bracket: 4, life: 40, commanderDamage: {}, eliminated: false },
  { id: "ari", name: "Ari", profile: "swarm", bracket: 2, life: 40, commanderDamage: {}, eliminated: false },
];

let historyEntryCounter = 0;

function cloneOpponents(opponents: Opponent[]) {
  return opponents.map((opponent) => ({ ...opponent, bracket: normalizeCommanderBracket(opponent.bracket), commanderDamage: { ...opponent.commanderDamage } }));
}

function createInitialGame(seed = "GILDED-732", opponents = DEFAULT_OPPONENTS): GameState {
  const safeOpponents = cloneOpponents(opponents);
  const currentEvent = generateEvent({
    turn: 1,
    counter: 1,
    seed,
    opponents: safeOpponents,
    recentTemplateIds: [],
    activeThreat: false,
  });
  return {
    version: 3,
    turn: 1,
    eventCounter: 1,
    defenseCounter: 0,
    seed,
    opponents: safeOpponents,
    userLife: 40,
    userCommanderDamage: {},
    currentEvent,
    responseStage: "prompt",
    resolution: "",
    activeThreat: null,
    recentTemplateIds: [],
    history: [{ id: "session-start", turn: 1, title: "Session started", detail: "The simulated table is live.", tone: "neutral" }],
    answeredCount: 0,
    gameOver: null,
  };
}

function historyEntry(state: GameState, title: string, detail: string, tone: HistoryTone): HistoryEntry {
  historyEntryCounter += 1;
  return { id: `${Date.now().toString(36)}-${historyEntryCounter.toString(36)}`, turn: state.turn, title, detail, tone };
}

function highestCommanderDamage(damage: Record<string, number>) {
  return Math.max(0, ...Object.values(damage));
}

function damageFromForm(data: FormData, name: string, maximum: number) {
  return Math.min(maximum, Math.max(0, Math.floor(Number(data.get(name)) || 0)));
}

function bracketLabel(value: unknown) {
  const bracket = normalizeCommanderBracket(value);
  return `B${bracket} ${COMMANDER_BRACKETS[bracket].label}`;
}

const EVENT_PRESENTATION = {
  targeted: { label: "Single-target interaction", glyph: "↗" },
  wipe: { label: "Board wipe", glyph: "✺" },
  counter: { label: "Stack interaction", glyph: "↯" },
  disruption: { label: "Table disruption", glyph: "◇" },
  attack: { label: "Incoming combat", glyph: "⚔" },
  threat: { label: "Game-ending threat", glyph: "!" },
  development: { label: "Table development", glyph: "…" },
} satisfies Record<SimEvent["kind"], { label: string; glyph: string }>;

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

/** Positions a hover/focus preview inside the viewport and coordinates delayed dismissal. */
function useHoverPreview<T extends HTMLElement>(width: number, height: number, onShow?: () => void) {
  const previewId = useId();
  const trigger = useRef<T>(null);
  const preview = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  function preparePreview() {
    window.clearTimeout(hoverTimer.current);
    const target = trigger.current;
    const panel = preview.current;
    if (!target || !panel) return;
    const rect = target.getBoundingClientRect();
    const panelWidth = Math.min(width, window.innerWidth - 24);
    const roomAbove = rect.top - 12;
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const side = Math.max(roomAbove, roomBelow) < height ? "center" : roomAbove > roomBelow ? "above" : "below";
    panel.style.left = `${Math.max(12, Math.min(window.innerWidth - panelWidth - 12, rect.left + rect.width / 2 - panelWidth / 2))}px`;
    panel.style.top = `${side === "above" ? rect.top - 10 : side === "below" ? rect.bottom + 10 : 12}px`;
    panel.dataset.side = side;
    if (!panel.matches(":popover-open")) onShow?.();
  }

  function showPreview(delay = 0) {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      preparePreview();
      const panel = preview.current;
      if (!panel) return;
      if (!panel.matches(":popover-open")) panel.showPopover();
    }, delay);
  }

  function closePreview(delay = 0) {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      const panel = preview.current;
      if (panel?.matches(":popover-open")) panel.hidePopover();
    }, delay);
  }

  function keepPreviewOpen() {
    window.clearTimeout(hoverTimer.current);
  }

  return { previewId, trigger, preview, preparePreview, showPreview, closePreview, keepPreviewOpen };
}

function CardPreview({ name, lookupName = name }: { name: string; lookupName?: string | null }) {
  const [requestedName, setRequestedName] = useState<string>();
  const [result, setResult] = useState<{ name: string; image: string | null }>();
  const [loadedImage, setLoadedImage] = useState<string>();
  const [failedImage, setFailedImage] = useState<string>();
  const image = result?.name === lookupName ? result.image : undefined;
  const { previewId, trigger, preview, preparePreview, showPreview, closePreview, keepPreviewOpen } = useHoverPreview<HTMLButtonElement>(220, 320, () => {
    if (!lookupName) return;
    setResult((current) => current?.name === lookupName && current.image === null ? undefined : current);
    setFailedImage((current) => current === image ? undefined : current);
    setRequestedName(lookupName);
  });

  useEffect(() => {
    if (!lookupName || requestedName !== lookupName || image !== undefined) return;
    let active = true;
    void loadCardImage(lookupName).then((url) => { if (active) setResult({ name: lookupName, image: url }); });
    return () => { active = false; };
  }, [image, lookupName, requestedName]);

  if (!lookupName) return name;
  const cardName = lookupName;

  return (
    <span className="card-preview">
      <button
        className="preview-trigger card-preview-trigger"
        type="button"
        ref={trigger}
        aria-describedby={previewId}
        popoverTarget={previewId}
        popoverTargetAction="toggle"
        onPointerEnter={(event) => { if (event.pointerType !== "touch") showPreview(160); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== event.currentTarget) closePreview(160); }}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showPreview(); }}
        onBlur={() => closePreview()}
        onClick={preparePreview}
        onKeyDown={(event) => { if (event.key === "Escape") closePreview(); }}
      >{name}</button>
      <span className="preview-panel card-preview-panel" id={previewId} role="tooltip" ref={preview} popover="auto" onPointerEnter={keepPreviewOpen} onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== trigger.current) closePreview(160); }}>
        {(image === undefined || (image && loadedImage !== image && failedImage !== image)) && <span className="card-preview-status" role="status">Loading card image…</span>}
        {(image === null || failedImage === image) && <span className="card-preview-status" role="status">Card image unavailable.</span>}
        {/* eslint-disable-next-line @next/next/no-img-element -- render trusted Scryfall CDN art without proxying third-party images */}
        {image && failedImage !== image && <img className={loadedImage === image ? "" : "pending"} src={image} alt={`${cardName} card`} decoding="async" onLoad={() => setLoadedImage(image)} onError={() => setFailedImage(image)} />}
      </span>
    </span>
  );
}

function GlossaryTerm({ term, children = term, className = "" }: { term: GlossaryKey; children?: React.ReactNode; className?: string }) {
  const { previewId, trigger, preview, preparePreview, showPreview, closePreview, keepPreviewOpen } = useHoverPreview<HTMLButtonElement>(260, 140);
  return (
    <span className={`glossary-preview${className ? ` ${className}` : ""}`}>
      <button
        className="preview-trigger glossary-preview-trigger"
        type="button"
        ref={trigger}
        aria-describedby={previewId}
        popoverTarget={previewId}
        popoverTargetAction="toggle"
        onPointerEnter={(event) => { if (event.pointerType !== "touch") showPreview(160); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== event.currentTarget) closePreview(160); }}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showPreview(); }}
        onBlur={() => closePreview()}
        onClick={preparePreview}
        onKeyDown={(event) => { if (event.key === "Escape") closePreview(); }}
      >{children}</button>
      <span className="preview-panel glossary-preview-panel" id={previewId} role="tooltip" ref={preview} popover="auto" onPointerEnter={keepPreviewOpen} onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== trigger.current) closePreview(160); }}>
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
  const { previewId, trigger, preview, preparePreview, showPreview, closePreview, keepPreviewOpen } = useHoverPreview<HTMLButtonElement>(260, 320);
  return (
    <span className="glossary-help">
      <button
        className="preview-trigger glossary-help-trigger"
        type="button"
        ref={trigger}
        aria-describedby={previewId}
        popoverTarget={previewId}
        popoverTargetAction="toggle"
        onPointerEnter={(event) => { if (event.pointerType !== "touch") showPreview(160); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== event.currentTarget) closePreview(160); }}
        onBlur={() => closePreview()}
        onClick={preparePreview}
        onKeyDown={(event) => { if (event.key === "Escape") closePreview(); }}
      ><span aria-hidden="true">?</span> {label}</button>
      <span className="preview-panel glossary-preview-panel" id={previewId} role="tooltip" ref={preview} popover="auto" onPointerEnter={keepPreviewOpen} onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== trigger.current) closePreview(160); }}>
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
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const modal = dialog.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleCancel = (event: Event) => { event.preventDefault(); if (dismissible) onCloseRef.current(); };
    modal?.addEventListener("cancel", handleCancel);
    if (modal && !modal.open) modal.showModal();
    return () => {
      modal?.removeEventListener("cancel", handleCancel);
      if (modal?.open) modal.close();
      returnFocus?.focus();
    };
  }, [dismissible]);

  return (
    <dialog ref={dialog} className={`modal ${wide ? "modal-wide" : ""}`} aria-labelledby="modal-title" aria-describedby={subtitle ? "modal-description" : undefined}>
      <header className="modal-header">
        <div><span className="eyebrow">MTG Betafish</span><h2 id="modal-title">{title}</h2>{subtitle && <p id="modal-description">{subtitle}</p>}</div>
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

export default function Home() {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
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

  // Persistence is best-effort: private browsing and storage policies may disable it.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Omit<GameState, "version" | "answeredCount"> & { version: number; answeredCount?: number };
        if ([1, 2, 3].includes(parsed.version) && parsed.currentEvent && Array.isArray(parsed.opponents)) {
          const migratedAnsweredCount = Array.isArray(parsed.history)
            ? parsed.history.filter((entry) => ["Action answered", "Threat answered", "Combat prevented"].includes(entry.title)).length
            : 0;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate client-only persisted state after mount
          setGame({
            ...parsed,
            version: 3,
            opponents: cloneOpponents(parsed.opponents),
            history: Array.isArray(parsed.history) ? parsed.history : [],
            answeredCount: Number.isFinite(parsed.answeredCount) ? Math.max(0, Math.floor(parsed.answeredCount ?? 0)) : migratedAnsweredCount,
          });
        }
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
    undoStack.current = [...undoStack.current.slice(-9), game];
    setGame(update(game));
  }

  const sourceOpponent = game.opponents.find((opponent) => opponent.id === game.currentEvent.sourceId);
  const incomingTotal = game.currentEvent.attackers ? incomingDamage(game.currentEvent.attackers) : 0;
  const incomingCommanderTotal = game.currentEvent.attackers ? incomingCommanderDamage(game.currentEvent.attackers) : 0;
  const incomingRegularTotal = Math.max(0, incomingTotal - incomingCommanderTotal);
  const incomingLifelinkTotal = game.currentEvent.attackers?.filter((attacker) => attacker.keywords.includes("Lifelink")).reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0) ?? 0;
  const livingOpponents = game.opponents.filter((opponent) => !opponent.eliminated);

  function resolveEvent(title: string, detail: string, tone: HistoryTone, patch: Partial<GameState> = {}, answered = false) {
    commit((previous) => ({
      ...previous,
      ...patch,
      answeredCount: previous.answeredCount + Number(answered),
      responseStage: "resolved",
      resolution: detail,
      history: [historyEntry(previous, title, detail, tone), ...previous.history].slice(0, 40),
    }));
  }

  function letEventResolve() {
    const event = game.currentEvent;
    if (event.kind === "attack") return;
    if (event.kind === "development") {
      resolveEvent("Table developed", `${event.sourceName} advances their game plan. Nothing new targets you.`, "neutral");
      return;
    }
    if (event.kind === "threat" && event.threat) {
      resolveEvent("Threat established", `${event.sourceName}’s ${event.card} is now on a ${event.threat.remaining}-turn clock.`, "warning", { activeThreat: event.threat });
      return;
    }
    resolveEvent(`${event.card} resolves`, "Apply the generated outcome in your playtester, then advance the table.", event.kind === "wipe" ? "warning" : "damage");
  }

  function answerEvent(answer: "counter" | "protect" | "redirect" | "custom" | "counter-again") {
    const event = game.currentEvent;
    if ((answer === "counter" || answer === "counter-again") && game.responseStage !== "counterback") {
      const profile = sourceOpponent?.profile ?? "midrange";
      const bracket = normalizeCommanderBracket(sourceOpponent?.bracket);
      if (counterBacks({ profile, bracket, seed: game.seed, turn: game.turn, counter: game.history.length })) {
        commit((previous) => ({
          ...previous,
          responseStage: "counterback",
          resolution: "Your counter is countered. You have one final response window.",
          history: [historyEntry(previous, "Counter war", `${event.sourceName} counters your counter.`, "warning"), ...previous.history].slice(0, 40),
        }));
        return;
      }
    }
    const labels = {
      counter: "You countered the action.",
      "counter-again": "Your second answer wins the counter war.",
      protect: "Your protection effect saves the threatened cards.",
      redirect: "You changed the target; apply the new target in your playtester.",
      custom: "You supplied a legal answer and stopped the generated action.",
    };
    resolveEvent("Action answered", labels[answer], "success", {}, true);
  }

  function applyIncoming(regularDamage: number, commanderDamage: number, label: string, lifelinkDamage = 0, answered = false) {
    const commanderName = game.currentEvent.attackers?.find((attacker) => attacker.isCommander)?.name ?? `${game.currentEvent.sourceName}’s commander`;
    const commanderId = opponentCommanderKey(game.currentEvent.sourceId);
    const result = applyCombatDamage({
      life: game.userLife,
      commanderDamage: game.userCommanderDamage,
      regularDamage,
      commanderHits: commanderDamage > 0 ? { [commanderId]: commanderDamage } : {},
    });
    const gameOver = result.defeated
      ? result.life <= 0
        ? `You reached ${result.life} life after ${game.currentEvent.sourceName}’s attack.`
        : `${commanderName} dealt 21 or more commander damage to you.`
      : null;
    const lifelinkGain = Math.min(result.totalDamage, Math.max(0, lifelinkDamage));
    const opponents = game.opponents.map((opponent) => opponent.id === game.currentEvent.sourceId ? { ...opponent, life: opponent.life + lifelinkGain } : opponent);
    resolveEvent(
      label,
      result.totalDamage === 0 ? "No combat damage reached you." : `${result.totalDamage} combat damage reached you${commanderDamage ? `, including ${commanderDamage} commander damage` : ""}${lifelinkGain ? `; ${game.currentEvent.sourceName} gained ${lifelinkGain} life` : ""}.`,
      result.totalDamage ? "damage" : "success",
      { userLife: result.life, userCommanderDamage: result.commanderDamage, opponents, gameOver },
      answered,
    );
  }

  function submitIncomingDamage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const regularDamage = damageFromForm(data, "incoming-regular", incomingRegularTotal);
    const commanderDamage = damageFromForm(data, "incoming-commander", incomingCommanderTotal);
    const lifelinkDamage = damageFromForm(data, "incoming-lifelink", incomingLifelinkTotal);
    applyIncoming(regularDamage, commanderDamage, "Combat resolved", lifelinkDamage);
  }

  function advanceTurn() {
    commit((previous) => {
      if (previous.opponents.every((opponent) => opponent.eliminated)) {
        return { ...previous, gameOver: "You eliminated every simulated opponent." };
      }
      const turn = previous.turn + 1;
      let activeThreat = previous.activeThreat;
      if (activeThreat) {
        activeThreat = { ...activeThreat, remaining: activeThreat.remaining - 1 };
        if (activeThreat.remaining <= 0) {
          const owner = previous.opponents.find((opponent) => opponent.id === activeThreat?.ownerId);
          const reason = `${owner?.name ?? "An opponent"} completes ${activeThreat.title}. The unresolved threat wins the simulated game.`;
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
      const eventCounter = previous.eventCounter + 1;
      const currentEvent = generateEvent({
        turn,
        counter: eventCounter,
        seed: previous.seed,
        opponents: previous.opponents,
        recentTemplateIds,
        activeThreat: Boolean(activeThreat),
      });
      return {
        ...previous,
        turn,
        eventCounter,
        currentEvent,
        responseStage: "prompt",
        resolution: "",
        activeThreat,
        recentTemplateIds,
      };
    });
  }

  function continueAfterGameOver() {
    setGame((previous) => {
      if (!previous.activeThreat || previous.activeThreat.remaining > 0) return { ...previous, gameOver: null };
      const recentTemplateIds = [previous.currentEvent.templateId, ...previous.recentTemplateIds].slice(0, 3);
      const eventCounter = previous.eventCounter + 1;
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
        }),
        responseStage: "prompt",
        resolution: "",
      };
    });
  }

  function adjustLife(target: "user" | string, amount: number) {
    commit((previous) => {
      if (target === "user") {
        const userLife = previous.userLife + amount;
        return { ...previous, userLife, gameOver: userLife <= 0 ? `You reached ${userLife} life.` : previous.gameOver };
      }
      const opponents = previous.opponents.map((opponent) => {
        if (opponent.id !== target) return opponent;
        const life = opponent.life + amount;
        const commanderDefeated = Object.values(opponent.commanderDamage).some((damage) => damage >= 21);
        return { ...opponent, life, eliminated: opponent.eliminated || life <= 0 || commanderDefeated };
      });
      const activeThreat = previous.activeThreat?.ownerId === target && opponents.find((opponent) => opponent.id === target)?.eliminated ? null : previous.activeThreat;
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

  function stopThreat() {
    if (!game.activeThreat) return;
    commit((previous) => ({
      ...previous,
      activeThreat: null,
      answeredCount: previous.answeredCount + 1,
      history: [historyEntry(previous, "Threat answered", `${previous.activeThreat?.title ?? "The active threat"} is no longer threatening the table.`, "success"), ...previous.history].slice(0, 40),
    }));
    requestAnimationFrame(() => threatHeading.current?.focus());
  }

  function delayThreat() {
    if (!game.activeThreat || game.activeThreat.delayed) return;
    commit((previous) => ({
      ...previous,
      activeThreat: previous.activeThreat ? { ...previous.activeThreat, remaining: previous.activeThreat.remaining + 1, delayed: true } : null,
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
    setSettingsOpponents((current) => current.length >= 3 ? current : [...current, { id: `opponent-${Date.now()}`, name: `Opponent ${current.length + 1}`, profile: "midrange", bracket: 3, life: 40, commanderDamage: {}, eliminated: false }]);
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
      const eventCounter = previous.eventCounter + 1;
      const currentEvent = generateEvent({
        turn: previous.turn,
        counter: eventCounter,
        seed,
        opponents,
        recentTemplateIds: previous.recentTemplateIds,
        activeThreat: Boolean(previous.activeThreat && opponents.some((opponent) => opponent.id === previous.activeThreat?.ownerId)),
      });
      return {
        ...previous,
        seed,
        opponents,
        eventCounter,
        currentEvent,
        responseStage: "prompt",
        resolution: "",
        activeThreat: previous.activeThreat && opponents.some((opponent) => opponent.id === previous.activeThreat?.ownerId) ? previous.activeThreat : null,
        history: [historyEntry(previous, "Table updated", "Opponent deck profiles and Commander brackets changed.", "neutral"), ...previous.history].slice(0, 40),
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
    setActiveModal("combat");
  }

  function addOutgoingAttacker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attacker: OutgoingAttacker = {
      id: `attacker-${Date.now()}-${outgoingAttackers.length}`,
      name: attackerName.trim() || (attackerCommander ? "Your commander" : `Attacker ${outgoingAttackers.length + 1}`),
      power: Math.max(0, Math.floor(attackerPower || 0)),
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
    requestAnimationFrame(() => attackerNameInput.current?.focus());
  }

  function removeOutgoingAttacker(id: string, index: number) {
    setOutgoingAttackers((current) => current.filter((attacker) => attacker.id !== id));
    setDefense(null);
    requestAnimationFrame(() => {
      const buttons = outgoingList.current?.querySelectorAll<HTMLButtonElement>("article > button");
      const nextButton = buttons?.[Math.min(index, buttons.length - 1)];
      if (nextButton) nextButton.focus();
      else attackerNameInput.current?.focus();
    });
  }

  function fullCombatDamage(attackers: OutgoingAttacker[], ignoredId?: string) {
    const regular = attackers.filter((attacker) => !attacker.isCommander && attacker.id !== ignoredId)
      .reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0);
    const commander = Object.fromEntries(attackers.filter((attacker) => attacker.isCommander && attacker.id !== ignoredId)
      .map((attacker) => [attacker.id, attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1)]));
    const lifelink = attackers.filter((attacker) => attacker.id !== ignoredId && attacker.keywords.includes("Lifelink"))
      .reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0);
    return { regular, commander, lifelink };
  }

  function simulateDefense() {
    const target = game.opponents.find((opponent) => opponent.id === combatTarget);
    if (!target || !outgoingAttackers.length) return;
    const result = rollDefense({
      profile: target.profile,
      bracket: normalizeCommanderBracket(target.bracket),
      seed: game.seed,
      turn: game.turn,
      counter: game.defenseCounter + 1,
      attackers: outgoingAttackers,
    });
    setDefense(result);
    setGame((previous) => ({ ...previous, defenseCounter: previous.defenseCounter + 1 }));
  }

  function answerDefense() {
    if (!defense || defense.type === "none") return;
    setDefense({ type: "none", title: "Defense answered", detail: "Your interaction stops the defensive play. Resolve combat normally." });
    setGame((previous) => ({ ...previous, answeredCount: previous.answeredCount + 1 }));
  }

  function applyOutgoingDamage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = game.opponents.find((opponent) => opponent.id === combatTarget);
    if (!target || !defense) return;
    const data = new FormData(event.currentTarget);
    const removedId = defense.type === "removal" ? [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id : undefined;
    const full = defense.type === "fog" ? { regular: 0, commander: {} as Record<string, number>, lifelink: 0 } : fullCombatDamage(outgoingAttackers, removedId);
    const commanderHits: Record<string, number> = {};
    outgoingAttackers.filter((attacker) => attacker.isCommander).forEach((attacker) => {
      const damage = damageFromForm(data, `commander-${attacker.id}`, full.commander[attacker.id] ?? 0);
      const commanderId = userCommanderKey(attacker.commanderSlot ?? "primary");
      commanderHits[commanderId] = (commanderHits[commanderId] ?? 0) + damage;
    });
    const regularDamage = damageFromForm(data, "outgoing-regular", full.regular);
    const result = applyCombatDamage({ life: target.life, commanderDamage: target.commanderDamage, regularDamage, commanderHits });
    const lifelinkGain = Math.min(damageFromForm(data, "outgoing-lifelink", full.lifelink), result.totalDamage);
    commit((previous) => {
      const opponents = previous.opponents.map((opponent) => opponent.id === target.id
        ? { ...opponent, life: result.life, commanderDamage: result.commanderDamage, eliminated: result.defeated }
        : opponent);
      const reason = result.lethalCommander ? `${USER_COMMANDER_LABELS[result.lethalCommander] ?? result.lethalCommander} reached 21 commander damage.` : result.life <= 0 ? `${target.name} reached ${result.life} life.` : "";
      const detail = `${result.totalDamage} damage assigned to ${target.name}.${lifelinkGain ? ` You gained ${lifelinkGain} life.` : ""}${reason ? ` ${reason}` : ""}`;
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const sourceEliminated = result.defeated && previous.responseStage !== "resolved" && previous.currentEvent.sourceId === target.id;
      const sourceResolution = `${target.name} left the game, so their pending action was removed from the stack or combat.`;
      const damageHistory = historyEntry(previous, result.defeated ? `${target.name} eliminated` : `Damage assigned to ${target.name}`, detail, result.defeated ? "success" : "damage");
      return {
        ...previous,
        userLife: previous.userLife + lifelinkGain,
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
    if (previous) setGame(previous);
  }

  function resetSession() {
    const seed = `CAST-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    undoStack.current = [];
    setGame(createInitialGame(seed, game.opponents.map((opponent) => ({ ...opponent, life: 40, commanderDamage: {}, eliminated: false }))));
    setActiveModal(null);
  }

  const maxUserCommanderDamage = highestCommanderDamage(game.userCommanderDamage);
  const tableDefeated = game.opponents.every((opponent) => opponent.eliminated);
  const userDefeated = game.userLife <= 0 || maxUserCommanderDamage >= 21;
  const eventCardLookup = game.currentEvent.kind === "attack" || game.currentEvent.kind === "development" || game.currentEvent.templateId === "random-discard"
    ? null
    : game.currentEvent.templateId === "combo-clock" ? "Thassa’s Oracle" : game.currentEvent.card;
  // eslint-disable-next-line react-hooks/refs -- commit, undo, and reset pair each stack mutation with a game-state render
  const canUndo = undoStack.current.length > 0;
  const opponentCommanderLabels = Object.fromEntries(game.opponents.map((opponent) => [opponentCommanderKey(opponent.id), `${opponent.name}’s commander`]));
  const removedAttackerId = defense?.type === "removal" ? [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id : undefined;
  const outgoingDamageLimit = defense?.type === "fog" ? { regular: 0, commander: {} as Record<string, number>, lifelink: 0 } : fullCombatDamage(outgoingAttackers, removedAttackerId);
  const encounterGlossaryTerms = new Set<GlossaryKey>();
  const outgoingDamageTerms: GlossaryKey[] = [];
  if (outgoingAttackers.some((attacker) => attacker.isCommander)) outgoingDamageTerms.push("Commander damage");
  if (outgoingDamageLimit.lifelink > 0) outgoingDamageTerms.push("Lifelink");
  const liveMessage = (activeModal === "combat" && defense ? `Defense roll: ${defense.title}. ${defense.detail}` : null)
    ?? (game.responseStage === "counterback" ? "Your counter was countered. Choose whether to answer again or let the original action resolve." : null)
    ?? (game.responseStage === "choose" ? "Response choices are ready: counter, protect, redirect, or use another answer." : null)
    ?? (game.responseStage === "combat" ? "Combat damage fields are ready. Enter the regular and commander damage that reached you." : null)
    ?? (game.responseStage !== "resolved" ? `${EVENT_PRESENTATION[game.currentEvent.kind].label}: ${game.currentEvent.title}` : game.resolution);
  return (
    <main className="app-shell">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{game.gameOver ? "" : liveMessage}</div>

      <header className="topbar">
        <a className="brand" href="#main-workspace" aria-label="MTG Betafish home">
          <span><strong>MTG</strong><small>Betafish</small></span>
        </a>
        <div className="turn-strip" aria-label={`Turn ${game.turn}`}>
          <span className="eyebrow">Turn {game.turn}</span>
          <b>{game.responseStage !== "resolved" ? <>Table has <GlossaryTerm term="Priority">priority</GlossaryTerm></> : "Ready to advance"}</b>
        </div>
        <button className="link-button top-action" type="button" onClick={openSettings}>Table setup</button>
      </header>

      <section className="workspace" id="main-workspace">
        <section className="encounter-column" aria-labelledby="encounter-title">
          <div className="encounter-intro">
            <div><span className="eyebrow">{game.responseStage !== "resolved" ? "Priority check" : "Outcome recorded"}</span><h1 id="encounter-title" ref={encounterHeading} tabIndex={-1}>{game.responseStage !== "resolved" ? "The table acts." : "Action resolved."}</h1></div>
            <span className="event-number">Event {String(game.eventCounter).padStart(2, "0")}</span>
          </div>

          <article className={`encounter-card event-${game.currentEvent.kind}`}>
            <div className="card-topline">
              <span className="event-type"><i aria-hidden="true">✦</i> {glossaryText(EVENT_PRESENTATION[game.currentEvent.kind].label, encounterGlossaryTerms)}</span>
              <span className={game.currentEvent.kind === "threat" ? "danger-badge" : "source-badge"}>{game.currentEvent.sourceName} · <CardPreview name={game.currentEvent.card} lookupName={eventCardLookup} /></span>
            </div>
            <div className={`spell-art spell-art-${game.currentEvent.kind}`} aria-hidden="true"><span>{EVENT_PRESENTATION[game.currentEvent.kind].glyph}</span></div>
            <div className="encounter-copy">
              <p className="source"><span className="avatar avatar-1">{game.currentEvent.sourceName.slice(0, 1)}</span> {game.currentEvent.sourceName} takes an action</p>
              <h2>{glossaryText(game.currentEvent.title, encounterGlossaryTerms)}</h2>
              <p>{glossaryText(game.currentEvent.prompt, encounterGlossaryTerms)}</p>
              <div className="tag-row">{game.currentEvent.tags.map((tag) => <span className="event-tag" key={tag}>{glossaryText(tag, encounterGlossaryTerms)}</span>)}</div>

              {game.currentEvent.attackers && (
                <div className="incoming-attackers">
                  {game.currentEvent.attackers.map((attacker) => (
                    <article key={attacker.id}>
                      <div><strong>{attacker.name}</strong>{attacker.isCommander && <span className="commander-badge">Commander</span>}</div>
                      <b className="pt">{attacker.power}/{attacker.toughness}</b>
                      <div className="keyword-row">{attacker.keywords.length ? attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />) : <span className="vanilla">No keywords</span>}</div>
                    </article>
                  ))}
                  <p className="combat-total"><strong>{incomingTotal}</strong> maximum incoming damage · <strong>{incomingCommanderTotal}</strong> <GlossaryTerm term="Commander damage">commander damage</GlossaryTerm></p>
                </div>
              )}
            </div>

            <fieldset className="event-fieldset" disabled={game.responseStage === "resolved"}>
              {game.responseStage === "prompt" && game.currentEvent.kind !== "attack" && game.currentEvent.kind !== "development" && (
                <div className="response-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Do you have a response?</span>{game.currentEvent.kind !== "threat" && (game.currentEvent.kind === "targeted" || game.currentEvent.kind === "counter") && <GlossaryHelp terms={["Legal target"]} />}</div>
                  <div className="response-actions">
                    <button className="primary-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "choose" }))}>Yes, I respond <span>→</span></button>
                    <button className="secondary-button" type="button" onClick={letEventResolve}>No response</button>
                    {game.currentEvent.kind !== "threat" && (game.currentEvent.kind === "targeted" || game.currentEvent.kind === "counter"
                      ? <button className="text-button" type="button" onClick={() => resolveEvent("Action misses", "No game object was affected, so the generated action has no effect.", "neutral")}>No legal target</button>
                      : <button className="text-button" type="button" onClick={() => resolveEvent("Action misses", "No game object was affected, so the generated action has no effect.", "neutral")}>Nothing affected</button>)}
                  </div>
                </div>
              )}

              {game.responseStage === "prompt" && game.currentEvent.kind === "development" && (
                <div className="response-box">
                  <span className="eyebrow" ref={responseStep} tabIndex={-1}>No new pressure this turn</span>
                  <div className="response-actions">
                    <button className="primary-button" type="button" onClick={letEventResolve}>Record development <span>→</span></button>
                  </div>
                </div>
              )}

              {game.responseStage === "choose" && (
                <div className="response-box response-choice-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Choose the line you used</span><GlossaryHelp terms={["Counter", "Hexproof", "Indestructible", "Phase out", "Legal target", "Sacrifice", "Blink", "Bounce"]} /></div>
                  <div className="choice-grid">
                    <button type="button" onClick={() => answerEvent("counter")}><strong>Counter it</strong><small>The source may fight back.</small></button>
                    <button type="button" onClick={() => answerEvent("protect")}><strong>Protect it</strong><small>Hexproof, indestructible, phase out.</small></button>
                    <button type="button" onClick={() => answerEvent("redirect")}><strong>Redirect it</strong><small>Choose a new legal target.</small></button>
                    <button type="button" onClick={() => answerEvent("custom")}><strong>Other answer</strong><small>Sacrifice, blink, bounce, or a custom line.</small></button>
                  </div>
                  <button className="text-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "prompt" }))}>Back</button>
                </div>
              )}

              {game.responseStage === "counterback" && (
                <div className="response-box counterback-box">
                  <span className="danger-badge" ref={responseStep} tabIndex={-1}><GlossaryTerm term="Counter">Counter</GlossaryTerm> to your counter</span>
                  <h3>Your answer is countered.</h3>
                  <p>You have one final response window before the original action resolves.</p>
                  <div className="response-actions two-actions">
                    <button className="primary-button" type="button" onClick={() => answerEvent("counter-again")}>I answer again <span>→</span></button>
                    <button className="secondary-button" type="button" onClick={letEventResolve}>Let the original resolve</button>
                  </div>
                </div>
              )}

              {game.responseStage === "prompt" && game.currentEvent.kind === "attack" && (
                <div className="response-box">
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>Declare your defense</span><GlossaryHelp terms={["Fog"]} /></div>
                  <div className="response-actions combat-actions">
                    <button className="primary-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "combat" }))}>Block / interact <span>→</span></button>
                    <button className="secondary-button" type="button" onClick={() => applyIncoming(incomingRegularTotal, incomingCommanderTotal, "Attack connected", incomingLifelinkTotal)}>Take the hit</button>
                    <button className="text-button" type="button" onClick={() => applyIncoming(0, 0, "Combat prevented", 0, true)}>Fog / stop combat</button>
                  </div>
                </div>
              )}

              {game.responseStage === "combat" && (
                <form className="response-box combat-resolution" onSubmit={submitIncomingDamage}>
                  <div className="response-heading"><span className="eyebrow" ref={responseStep} tabIndex={-1}>After blocks and interaction</span><GlossaryHelp terms={incomingLifelinkTotal > 0 ? ["Commander damage", "Lifelink"] : ["Commander damage"]} /></div>
                  <p>Resolve exact combat in your playtester, then enter only damage that reaches you.</p>
                  <div className="damage-inputs">
                    <label>Regular combat damage<input name="incoming-regular" type="number" min="0" max={incomingRegularTotal} defaultValue="0" /></label>
                    <label>Commander combat damage<input name="incoming-commander" type="number" min="0" max={incomingCommanderTotal} defaultValue="0" /></label>
                    {incomingLifelinkTotal > 0 && <label>Lifelink damage dealt<input name="incoming-lifelink" type="number" min="0" max={incomingLifelinkTotal} defaultValue="0" /></label>}
                  </div>
                  <div className="modal-actions compact-actions">
                    <button className="text-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "prompt" }))}>Back</button>
                    <button className="primary-button" type="submit">Apply damage <span>→</span></button>
                  </div>
                </form>
              )}
            </fieldset>

            {game.responseStage === "resolved" && (
              <div className="resolved-box"><span className="resolved-mark">✓</span><div><span className="eyebrow" ref={responseStep} tabIndex={-1}>Recorded</span><strong>{game.resolution}</strong></div></div>
            )}
          </article>

          <section className="mobile-turn-summary" aria-label="Turn status and shortcuts">
            <span><small>Your life</small><strong>{game.userLife}</strong></span>
            <span><small>Active threat</small><strong>{game.activeThreat ? `${game.activeThreat.remaining} ${game.activeThreat.remaining === 1 ? "turn" : "turns"}` : "Clear"}</strong></span>
            <button type="button" onClick={openCombat} disabled={!livingOpponents.length} aria-label="Assign your combat damage">Assign combat <span aria-hidden="true">→</span></button>
            <button type="button" onClick={openSettings}>Table setup</button>
          </section>

          <div className="next-action">
            <div><span className="eyebrow">Up next</span><strong>{game.responseStage === "resolved" ? "Advance one full table round." : "Resolve this event, then advance the table."}</strong></div>
            <div className="next-buttons">
              <button className="undo-button" type="button" onClick={undo} disabled={!canUndo}>Undo</button>
              <button className="advance-button" type="button" onClick={advanceTurn} disabled={game.responseStage !== "resolved" || Boolean(game.gameOver)}>Next turn <span>→</span></button>
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
          </article>
          <button className="secondary-wide" type="button" onClick={openCombat} disabled={!livingOpponents.length}>Assign your combat damage <span>→</span></button>
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
              <div className="empty-threat"><span>○</span><strong>No active clock</strong><p>Game-ending threat timing follows each opponent’s bracket.</p></div>
            )}
          </section>

          <section className="history" aria-labelledby="history-title">
            <div className="section-heading"><div><span className="eyebrow">This session</span><h2 id="history-title">Recent events</h2></div><button className="link-button" type="button" onClick={undo} disabled={!canUndo}>Undo</button></div>
            <ol>
              {game.history.slice(0, 5).map((entry) => (
                <li key={entry.id}><span className={`history-dot ${entry.tone}`}>{entry.tone === "success" ? "✓" : entry.tone === "warning" ? "!" : entry.tone === "damage" ? "−" : "·"}</span><div><strong>{entry.title}</strong><small>Turn {entry.turn} · {entry.detail}</small></div></li>
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
        <Modal title="Set up the table" subtitle="Choose one to three matchup profiles. Each deck package shapes the action mix; its bracket sets pacing and interaction frequency." onClose={() => setActiveModal(null)} wide>
          <div className="settings-body">
            <div className="opponent-settings" ref={settingsPanel}>
              {settingsOpponents.map((opponent, index) => {
                const profile = DECK_PROFILES[opponent.profile];
                const bracket = normalizeCommanderBracket(opponent.bracket);
                const bracketRules = COMMANDER_BRACKETS[bracket];
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
                    <div className="profile-setting-copy" id={profileDescriptionId}><p><GlossaryText text={profile.description} /></p><p><strong>Included cards:</strong> {profile.guaranteedCards.map((card, cardIndex) => <span key={card.name}>{cardIndex > 0 && " · "}<CardPreview name={card.name} /></span>)} <span>(in the simulated deck; not guaranteed drawn)</span></p></div>
                    <p className="bracket-setting-copy" id={bracketDescriptionId}><strong>{bracketLabel(bracket)}:</strong> {bracketRules.summary} {bracketRules.turnGuide}</p>
                  </fieldset>
                );
              })}
              <button className="add-opponent" type="button" onClick={addSettingsOpponent} disabled={settingsOpponents.length >= 3}>+ Add opponent</button>
            </div>
            <div className="session-settings">
              <label>Session seed<input value={settingsSeed} onChange={(event) => setSettingsSeed(event.target.value.toUpperCase())} maxLength={24} /></label>
              <p>Reuse a seed with the same choices to replay the same event sequence.</p>
              <div className="bracket-guide"><span className="eyebrow">Bracket guide</span><strong>Official intent, Betafish-tuned odds</strong><p>MTG Betafish translates Wizards’ turn guidance into when pressure and game-ending clocks may appear. It also scales attacks, counters, removal, and defenses as simulation heuristics.</p><ol>{Object.entries(COMMANDER_BRACKETS).map(([value, rules]) => <li key={value}><b>B{value}</b><span>{rules.label}</span><small>{rules.turnGuide}</small></li>)}</ol><a href="https://magic.wizards.com/en/formats/commander" target="_blank" rel="noreferrer">View Wizards’ beta bracket guide ↗</a></div>
              <p>Profiles are abstract matchup presets, not complete color-identity-checked decklists.</p>
            </div>
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="primary-button" type="button" onClick={saveSettings}>Apply and reroll <span>→</span></button></div>
        </Modal>
      )}

      {activeModal === "combat" && (
        <Modal title="Assign your attack" subtitle="Add the creatures you tapped in your playtester, roll one table defense, then confirm damage." onClose={() => setActiveModal(null)} wide>
          <div className="combat-builder">
            <label className="target-select">Attack target<select value={combatTarget} onChange={(event) => { setCombatTarget(event.target.value); setDefense(null); }}>{livingOpponents.map((opponent) => <option value={opponent.id} key={opponent.id}>{opponent.name} · {PROFILE_LABELS[opponent.profile]} · {bracketLabel(opponent.bracket)} · {opponent.life} life</option>)}</select></label>
            <form className="attacker-form" onSubmit={addOutgoingAttacker}>
              <label>Attacker name<input ref={attackerNameInput} placeholder="e.g. Atraxa" value={attackerName} onChange={(event) => setAttackerName(event.target.value)} /></label>
              <label>Power<input type="number" min="0" value={attackerPower} onChange={(event) => setAttackerPower(Math.max(0, Number(event.target.value)))} /></label>
              <label className="check-label"><input type="checkbox" checked={attackerCommander} onChange={(event) => setAttackerCommander(event.target.checked)} />Commander</label>
              {attackerCommander && <label>Commander identity<select value={attackerCommanderSlot} onChange={(event) => setAttackerCommanderSlot(event.target.value as CommanderSlot)}><option value="primary">Primary commander</option><option value="partner">Partner commander</option></select></label>}
              <fieldset className="keyword-picker event-fieldset"><legend className="sr-only">Attacker keywords</legend><GlossaryHelp label="Keyword help" terms={COMBAT_KEYWORDS} />{COMBAT_KEYWORDS.map((keyword) => <label key={keyword}><input type="checkbox" checked={attackerKeywords.includes(keyword)} onChange={() => setAttackerKeywords((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword])} />{keyword}</label>)}</fieldset>
              <button className="secondary-button add-attacker-button" type="submit">Add attacker</button>
            </form>

            <div className="outgoing-list" ref={outgoingList}>
              {outgoingAttackers.length ? outgoingAttackers.map((attacker, index) => (
                <article key={attacker.id}><div><strong>{attacker.name}</strong><small>{attacker.isCommander ? "Commander" : "Creature"}</small></div><b>{attacker.power} power</b><div className="keyword-row">{attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />)}</div><button type="button" onClick={() => removeOutgoingAttacker(attacker.id, index)} aria-label={`Remove ${attacker.name}`}>×</button></article>
              )) : <div className="empty-attackers">No attackers added yet.</div>}
            </div>

            <button className="roll-button" type="button" onClick={simulateDefense} disabled={!outgoingAttackers.length || !combatTarget}>{defense ? "Reroll and replace current defense" : "Roll defending player’s response"} <span>↻</span></button>

            {defense && (
              <div className={`defense-result defense-${defense.type}`} ref={defenseResult} tabIndex={-1}>
                <span className="eyebrow">Defense outcome</span><h3><GlossaryText text={defense.title} /></h3><p><GlossaryText text={defense.detail} /></p>
                {defense.type !== "none" && <button className="text-button" type="button" onClick={answerDefense}>I can answer this defense</button>}
              </div>
            )}

            {defense && (
              <form className="damage-confirm" id="outgoing-damage-form" key={`${game.defenseCounter}-${defense.type}`} onSubmit={applyOutgoingDamage}>
                <div className="response-heading"><span className="eyebrow">Damage that gets through</span>{outgoingDamageTerms.length > 0 && <GlossaryHelp terms={outgoingDamageTerms} />}</div>
                <p>Override these values after resolving blocks, removal, or prevention in your playtester.</p>
                <div className="damage-inputs">
                  <label>Noncommander damage<input name="outgoing-regular" type="number" min="0" max={outgoingDamageLimit.regular} defaultValue={outgoingDamageLimit.regular} /></label>
                  {outgoingAttackers.filter((attacker) => attacker.isCommander).map((attacker) => <label key={attacker.id}>{attacker.name} damage<input name={`commander-${attacker.id}`} type="number" min="0" max={outgoingDamageLimit.commander[attacker.id] ?? 0} defaultValue={outgoingDamageLimit.commander[attacker.id] ?? 0} /></label>)}
                  {outgoingDamageLimit.lifelink > 0 && <label>Lifelink damage dealt<input name="outgoing-lifelink" type="number" min="0" max={outgoingDamageLimit.lifelink} defaultValue={outgoingDamageLimit.lifelink} /></label>}
                </div>
              </form>
            )}
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Cancel</button><button className="primary-button" type="submit" form="outgoing-damage-form" disabled={!defense}>Apply damage <span>→</span></button></div>
        </Modal>
      )}

      {activeModal === "library" && (
        <Modal title="Curated scenario library" subtitle="Versioned, emblematic examples flavor the simulation; generic rules-aware outcomes keep working even when the catalog is stale." onClose={() => setActiveModal(null)} wide>
          <div className="library-grid">{CARD_LIBRARY.map((group) => <article key={group.archetype}><span className="eyebrow">Archetype</span><h3><GlossaryText text={group.archetype} /></h3><ul>{group.cards.map((card) => <li key={card}><CardPreview name={card} /></li>)}</ul></article>)}</div>
          <div className="library-note"><strong>Library updated {CARD_LIBRARY_UPDATED}</strong><p>Scenario language follows Wizards’ definitions for <GlossaryTerm term="Counter">counter</GlossaryTerm>, <GlossaryTerm term="Destroy">destroy</GlossaryTerm>, <GlossaryTerm term="Exile">exile</GlossaryTerm>, <GlossaryTerm term="Flying">flying</GlossaryTerm>, <GlossaryTerm term="Reach">reach</GlossaryTerm>, <GlossaryTerm term="Trample">trample</GlossaryTerm>, <GlossaryTerm term="Menace">menace</GlossaryTerm>, <GlossaryTerm term="Deathtouch">deathtouch</GlossaryTerm>, <GlossaryTerm term="First strike">first strike</GlossaryTerm>, <GlossaryTerm term="Double strike">double strike</GlossaryTerm>, <GlossaryTerm term="Hexproof">hexproof</GlossaryTerm>, and <GlossaryTerm term="Indestructible">indestructible</GlossaryTerm>.</p><a href="https://magic.wizards.com/en/keyword-glossary" target="_blank" rel="noreferrer">Open the official keyword glossary ↗</a></div>
        </Modal>
      )}

      {activeModal === "reset" && (
        <Modal title="Restart this session?" subtitle="This clears life totals, damage, threats, and history. Your opponent profiles stay in place." onClose={() => setActiveModal(null)}>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setActiveModal(null)}>Keep playing</button><button className="danger-button" type="button" onClick={resetSession}>Restart with a new seed</button></div>
        </Modal>
      )}

      {game.gameOver && (
        <Modal title="The goldfish game ended" subtitle={game.gameOver} dismissible={!tableDefeated && !userDefeated} onClose={continueAfterGameOver}>
          <div className="session-summary"><span><b>{game.turn}</b> turns reached</span><span><b>{game.answeredCount}</b> threats/actions answered</span><span><b>{game.userLife}</b> life remaining</span></div>
          <div className="modal-actions">{canUndo && <button className="secondary-button" type="button" onClick={undo}>Undo last change</button>}{!tableDefeated && !userDefeated && <button className="secondary-button" type="button" onClick={continueAfterGameOver}>Continue anyway</button>}<button className="primary-button" type="button" onClick={resetSession}>Start a new run <span>→</span></button></div>
        </Modal>
      )}
    </main>
  );
}
