"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyCombatDamage,
  CARD_LIBRARY,
  CARD_LIBRARY_UPDATED,
  counterBacks,
  generateEvent,
  incomingCommanderDamage,
  incomingDamage,
  KEYWORD_DEFINITIONS,
  opponentCommanderKey,
  PROFILE_LABELS,
  rollDefense,
  userCommanderKey,
  type CommanderSlot,
  type DefenseResult,
  type Difficulty,
  type Keyword,
  type Opponent,
  type ProfileId,
  type SimEvent,
  type Threat,
} from "./simulator";

type EventStatus = "pending" | "resolved";
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
  version: 1;
  turn: number;
  eventCounter: number;
  defenseCounter: number;
  seed: string;
  difficulty: Difficulty;
  opponents: Opponent[];
  userLife: number;
  userCommanderDamage: Record<string, number>;
  currentEvent: SimEvent;
  eventStatus: EventStatus;
  responseStage: ResponseStage;
  resolution: string;
  activeThreat: Threat | null;
  recentTemplateIds: string[];
  history: HistoryEntry[];
  paused: boolean;
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

const STORAGE_KEY = "goldfish-lab-session-v1";
const COMBAT_KEYWORDS: Keyword[] = ["Flying", "Trample", "Menace", "Deathtouch", "First strike", "Double strike", "Lifelink"];
const USER_COMMANDER_LABELS = {
  [userCommanderKey("primary")]: "Your commander",
  [userCommanderKey("partner")]: "Your partner commander",
};

const DEFAULT_OPPONENTS: Opponent[] = [
  { id: "mara", name: "Mara", profile: "graveyard", life: 40, commanderDamage: {}, eliminated: false },
  { id: "theo", name: "Theo", profile: "control", life: 40, commanderDamage: {}, eliminated: false },
  { id: "ari", name: "Ari", profile: "swarm", life: 40, commanderDamage: {}, eliminated: false },
];

function cloneOpponents(opponents: Opponent[]) {
  return opponents.map((opponent) => ({ ...opponent, commanderDamage: { ...opponent.commanderDamage } }));
}

function createInitialGame(seed = "GILDED-732", opponents = DEFAULT_OPPONENTS, difficulty: Difficulty = "balanced"): GameState {
  const safeOpponents = cloneOpponents(opponents);
  const currentEvent = generateEvent({
    turn: 1,
    counter: 1,
    seed,
    opponents: safeOpponents,
    recentTemplateIds: [],
    activeThreat: false,
    difficulty,
  });
  return {
    version: 1,
    turn: 1,
    eventCounter: 1,
    defenseCounter: 0,
    seed,
    difficulty,
    opponents: safeOpponents,
    userLife: 40,
    userCommanderDamage: {},
    currentEvent,
    eventStatus: "pending",
    responseStage: "prompt",
    resolution: "",
    activeThreat: null,
    recentTemplateIds: [],
    history: [{ id: "session-start", turn: 1, title: "Session started", detail: "The simulated table is live.", tone: "neutral" }],
    paused: false,
    gameOver: null,
  };
}

function historyEntry(state: GameState, title: string, detail: string, tone: HistoryTone): HistoryEntry {
  return { id: `${state.turn}-${state.history.length}-${title}`, turn: state.turn, title, detail, tone };
}

function highestCommanderDamage(damage: Record<string, number>) {
  return Math.max(0, ...Object.values(damage));
}

function eventKindLabel(event: SimEvent) {
  return {
    targeted: "Single-target interaction",
    wipe: "Board wipe",
    counter: "Stack interaction",
    disruption: "Table disruption",
    attack: "Incoming combat",
    threat: "Game-ending threat",
  }[event.kind];
}

function eventGlyph(event: SimEvent) {
  return { targeted: "↗", wipe: "✺", counter: "↯", disruption: "◇", attack: "⚔", threat: "!" }[event.kind];
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
        <div><span className="eyebrow">Goldfish Lab</span><h2 id="modal-title">{title}</h2>{subtitle && <p id="modal-description">{subtitle}</p>}</div>
        {dismissible && <button className="icon-button" type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button>}
      </header>
      {children}
    </dialog>
  );
}

function KeywordChip({ keyword }: { keyword: Keyword }) {
  return <details className="keyword-chip"><summary>{keyword}</summary><span>{KEYWORD_DEFINITIONS[keyword]}</span></details>;
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
  const [canUndo, setCanUndo] = useState(false);
  const undoStack = useRef<GameState[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [combatOpen, setCombatOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [settingsOpponents, setSettingsOpponents] = useState<Opponent[]>([]);
  const [settingsDifficulty, setSettingsDifficulty] = useState<Difficulty>("balanced");
  const [settingsSeed, setSettingsSeed] = useState("");

  const [combatTarget, setCombatTarget] = useState("");
  const [outgoingAttackers, setOutgoingAttackers] = useState<OutgoingAttacker[]>([]);
  const [attackerName, setAttackerName] = useState("");
  const [attackerPower, setAttackerPower] = useState(1);
  const [attackerCommander, setAttackerCommander] = useState(false);
  const [attackerCommanderSlot, setAttackerCommanderSlot] = useState<CommanderSlot>("primary");
  const [attackerKeywords, setAttackerKeywords] = useState<Keyword[]>([]);
  const [defense, setDefense] = useState<DefenseResult | null>(null);
  const [regularDamageDraft, setRegularDamageDraft] = useState(0);
  const [commanderDamageDraft, setCommanderDamageDraft] = useState<Record<string, number>>({});
  const [outgoingLifelinkDraft, setOutgoingLifelinkDraft] = useState(0);
  const [incomingRegularDraft, setIncomingRegularDraft] = useState(0);
  const [incomingCommanderDraft, setIncomingCommanderDraft] = useState(0);
  const [incomingLifelinkDraft, setIncomingLifelinkDraft] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as GameState;
          if (parsed.version === 1 && parsed.currentEvent && Array.isArray(parsed.opponents)) setGame(parsed);
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHydrated(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game, hydrated]);

  const commit = useCallback((update: (previous: GameState) => GameState) => {
    undoStack.current = [...undoStack.current.slice(-9), game];
    setCanUndo(true);
    setGame(update(game));
  }, [game]);

  const sourceOpponent = game.opponents.find((opponent) => opponent.id === game.currentEvent.sourceId);
  const incomingTotal = game.currentEvent.attackers ? incomingDamage(game.currentEvent.attackers) : 0;
  const incomingCommanderTotal = game.currentEvent.attackers ? incomingCommanderDamage(game.currentEvent.attackers) : 0;
  const incomingRegularTotal = Math.max(0, incomingTotal - incomingCommanderTotal);
  const incomingLifelinkTotal = game.currentEvent.attackers?.filter((attacker) => attacker.keywords.includes("Lifelink")).reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0) ?? 0;
  const livingOpponents = game.opponents.filter((opponent) => !opponent.eliminated);

  const resolveEvent = useCallback((title: string, detail: string, tone: HistoryTone, patch: Partial<GameState> = {}) => {
    commit((previous) => ({
      ...previous,
      ...patch,
      eventStatus: "resolved",
      responseStage: "resolved",
      resolution: detail,
      history: [historyEntry(previous, title, detail, tone), ...previous.history].slice(0, 40),
    }));
  }, [commit]);

  const letEventResolve = useCallback(() => {
    const event = game.currentEvent;
    if (event.kind === "attack") return;
    if (event.kind === "threat" && event.threat) {
      resolveEvent("Threat established", `${event.sourceName}’s ${event.card} is now on a ${event.threat.remaining}-turn clock.`, "warning", { activeThreat: event.threat });
      return;
    }
    resolveEvent(`${event.card} resolves`, "Apply the generated outcome in your playtester, then advance the table.", event.kind === "wipe" ? "warning" : "damage");
  }, [game.currentEvent, resolveEvent]);

  const answerEvent = useCallback((answer: "counter" | "protect" | "redirect" | "custom" | "counter-again") => {
    const event = game.currentEvent;
    if ((answer === "counter" || answer === "counter-again") && game.responseStage !== "counterback") {
      const profile = sourceOpponent?.profile ?? "midrange";
      if (counterBacks({ profile, seed: game.seed, turn: game.turn, counter: game.history.length, difficulty: game.difficulty })) {
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
    resolveEvent("Action answered", labels[answer], "success");
  }, [commit, game, resolveEvent, sourceOpponent?.profile]);

  const applyIncoming = useCallback((regularDamage: number, commanderDamage: number, label: string, lifelinkDamage = 0) => {
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
    );
  }, [game, resolveEvent]);

  const advanceTurn = useCallback(() => {
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
        difficulty: previous.difficulty,
      });
      return {
        ...previous,
        turn,
        eventCounter,
        currentEvent,
        eventStatus: "pending",
        responseStage: "prompt",
        resolution: "",
        activeThreat,
        recentTemplateIds,
      };
    });
  }, [commit]);

  const adjustLife = useCallback((target: "user" | string, amount: number) => {
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
      const sourceEliminated = previous.eventStatus === "pending" && opponents.some((opponent) => opponent.id === previous.currentEvent.sourceId && opponent.eliminated);
      const sourceResolution = `${previous.currentEvent.sourceName} left the game, so their pending action was removed from the stack or combat.`;
      return {
        ...previous,
        opponents,
        activeThreat,
        gameOver: tableDefeated ? "You eliminated every simulated opponent." : previous.gameOver,
        ...(sourceEliminated ? {
          eventStatus: "resolved" as const,
          responseStage: "resolved" as const,
          resolution: sourceResolution,
          history: [historyEntry(previous, "Pending action cancelled", sourceResolution, "neutral"), ...previous.history].slice(0, 40),
        } : {}),
      };
    });
  }, [commit]);

  const stopThreat = useCallback(() => {
    if (!game.activeThreat) return;
    commit((previous) => ({
      ...previous,
      activeThreat: null,
      history: [historyEntry(previous, "Threat answered", `${previous.activeThreat?.title ?? "The active threat"} is no longer threatening the table.`, "success"), ...previous.history].slice(0, 40),
    }));
  }, [commit, game.activeThreat]);

  const delayThreat = useCallback(() => {
    if (!game.activeThreat || game.activeThreat.delayed) return;
    commit((previous) => ({
      ...previous,
      activeThreat: previous.activeThreat ? { ...previous.activeThreat, remaining: previous.activeThreat.remaining + 1, delayed: true } : null,
      history: [historyEntry(previous, "Threat delayed", "You bought one additional turn.", "success"), ...previous.history].slice(0, 40),
    }));
  }, [commit, game.activeThreat]);

  const openSettings = useCallback(() => {
    setSettingsOpponents(cloneOpponents(game.opponents));
    setSettingsDifficulty(game.difficulty);
    setSettingsSeed(game.seed);
    setSettingsOpen(true);
  }, [game]);

  const saveSettings = useCallback(() => {
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
          difficulty: settingsDifficulty,
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
        difficulty: settingsDifficulty,
      });
      return {
        ...previous,
        seed,
        difficulty: settingsDifficulty,
        opponents,
        eventCounter,
        currentEvent,
        eventStatus: "pending",
        responseStage: "prompt",
        resolution: "",
        activeThreat: previous.activeThreat && opponents.some((opponent) => opponent.id === previous.activeThreat?.ownerId) ? previous.activeThreat : null,
        history: [historyEntry(previous, "Table updated", "Opponent profiles and pressure settings changed.", "neutral"), ...previous.history].slice(0, 40),
      };
    });
    setSettingsOpen(false);
  }, [commit, settingsDifficulty, settingsOpponents, settingsSeed]);

  const openCombat = useCallback(() => {
    const firstTarget = game.opponents.find((opponent) => !opponent.eliminated)?.id ?? game.opponents[0]?.id ?? "";
    setCombatTarget(firstTarget);
    setOutgoingAttackers([]);
    setAttackerName("");
    setAttackerPower(1);
    setAttackerCommander(false);
    setAttackerCommanderSlot("primary");
    setAttackerKeywords([]);
    setDefense(null);
    setRegularDamageDraft(0);
    setCommanderDamageDraft({});
    setOutgoingLifelinkDraft(0);
    setCombatOpen(true);
  }, [game.opponents]);

  const addOutgoingAttacker = useCallback(() => {
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
  }, [attackerCommander, attackerCommanderSlot, attackerKeywords, attackerName, attackerPower, outgoingAttackers.length]);

  const fullCombatDamage = useCallback((attackers: OutgoingAttacker[], ignoredId?: string) => {
    const regular = attackers.filter((attacker) => !attacker.isCommander && attacker.id !== ignoredId)
      .reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0);
    const commander = Object.fromEntries(attackers.filter((attacker) => attacker.isCommander && attacker.id !== ignoredId)
      .map((attacker) => [attacker.id, attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1)]));
    const lifelink = attackers.filter((attacker) => attacker.id !== ignoredId && attacker.keywords.includes("Lifelink"))
      .reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0);
    return { regular, commander, lifelink };
  }, []);

  const prepareDamage = useCallback((result: DefenseResult) => {
    let ignoredId: string | undefined;
    if (result.type === "removal") ignoredId = [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id;
    const full = fullCombatDamage(outgoingAttackers, ignoredId);
    const prevented = result.type === "fog";
    setRegularDamageDraft(prevented ? 0 : full.regular);
    setCommanderDamageDraft(prevented ? Object.fromEntries(Object.keys(full.commander).map((key) => [key, 0])) : full.commander);
    setOutgoingLifelinkDraft(prevented ? 0 : full.lifelink);
  }, [fullCombatDamage, outgoingAttackers]);

  const simulateDefense = useCallback(() => {
    const target = game.opponents.find((opponent) => opponent.id === combatTarget);
    if (!target || !outgoingAttackers.length) return;
    const result = rollDefense({
      profile: target.profile,
      seed: game.seed,
      turn: game.turn,
      counter: game.defenseCounter + 1,
      difficulty: game.difficulty,
      attackers: outgoingAttackers,
    });
    setDefense(result);
    prepareDamage(result);
    setGame((previous) => ({ ...previous, defenseCounter: previous.defenseCounter + 1 }));
  }, [combatTarget, game, outgoingAttackers, prepareDamage]);

  const answerDefense = useCallback(() => {
    const result: DefenseResult = { type: "none", title: "Defense answered", detail: "Your interaction stops the defensive play. Resolve combat normally." };
    setDefense(result);
    prepareDamage(result);
  }, [prepareDamage]);

  const applyOutgoingDamage = useCallback(() => {
    const target = game.opponents.find((opponent) => opponent.id === combatTarget);
    if (!target || !defense) return;
    const removedId = defense.type === "removal" ? [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id : undefined;
    const full = defense.type === "fog" ? { regular: 0, commander: {} as Record<string, number>, lifelink: 0 } : fullCombatDamage(outgoingAttackers, removedId);
    const commanderHits: Record<string, number> = {};
    outgoingAttackers.filter((attacker) => attacker.isCommander).forEach((attacker) => {
      const damage = Math.min(full.commander[attacker.id] ?? 0, Math.max(0, commanderDamageDraft[attacker.id] ?? 0));
      const commanderId = userCommanderKey(attacker.commanderSlot ?? "primary");
      commanderHits[commanderId] = (commanderHits[commanderId] ?? 0) + damage;
    });
    const result = applyCombatDamage({ life: target.life, commanderDamage: target.commanderDamage, regularDamage: Math.min(full.regular, regularDamageDraft), commanderHits });
    const lifelinkGain = Math.min(full.lifelink, outgoingLifelinkDraft, result.totalDamage);
    commit((previous) => {
      const opponents = previous.opponents.map((opponent) => opponent.id === target.id
        ? { ...opponent, life: result.life, commanderDamage: result.commanderDamage, eliminated: result.defeated }
        : opponent);
      const reason = result.lethalCommander ? `${USER_COMMANDER_LABELS[result.lethalCommander] ?? result.lethalCommander} reached 21 commander damage.` : result.life <= 0 ? `${target.name} reached ${result.life} life.` : "";
      const detail = `${result.totalDamage} damage assigned to ${target.name}.${lifelinkGain ? ` You gained ${lifelinkGain} life.` : ""}${reason ? ` ${reason}` : ""}`;
      const tableDefeated = opponents.every((opponent) => opponent.eliminated);
      const sourceEliminated = result.defeated && previous.eventStatus === "pending" && previous.currentEvent.sourceId === target.id;
      const sourceResolution = `${target.name} left the game, so their pending action was removed from the stack or combat.`;
      const damageHistory = historyEntry(previous, result.defeated ? `${target.name} eliminated` : `Damage assigned to ${target.name}`, detail, result.defeated ? "success" : "damage");
      return {
        ...previous,
        userLife: previous.userLife + lifelinkGain,
        opponents,
        activeThreat: result.defeated && previous.activeThreat?.ownerId === target.id ? null : previous.activeThreat,
        gameOver: tableDefeated ? "You eliminated every simulated opponent." : previous.gameOver,
        history: [damageHistory, ...(sourceEliminated ? [historyEntry(previous, "Pending action cancelled", sourceResolution, "neutral")] : []), ...previous.history].slice(0, 40),
        ...(sourceEliminated ? { eventStatus: "resolved" as const, responseStage: "resolved" as const, resolution: sourceResolution } : {}),
      };
    });
    setCombatOpen(false);
  }, [combatTarget, commanderDamageDraft, commit, defense, fullCombatDamage, game.opponents, outgoingAttackers, outgoingLifelinkDraft, regularDamageDraft]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (previous) {
      setGame(previous);
      setCanUndo(undoStack.current.length > 0);
    }
  }, []);

  const resetSession = useCallback(() => {
    const seed = `CAST-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    undoStack.current = [];
    setCanUndo(false);
    setGame(createInitialGame(seed, game.opponents.map((opponent) => ({ ...opponent, life: 40, commanderDamage: {}, eliminated: false })), game.difficulty));
    setResetOpen(false);
  }, [game.difficulty, game.opponents]);

  const maxUserCommanderDamage = highestCommanderDamage(game.userCommanderDamage);
  const tableDefeated = game.opponents.every((opponent) => opponent.eliminated);
  const userDefeated = game.userLife <= 0 || maxUserCommanderDamage >= 21;
  const opponentCommanderLabels = Object.fromEntries(game.opponents.map((opponent) => [opponentCommanderKey(opponent.id), `${opponent.name}’s commander`]));
  const removedAttackerId = defense?.type === "removal" ? [...outgoingAttackers].sort((a, b) => b.power - a.power)[0]?.id : undefined;
  const outgoingDamageLimit = defense?.type === "fog" ? { regular: 0, commander: {} as Record<string, number>, lifelink: 0 } : fullCombatDamage(outgoingAttackers, removedAttackerId);
  const liveMessage = game.gameOver
    ?? (combatOpen && defense ? `Defense roll: ${defense.title}. ${defense.detail}` : null)
    ?? (game.responseStage === "counterback" ? "Your counter was countered. Choose whether to answer again or let the original action resolve." : null)
    ?? (game.responseStage === "choose" ? "Response choices are ready: counter, protect, redirect, or use another answer." : null)
    ?? (game.responseStage === "combat" ? "Combat damage fields are ready. Enter the regular and commander damage that reached you." : null)
    ?? (game.eventStatus === "pending" ? `${eventKindLabel(game.currentEvent)}: ${game.currentEvent.title}` : game.resolution);
  return (
    <main className="app-shell">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
      {game.gameOver && <div className="sr-only" role="alert">{game.gameOver}</div>}

      <header className="topbar">
        <a className="brand" href="#main-workspace" aria-label="Goldfish Lab home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Goldfish</strong><small>Lab</small></span>
        </a>
        <div className="turn-strip" aria-label={`Turn ${game.turn}`}>
          <span className="eyebrow">Turn {game.turn}</span>
          <b>{game.paused ? "Session paused" : game.eventStatus === "pending" ? "Table has priority" : "Ready to advance"}</b>
          <span className="turn-dots" aria-hidden="true"><i className="done" /><i className={game.eventStatus === "pending" ? "active" : "done"} /><i className={game.eventStatus === "resolved" ? "active" : ""} /><i /><i /></span>
        </div>
        <div className="top-actions">
          <button className="link-button" type="button" onClick={openSettings}>Table setup</button>
          <button className="ghost-button" type="button" onClick={() => setGame((previous) => ({ ...previous, paused: !previous.paused }))}>{game.paused ? "Resume session" : "Pause session"}</button>
        </div>
      </header>

      <section className="workspace" id="main-workspace">
        <aside className="rail opponents-panel" aria-labelledby="opponents-title">
          <div className="section-heading">
            <div><span className="eyebrow">The table</span><h2 id="opponents-title">Opponents</h2></div>
            <button className="icon-button" type="button" onClick={openSettings} aria-label="Edit opponents">+</button>
          </div>
          <div className="opponent-list">
            {game.opponents.map((opponent, index) => (
              <article className={`opponent ${opponent.eliminated ? "eliminated" : ""}`} key={opponent.id}>
                <span className={`avatar avatar-${index + 1}`}>{opponent.name.slice(0, 1).toUpperCase()}</span>
            <div className="opponent-copy"><strong>{opponent.name}</strong><small>{opponent.eliminated ? "Eliminated" : PROFILE_LABELS[opponent.profile]}</small><CommanderLedger damage={opponent.commanderDamage} labels={USER_COMMANDER_LABELS} /></div>
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
            <div className="opponent-copy"><strong>Your board</strong><small>Highest commander damage: {maxUserCommanderDamage}</small><CommanderLedger damage={game.userCommanderDamage} labels={opponentCommanderLabels} dark /></div>
            <div className="life-control life-control-dark">
              <button type="button" onClick={() => adjustLife("user", -1)} aria-label="Remove one life from you">−</button>
              <span className="life" aria-live="polite"><b>{game.userLife}</b><small>life</small></span>
              <button type="button" onClick={() => adjustLife("user", 1)} aria-label="Add one life to you">+</button>
            </div>
          </article>
          <button className="secondary-wide" type="button" onClick={openCombat} disabled={!livingOpponents.length}>Assign your combat damage <span>→</span></button>
          <p className="rail-note">Tap attackers in your playtester, then let this table roll a defense.</p>
        </aside>

        <section className="encounter-column" aria-labelledby="encounter-title">
          <div className="encounter-intro">
            <div><span className="eyebrow">{game.eventStatus === "pending" ? "Priority check" : "Outcome recorded"}</span><h1 id="encounter-title">{game.eventStatus === "pending" ? "The table acts." : "Action resolved."}</h1></div>
            <span className="event-number">Event {String(game.eventCounter).padStart(2, "0")}</span>
          </div>

          <article className={`encounter-card event-${game.currentEvent.kind}`}>
            <div className="card-topline">
              <span className="event-type"><i aria-hidden="true">✦</i> {eventKindLabel(game.currentEvent)}</span>
              <span className={game.currentEvent.kind === "threat" ? "danger-badge" : "source-badge"}>{game.currentEvent.sourceName} · {game.currentEvent.card}</span>
            </div>
            <div className={`spell-art spell-art-${game.currentEvent.kind}`} aria-hidden="true"><span>{eventGlyph(game.currentEvent)}</span><i /><i /><i /></div>
            <div className="encounter-copy">
              <p className="source"><span className="avatar avatar-1">{game.currentEvent.sourceName.slice(0, 1)}</span> {game.currentEvent.sourceName} takes an action</p>
              <h2>{game.currentEvent.title}</h2>
              <p>{game.currentEvent.prompt}</p>
              <div className="tag-row">{game.currentEvent.tags.map((tag) => <span className="event-tag" key={tag}>{tag}</span>)}</div>

              {game.currentEvent.attackers && (
                <div className="incoming-attackers">
                  {game.currentEvent.attackers.map((attacker) => (
                    <article key={attacker.id}>
                      <div><strong>{attacker.name}</strong>{attacker.isCommander && <span className="commander-badge">Commander</span>}</div>
                      <b className="pt">{attacker.power}/{attacker.toughness}</b>
                      <div className="keyword-row">{attacker.keywords.length ? attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />) : <span className="vanilla">No keywords</span>}</div>
                    </article>
                  ))}
                  <p className="combat-total"><strong>{incomingTotal}</strong> maximum incoming damage · <strong>{incomingCommanderTotal}</strong> commander</p>
                </div>
              )}
            </div>

            <fieldset className="event-fieldset" disabled={game.paused || game.eventStatus === "resolved"}>
              {game.responseStage === "prompt" && game.currentEvent.kind !== "attack" && (
                <div className="response-box">
                  <span className="eyebrow">Do you have a response?</span>
                  <div className="response-actions">
                    <button className="primary-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "choose" }))}>Yes, I respond <span>→</span></button>
                    <button className="secondary-button" type="button" onClick={letEventResolve}>No response</button>
                    {game.currentEvent.kind !== "threat" && <button className="text-button" type="button" onClick={() => resolveEvent("Action misses", "No game object was affected, so the generated action has no effect.", "neutral")}>{game.currentEvent.kind === "targeted" || game.currentEvent.kind === "counter" ? "No legal target" : "Nothing affected"}</button>}
                  </div>
                </div>
              )}

              {game.responseStage === "choose" && (
                <div className="response-box response-choice-box">
                  <span className="eyebrow">Choose the line you used</span>
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
                  <span className="danger-badge">Counter to your counter</span>
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
                  <span className="eyebrow">Declare your defense</span>
                  <div className="response-actions combat-actions">
                    <button className="primary-button" type="button" onClick={() => { setIncomingRegularDraft(0); setIncomingCommanderDraft(0); setIncomingLifelinkDraft(0); setGame((previous) => ({ ...previous, responseStage: "combat" })); }}>Block / interact <span>→</span></button>
                    <button className="secondary-button" type="button" onClick={() => applyIncoming(incomingRegularTotal, incomingCommanderTotal, "Attack connected", incomingLifelinkTotal)}>Take the hit</button>
                    <button className="text-button" type="button" onClick={() => applyIncoming(0, 0, "Combat prevented")}>Fog / stop combat</button>
                  </div>
                </div>
              )}

              {game.responseStage === "combat" && (
                <div className="response-box combat-resolution">
                  <span className="eyebrow">After blocks and interaction</span>
                  <p>Resolve exact combat in your playtester, then enter only damage that reaches you.</p>
                  <div className="damage-inputs">
                    <label>Regular combat damage<input type="number" min="0" max={incomingRegularTotal} value={incomingRegularDraft} onChange={(event) => setIncomingRegularDraft(Math.max(0, Number(event.target.value)))} /></label>
                    <label>Commander combat damage<input type="number" min="0" max={incomingCommanderTotal} value={incomingCommanderDraft} onChange={(event) => setIncomingCommanderDraft(Math.max(0, Number(event.target.value)))} /></label>
                    {incomingLifelinkTotal > 0 && <label>Lifelink damage dealt<input type="number" min="0" max={incomingLifelinkTotal} value={incomingLifelinkDraft} onChange={(event) => setIncomingLifelinkDraft(Math.min(incomingLifelinkTotal, Math.max(0, Number(event.target.value))))} /></label>}
                  </div>
                  <div className="modal-actions compact-actions">
                    <button className="text-button" type="button" onClick={() => setGame((previous) => ({ ...previous, responseStage: "prompt" }))}>Back</button>
                    <button className="primary-button" type="button" onClick={() => applyIncoming(Math.min(incomingRegularTotal, incomingRegularDraft), Math.min(incomingCommanderTotal, incomingCommanderDraft), "Combat resolved", Math.min(incomingLifelinkTotal, incomingLifelinkDraft))}>Apply damage <span>→</span></button>
                  </div>
                </div>
              )}
            </fieldset>

            {game.eventStatus === "resolved" && (
              <div className="resolved-box" role="status"><span className="resolved-mark">✓</span><div><span className="eyebrow">Recorded</span><strong>{game.resolution}</strong></div></div>
            )}
          </article>

          <div className="next-action">
            <div><span className="eyebrow">Up next</span><strong>{game.eventStatus === "resolved" ? "Advance one full table round." : "Resolve this event, then advance the table."}</strong></div>
            <div className="next-buttons">
              <button className="undo-button" type="button" onClick={undo} disabled={!canUndo}>Undo</button>
              <button className="advance-button" type="button" onClick={advanceTurn} disabled={game.eventStatus !== "resolved" || game.paused || Boolean(game.gameOver)}>Next turn <span>→</span></button>
            </div>
          </div>
        </section>

        <aside className="rail pressure-panel" aria-label="Table pressure">
          <section aria-labelledby="threat-title" aria-live="polite">
            <div className="section-heading">
              <div><span className="eyebrow">Clock is ticking</span><h2 id="threat-title">Active threat</h2></div>
              {game.activeThreat && <span className={`countdown ${game.activeThreat.remaining <= 1 ? "imminent" : ""}`}>{game.activeThreat.remaining} {game.activeThreat.remaining === 1 ? "turn" : "turns"}</span>}
            </div>
            {game.activeThreat ? (
              <article className="threat-card">
                <span className="threat-icon" aria-hidden="true">!</span>
                <div><strong>{game.activeThreat.title}</strong><p>{game.activeThreat.description}</p></div>
                <div className="threat-actions">
                  <button className="text-button light" type="button" onClick={stopThreat}>I answered this threat</button>
                  <button className="text-button light" type="button" onClick={delayThreat} disabled={game.activeThreat.delayed}>{game.activeThreat.delayed ? "Already delayed" : "Delay +1 turn"}</button>
                </div>
              </article>
            ) : (
              <div className="empty-threat"><span>○</span><strong>No active clock</strong><p>Game-ending threats begin appearing from turn 5.</p></div>
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
        <button type="button" onClick={() => setLibraryOpen(true)}>Scenario library · {CARD_LIBRARY_UPDATED}</button>
        <span>{hydrated ? "Draft saved on this device" : "Loading session…"}</span>
        <button type="button" onClick={() => setResetOpen(true)}>Restart session</button>
      </footer>

      {settingsOpen && (
        <Modal title="Set up the table" subtitle="Choose one to three profiles. These shape event mix, attack pressure, counters, and defenses." onClose={() => setSettingsOpen(false)} wide>
          <div className="settings-body">
            <div className="opponent-settings">
              {settingsOpponents.map((opponent, index) => (
                <div className="opponent-setting" key={opponent.id}>
                  <span className={`avatar avatar-${index + 1}`}>{opponent.name.slice(0, 1).toUpperCase() || index + 1}</span>
                  <label>Name<input value={opponent.name} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, name: event.target.value } : item))} /></label>
                  <label>Deck profile<select value={opponent.profile} onChange={(event) => setSettingsOpponents((current) => current.map((item) => item.id === opponent.id ? { ...item, profile: event.target.value as ProfileId } : item))}>{Object.entries(PROFILE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <button className="remove-button" type="button" onClick={() => setSettingsOpponents((current) => current.filter((item) => item.id !== opponent.id))} disabled={settingsOpponents.length === 1} aria-label={`Remove ${opponent.name}`}>Remove</button>
                </div>
              ))}
              <button className="add-opponent" type="button" onClick={() => setSettingsOpponents((current) => [...current, { id: `opponent-${Date.now()}`, name: `Opponent ${current.length + 1}`, profile: "midrange", life: 40, commanderDamage: {}, eliminated: false }])} disabled={settingsOpponents.length >= 3}>+ Add opponent</button>
            </div>
            <div className="session-settings">
              <label>Pressure level<select value={settingsDifficulty} onChange={(event) => setSettingsDifficulty(event.target.value as Difficulty)}><option value="friendly">Friendly — more breathing room</option><option value="balanced">Typical table</option><option value="punishing">Punishing — sharper answers</option></select></label>
              <label>Session seed<input value={settingsSeed} onChange={(event) => setSettingsSeed(event.target.value.toUpperCase())} maxLength={24} /></label>
              <p>Reuse a seed with the same choices to replay the same event sequence.</p>
            </div>
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={saveSettings}>Apply and reroll <span>→</span></button></div>
        </Modal>
      )}

      {combatOpen && (
        <Modal title="Assign your attack" subtitle="Add the creatures you tapped in your playtester, roll one table defense, then confirm damage." onClose={() => setCombatOpen(false)} wide>
          <div className="combat-builder">
            <label className="target-select">Attack target<select value={combatTarget} onChange={(event) => { setCombatTarget(event.target.value); setDefense(null); }}>{livingOpponents.map((opponent) => <option value={opponent.id} key={opponent.id}>{opponent.name} · {PROFILE_LABELS[opponent.profile]} · {opponent.life} life</option>)}</select></label>
            <div className="attacker-form">
              <label>Attacker name<input placeholder="e.g. Atraxa" value={attackerName} onChange={(event) => setAttackerName(event.target.value)} /></label>
              <label>Power<input type="number" min="0" value={attackerPower} onChange={(event) => setAttackerPower(Math.max(0, Number(event.target.value)))} /></label>
              <label className="check-label"><input type="checkbox" checked={attackerCommander} onChange={(event) => setAttackerCommander(event.target.checked)} />Commander</label>
              {attackerCommander && <label>Commander identity<select value={attackerCommanderSlot} onChange={(event) => setAttackerCommanderSlot(event.target.value as CommanderSlot)}><option value="primary">Primary commander</option><option value="partner">Partner commander</option></select></label>}
              <div className="keyword-picker" aria-label="Attacker keywords">{COMBAT_KEYWORDS.map((keyword) => <label key={keyword}><input type="checkbox" checked={attackerKeywords.includes(keyword)} onChange={() => setAttackerKeywords((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword])} />{keyword}</label>)}</div>
              <button className="secondary-button add-attacker-button" type="button" onClick={addOutgoingAttacker}>Add attacker</button>
            </div>

            <div className="outgoing-list">
              {outgoingAttackers.length ? outgoingAttackers.map((attacker) => (
                <article key={attacker.id}><div><strong>{attacker.name}</strong><small>{attacker.isCommander ? "Commander" : "Creature"}</small></div><b>{attacker.power} power</b><div className="keyword-row">{attacker.keywords.map((keyword) => <KeywordChip keyword={keyword} key={keyword} />)}</div><button type="button" onClick={() => { setOutgoingAttackers((current) => current.filter((item) => item.id !== attacker.id)); setDefense(null); }} aria-label={`Remove ${attacker.name}`}>×</button></article>
              )) : <div className="empty-attackers">No attackers added yet.</div>}
            </div>

            <button className="roll-button" type="button" onClick={simulateDefense} disabled={!outgoingAttackers.length || !combatTarget}>Roll defending player’s response <span>↻</span></button>

            {defense && (
              <div className={`defense-result defense-${defense.type}`} role="status">
                <span className="eyebrow">Defense outcome</span><h3>{defense.title}</h3><p>{defense.detail}</p>
                {defense.type !== "none" && <button className="text-button" type="button" onClick={answerDefense}>I can answer this defense</button>}
              </div>
            )}

            {defense && (
              <div className="damage-confirm">
                <span className="eyebrow">Damage that gets through</span>
                <p>Override these values after resolving blocks, removal, or prevention in your playtester.</p>
                <div className="damage-inputs">
                  <label>Noncommander damage<input type="number" min="0" max={outgoingDamageLimit.regular} value={regularDamageDraft} onChange={(event) => setRegularDamageDraft(Math.min(outgoingDamageLimit.regular, Math.max(0, Number(event.target.value))))} /></label>
                  {outgoingAttackers.filter((attacker) => attacker.isCommander).map((attacker) => <label key={attacker.id}>{attacker.name} damage<input type="number" min="0" max={outgoingDamageLimit.commander[attacker.id] ?? 0} value={commanderDamageDraft[attacker.id] ?? 0} onChange={(event) => setCommanderDamageDraft((current) => ({ ...current, [attacker.id]: Math.min(outgoingDamageLimit.commander[attacker.id] ?? 0, Math.max(0, Number(event.target.value))) }))} /></label>)}
                  {outgoingDamageLimit.lifelink > 0 && <label>Lifelink damage dealt<input type="number" min="0" max={outgoingDamageLimit.lifelink} value={outgoingLifelinkDraft} onChange={(event) => setOutgoingLifelinkDraft(Math.min(outgoingDamageLimit.lifelink, Math.max(0, Number(event.target.value))))} /></label>}
                </div>
              </div>
            )}
          </div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCombatOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={applyOutgoingDamage} disabled={!defense}>Apply damage <span>→</span></button></div>
        </Modal>
      )}

      {libraryOpen && (
        <Modal title="Curated scenario library" subtitle="Versioned, emblematic examples flavor the simulation; generic rules-aware outcomes keep working even when the catalog is stale." onClose={() => setLibraryOpen(false)} wide>
          <div className="library-grid">{CARD_LIBRARY.map((group) => <article key={group.archetype}><span className="eyebrow">Archetype</span><h3>{group.archetype}</h3><ul>{group.cards.map((card) => <li key={card}>{card}</li>)}</ul></article>)}</div>
          <div className="library-note"><strong>Library updated {CARD_LIBRARY_UPDATED}</strong><p>Scenario language follows Wizards’ definitions for counter, destroy, exile, flying, reach, trample, menace, deathtouch, first strike, double strike, hexproof, and indestructible.</p><a href="https://magic.wizards.com/en/keyword-glossary" target="_blank" rel="noreferrer">Open the official keyword glossary ↗</a></div>
        </Modal>
      )}

      {resetOpen && (
        <Modal title="Restart this session?" subtitle="This clears life totals, damage, threats, and history. Your opponent profiles stay in place." onClose={() => setResetOpen(false)}>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setResetOpen(false)}>Keep playing</button><button className="danger-button" type="button" onClick={resetSession}>Restart with a new seed</button></div>
        </Modal>
      )}

      {game.gameOver && (
        <Modal title="The goldfish game ended" subtitle={game.gameOver} dismissible={!tableDefeated && !userDefeated} onClose={() => setGame((previous) => ({ ...previous, gameOver: null, activeThreat: previous.activeThreat && previous.activeThreat.remaining <= 0 ? null : previous.activeThreat }))}>
          <div className="session-summary"><span><b>{game.turn}</b> turns reached</span><span><b>{game.history.filter((entry) => entry.title.includes("answered")).length}</b> threats/actions answered</span><span><b>{game.userLife}</b> life remaining</span></div>
          <div className="modal-actions">{!tableDefeated && !userDefeated && <button className="secondary-button" type="button" onClick={() => setGame((previous) => ({ ...previous, gameOver: null, activeThreat: previous.activeThreat && previous.activeThreat.remaining <= 0 ? null : previous.activeThreat }))}>Continue anyway</button>}<button className="primary-button" type="button" onClick={resetSession}>Start a new run <span>→</span></button></div>
        </Modal>
      )}
    </main>
  );
}
