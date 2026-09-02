import {
  COMMANDER_BRACKETS,
  DECK_PROFILES,
  EVENT_TEMPLATES,
  KEYWORD_DEFINITIONS,
  developmentEvent,
  evaluateTrackedLoss,
  opponentCommanderKey,
  responseMetadataForEvent,
  type Attacker,
  type CommanderBracket,
  type EventKind,
  type Opponent,
  type ProfileId,
  type ResponseOption,
  type SimEvent,
  type Threat,
} from "./simulator.ts";

export const GAME_STATE_VERSION = 6 as const;

export type ResponseStage = "prompt" | "choose" | "counterback" | "combat" | "resolved";
export type HistoryTone = "success" | "damage" | "warning" | "neutral";

export type HistoryEntry = {
  id: string;
  turn: number;
  title: string;
  detail: string;
  tone: HistoryTone;
};

export type GameState = {
  version: typeof GAME_STATE_VERSION;
  turn: number;
  eventCounter: number;
  defenseCounter: number;
  seed: string;
  opponents: Opponent[];
  userLife: number;
  userLossProtected: boolean;
  userPoisonCounters: number;
  userCommanderDamage: Record<string, number>;
  currentEvent: SimEvent;
  responseStage: ResponseStage;
  resolution: string;
  toxicDelugePayment: { eventId: string; amount: number } | null;
  activeThreat: Threat | null;
  recentTemplateIds: string[];
  history: HistoryEntry[];
  answeredCount: number;
  combatResolvedTurn: number | null;
  counterExchange: number;
  gameOver: string | null;
};

type UnknownRecord = Record<string, unknown>;
type StoredEvent = Omit<SimEvent, "kind"> & { kind: EventKind | "signature" };

// Retired reveal follow-ups are accepted only for saved-session migration.
const SIGNATURE_USE_TEMPLATE_ID = "signature-card-encounter";
const LEGACY_SIGNATURE_METADATA: Pick<SimEvent, "responseOptions" | "emptyOutcome"> = {
  responseOptions: ["custom"],
  emptyOutcome: "There was no legal opportunity to use the revealed card in the current playtest state.",
};

const PROFILES = new Set(Object.keys(DECK_PROFILES));
const BRACKETS = new Set<unknown>(Object.keys(COMMANDER_BRACKETS).map(Number));
const EVENT_KINDS = new Set<string>(["targeted", "wipe", "counter", "disruption", "attack", "threat", "development", "signature"]);
const KEYWORDS = new Set(Object.keys(KEYWORD_DEFINITIONS));
const RESPONSE_STAGES = new Set<string>(["prompt", "choose", "counterback", "combat", "resolved"]);
const RESPONSE_OPTIONS = new Set<string>(["counter", "protect", "redirect", "custom"]);
const HISTORY_TONES = new Set<string>(["success", "damage", "warning", "neutral"]);
const ANSWERED_TITLES = new Set(["Action answered", "Threat answered", "Combat prevented"]);
const COMBAT_TITLES = new Set(["Attack connected", "Combat prevented", "Combat resolved"]);

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed() && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readStringArray(value: unknown, nonempty = false): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string" && (!nonempty || item.trim().length > 0)) ? value.map(String) : undefined;
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasSameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readDamageLedger(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([id, damage]) => !isNonemptyString(id) || !isCount(damage))) return undefined;
  return Object.fromEntries(entries) as Record<string, number>;
}

function readThreat(value: unknown, opponentIds: ReadonlySet<string>, allowExpired = false): Threat | undefined {
  if (!isRecord(value)
    || !isNonemptyString(value.id)
    || !isNonemptyString(value.ownerId)
    || !opponentIds.has(value.ownerId)
    || typeof value.title !== "string"
    || typeof value.description !== "string"
    || !isCount(value.remaining)
    || (!allowExpired && value.remaining === 0)
    || typeof value.delayed !== "boolean") return undefined;

  return {
    id: value.id,
    ownerId: value.ownerId,
    title: value.title,
    description: value.description,
    remaining: value.remaining,
    delayed: value.delayed,
  };
}

function readOpponent(value: unknown, version: number): Opponent | undefined {
  if (!isRecord(value)
    || !isNonemptyString(value.id)
    || typeof value.name !== "string"
    || typeof value.profile !== "string"
    || !PROFILES.has(value.profile)
    || typeof value.life !== "number"
    || !Number.isSafeInteger(value.life)
    || typeof value.eliminated !== "boolean") return undefined;

  const bracket = value.bracket === undefined && version === 1 ? 3 : value.bracket;
  const commanderDamage = readDamageLedger(value.commanderDamage);
  if (!BRACKETS.has(bracket) || !commanderDamage) return undefined;

  const poisonCounters = version < 5
    ? 0
    : isCount(value.poisonCounters) ? value.poisonCounters : undefined;
  if (poisonCounters === undefined) return undefined;
  const hasUnprotectedLoss = evaluateTrackedLoss({
    life: value.life,
    poisonCounters,
    commanderDamage,
  }) !== null;
  const lossProtected = version < GAME_STATE_VERSION
    ? false
    : typeof value.lossProtected === "boolean" ? value.lossProtected : undefined;
  if (lossProtected === undefined
    || (version === GAME_STATE_VERSION && hasUnprotectedLoss && !lossProtected && !value.eliminated)) return undefined;

  return {
    id: value.id,
    name: value.name,
    profile: value.profile as ProfileId,
    bracket: bracket as CommanderBracket,
    life: value.life,
    commanderDamage,
    poisonCounters,
    lossProtected,
    eliminated: value.eliminated || (version < GAME_STATE_VERSION && hasUnprotectedLoss),
  };
}

function readAttacker(value: unknown, sourceId: string, sourceName: string, version: number): Attacker | undefined {
  if (!isRecord(value)
    || !isNonemptyString(value.id)
    || typeof value.name !== "string"
    || !isCount(value.power)
    || !isCount(value.toughness)
    || typeof value.isCommander !== "boolean") return undefined;

  const keywords = readStringArray(value.keywords);
  if (!keywords || keywords.some((keyword) => !KEYWORDS.has(keyword))) return undefined;

  if (!value.isCommander && (value.commanderId !== undefined || value.commanderLabel !== undefined)) return undefined;
  let commanderId: string | undefined;
  if (value.commanderId !== undefined) {
    if (!isNonemptyString(value.commanderId)) return undefined;
    commanderId = value.commanderId;
  }
  if (value.commanderLabel !== undefined && !isNonemptyString(value.commanderLabel)) return undefined;
  if (value.isCommander && version >= 5 && !commanderId) return undefined;

  const attacker: Attacker = {
    id: value.id,
    name: value.name,
    power: value.power,
    toughness: value.toughness,
    keywords: keywords as Attacker["keywords"],
    isCommander: value.isCommander,
  };
  if (value.isCommander) {
    attacker.commanderId = commanderId ?? opponentCommanderKey(sourceId);
    const primaryId = opponentCommanderKey(sourceId);
    const partnerId = opponentCommanderKey(sourceId, "partner");
    const legacyLabel = `${sourceName}’s commander`;
    if (attacker.commanderId === primaryId && (value.commanderLabel === undefined || value.commanderLabel === legacyLabel)) {
      attacker.commanderLabel = `${sourceName}’s primary commander`;
    } else if (attacker.commanderId === partnerId && value.commanderLabel === undefined) {
      attacker.commanderLabel = `${sourceName}’s partner commander`;
    } else if (value.commanderLabel !== undefined) {
      attacker.commanderLabel = value.commanderLabel as string;
    } else if (version < GAME_STATE_VERSION) {
      attacker.commanderLabel = isNonemptyString(value.name) ? value.name : "Original commander identity";
    } else {
      return undefined;
    }
  }
  return attacker;
}

function readEvent(value: unknown, opponentIds: ReadonlySet<string>, version: number): StoredEvent | undefined {
  if (!isRecord(value)
    || !isNonemptyString(value.id)
    || !isNonemptyString(value.templateId)
    || typeof value.kind !== "string"
    || !EVENT_KINDS.has(value.kind)
    || !isNonemptyString(value.sourceId)
    || !opponentIds.has(value.sourceId)
    || typeof value.sourceName !== "string"
    || typeof value.title !== "string"
    || typeof value.prompt !== "string"
    || typeof value.card !== "string") return undefined;

  const tags = readStringArray(value.tags);
  if (!tags) return undefined;

  let attackers: Attacker[] | undefined;
  if (value.kind === "attack") {
    if (!Array.isArray(value.attackers) || value.attackers.length === 0) return undefined;
    const parsed = value.attackers.map((rawAttacker) => readAttacker(rawAttacker, value.sourceId as string, value.sourceName as string, version));
    if (!parsed.every((attacker): attacker is Attacker => attacker !== undefined)) return undefined;
    if (!hasUniqueStrings(parsed.map(({ id }) => id))) return undefined;
    const commanderIds = parsed.flatMap(({ isCommander, commanderId }) => isCommander && commanderId ? [commanderId] : []);
    if (!hasUniqueStrings(commanderIds)) return undefined;
    attackers = parsed;
  } else if (value.attackers !== undefined) {
    return undefined;
  }

  let threat: Threat | undefined;
  if (value.kind === "threat") {
    threat = readThreat(value.threat, opponentIds);
    if (!threat) return undefined;
  } else if (value.threat !== undefined) {
    return undefined;
  }

  let responseOptions: ResponseOption[] | undefined;
  if (value.responseOptions !== undefined) {
    const options = readStringArray(value.responseOptions);
    if (!options || options.some((option) => !RESPONSE_OPTIONS.has(option))) return undefined;
    responseOptions = options as ResponseOption[];
  }
  if (value.emptyOutcome !== undefined && typeof value.emptyOutcome !== "string") return undefined;
  if (version >= 5 && !responseOptions) return undefined;

  const template = EVENT_TEMPLATES.find((candidate) => candidate.id === value.templateId);
  const dynamicMetadata = template ? null
    : value.kind === "signature" && value.templateId === SIGNATURE_USE_TEMPLATE_ID ? LEGACY_SIGNATURE_METADATA
      : responseMetadataForEvent(value.templateId, value.kind as EventKind);
  if ((value.templateId === "scaled-attack" && value.kind !== "attack")
    || (value.templateId === "table-development" && value.kind !== "development")
    || (value.templateId === SIGNATURE_USE_TEMPLATE_ID && value.kind !== "signature")) return undefined;
  if (template && template.kind !== value.kind) return undefined;
  if (template && version === GAME_STATE_VERSION
    && (value.title !== template.title
      || value.prompt !== template.prompt
      || value.card !== template.card
      || !responseOptions
      || !hasSameStrings(responseOptions, template.responseOptions)
      || value.emptyOutcome !== template.emptyOutcome)) return undefined;
  if (value.kind === "signature"
    && (!dynamicMetadata
      || (version === GAME_STATE_VERSION
        && (!responseOptions
          || !hasSameStrings(responseOptions, dynamicMetadata.responseOptions)
          || value.emptyOutcome !== dynamicMetadata.emptyOutcome)))) return undefined;

  const metadata = template
    ? { responseOptions: [...template.responseOptions], emptyOutcome: template.emptyOutcome }
    : value.kind === "signature"
      ? dynamicMetadata
      : responseOptions
        ? { responseOptions, emptyOutcome: value.emptyOutcome as string | undefined }
        : dynamicMetadata;
  if (!metadata || !hasUniqueStrings(metadata.responseOptions)) return undefined;

  if ((value.kind === "attack" || value.kind === "development")
    && (metadata.responseOptions.length > 0 || metadata.emptyOutcome !== undefined)) return undefined;
  if (value.kind !== "attack" && value.kind !== "development" && metadata.responseOptions.length === 0) return undefined;

  if (threat && template) {
    if (version === GAME_STATE_VERSION
      && (threat.ownerId !== value.sourceId || threat.title !== template.title || threat.description !== template.prompt)) return undefined;
    threat = {
      ...threat,
      ownerId: value.sourceId,
      title: template.title,
      description: template.prompt,
    };
  }

  const event: StoredEvent = {
    id: value.id,
    templateId: value.templateId,
    kind: value.kind as StoredEvent["kind"],
    sourceId: value.sourceId,
    sourceName: value.sourceName,
    title: template ? template.title : value.title,
    prompt: template ? template.prompt : value.prompt,
    card: template ? template.card : value.card,
    tags,
    responseOptions: metadata.responseOptions,
  };
  if (attackers) event.attackers = attackers;
  if (threat) event.threat = threat;
  if (metadata.emptyOutcome !== undefined) event.emptyOutcome = metadata.emptyOutcome;
  return event;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return isRecord(value)
    && isNonemptyString(value.id)
    && typeof value.turn === "number"
    && Number.isSafeInteger(value.turn)
    && value.turn >= 1
    && typeof value.title === "string"
    && typeof value.detail === "string"
    && typeof value.tone === "string"
    && HISTORY_TONES.has(value.tone);
}

function readHistory(value: unknown): HistoryEntry[] | undefined {
  if (!Array.isArray(value) || !value.every(isHistoryEntry) || !hasUniqueStrings(value.map(({ id }) => id))) return undefined;
  return value.map(({ id, turn, title, detail, tone }) => ({ id, turn, title, detail, tone }));
}

function hasCompatibleStage(event: StoredEvent, stage: ResponseStage): boolean {
  if (event.kind === "attack") return stage === "prompt" || stage === "combat" || stage === "resolved";
  if (event.kind === "development") return stage === "prompt" || stage === "resolved";
  return stage !== "combat";
}

/**
 * Validates and clones persisted state, migrating supported legacy versions.
 * Invalid input returns null; arbitrary input is never allowed to throw through.
 */
export function decodeGameState(raw: unknown): GameState | null {
  try {
    if (!isRecord(raw) || typeof raw.version !== "number" || !Number.isSafeInteger(raw.version) || raw.version < 1 || raw.version > GAME_STATE_VERSION) return null;
    const version = raw.version;
    if (typeof raw.turn !== "number" || !Number.isSafeInteger(raw.turn) || raw.turn < 1
      || typeof raw.eventCounter !== "number" || !Number.isSafeInteger(raw.eventCounter) || raw.eventCounter < 1
      || !isCount(raw.defenseCounter)
      || typeof raw.seed !== "string"
      || !Array.isArray(raw.opponents)
      || raw.opponents.length === 0
      || raw.opponents.length > 3
      || typeof raw.userLife !== "number" || !Number.isSafeInteger(raw.userLife)
      || typeof raw.responseStage !== "string"
      || !RESPONSE_STAGES.has(raw.responseStage)
      || typeof raw.resolution !== "string"
      || (raw.gameOver !== null && !isNonemptyString(raw.gameOver))) return null;

    const opponents = raw.opponents.map((value) => readOpponent(value, version));
    if (!opponents.every((opponent): opponent is Opponent => opponent !== undefined)
      || new Set(opponents.map(({ id }) => id)).size !== opponents.length) return null;
    const opponentIds = new Set(opponents.map(({ id }) => id));
    let gameOver = raw.gameOver as string | null;
    if (opponents.every((opponent) => opponent.eliminated)) {
      if (version === GAME_STATE_VERSION && gameOver === null) return null;
      if (version < GAME_STATE_VERSION && gameOver === null) gameOver = "You eliminated every simulated opponent.";
    }

    const userCommanderDamage = readDamageLedger(raw.userCommanderDamage);
    const currentEvent = readEvent(raw.currentEvent, opponentIds, version);
    const recentTemplateIds = readStringArray(raw.recentTemplateIds, true);
    const history = readHistory(raw.history);
    if (!userCommanderDamage || !currentEvent || !recentTemplateIds || !history) return null;

    let activeThreat: Threat | null;
    if (raw.activeThreat === null) activeThreat = null;
    else {
      const legacyExpiredTerminal = version < GAME_STATE_VERSION && isNonemptyString(raw.gameOver);
      const parsedThreat = readThreat(raw.activeThreat, opponentIds, legacyExpiredTerminal);
      if (!parsedThreat) return null;
      activeThreat = parsedThreat.remaining === 0 ? null : parsedThreat;
    }
    if (version < GAME_STATE_VERSION && activeThreat && currentEvent.threat && activeThreat.id === currentEvent.threat.id) {
      activeThreat = {
        ...activeThreat,
        ownerId: currentEvent.threat.ownerId,
        title: currentEvent.threat.title,
        description: currentEvent.threat.description,
      };
    }
    if (version < GAME_STATE_VERSION && activeThreat && opponents.some((opponent) => opponent.id === activeThreat?.ownerId && opponent.eliminated)) {
      activeThreat = null;
    }

    const eventSource = opponents.find((opponent) => opponent.id === currentEvent.sourceId);
    let responseStage = raw.responseStage as ResponseStage;
    let resolution = raw.resolution;
    let counterExchange = version < 5
      ? responseStage === "counterback" ? 1 : 0
      : isCount(raw.counterExchange) ? raw.counterExchange : undefined;
    if (counterExchange === undefined) return null;
    if (version < GAME_STATE_VERSION && eventSource?.eliminated && responseStage !== "resolved") {
      responseStage = "resolved";
      resolution = `${eventSource.name} left the game, so their pending action was removed from the stack or combat during migration.`;
      counterExchange = 0;
    }
    let toxicDelugePayment: GameState["toxicDelugePayment"] = null;
    const missingToxicDelugePayment = raw.toxicDelugePayment === undefined;
    if (version === GAME_STATE_VERSION) {
      if (!missingToxicDelugePayment && raw.toxicDelugePayment !== null) {
        if (!isRecord(raw.toxicDelugePayment)
          || !isNonemptyString(raw.toxicDelugePayment.eventId)
          || !isCount(raw.toxicDelugePayment.amount)) return null;
        toxicDelugePayment = { eventId: raw.toxicDelugePayment.eventId, amount: raw.toxicDelugePayment.amount };
      }
    }
    if (currentEvent.templateId === "minus-wipe"
      && (responseStage === "choose" || responseStage === "counterback")
      && !toxicDelugePayment
      && (version < GAME_STATE_VERSION || missingToxicDelugePayment)) {
      responseStage = "prompt";
      resolution = "Re-enter Toxic Deluge’s life payment before opening the response window.";
      counterExchange = 0;
    }
    if ((toxicDelugePayment && (currentEvent.templateId !== "minus-wipe" || toxicDelugePayment.eventId !== currentEvent.id || responseStage === "prompt"))
      || (currentEvent.templateId === "minus-wipe" && (responseStage === "choose" || responseStage === "counterback") && !toxicDelugePayment)) return null;
    const threatOwner = activeThreat ? opponents.find((opponent) => opponent.id === activeThreat.ownerId) : undefined;
    const currentThreat = currentEvent.threat;
    if (!eventSource || currentEvent.sourceName !== eventSource.name
      || !hasCompatibleStage(currentEvent, responseStage)
      || (currentThreat && currentThreat.ownerId !== currentEvent.sourceId)
      || (activeThreat && (!threatOwner || threatOwner.eliminated))
      || (responseStage !== "resolved" && eventSource?.eliminated)
      || (responseStage === "counterback"
        && (!currentEvent.responseOptions.includes("counter") || counterExchange === 0))
      || (currentThreat && activeThreat
        && (responseStage !== "resolved"
          || currentThreat.id !== activeThreat.id
          || currentThreat.ownerId !== activeThreat.ownerId
          || currentThreat.title !== activeThreat.title
          || currentThreat.description !== activeThreat.description))) return null;

    const answeredCount = version < 3
      ? history.filter((entry) => ANSWERED_TITLES.has(entry.title)).length
      : isCount(raw.answeredCount) ? raw.answeredCount : undefined;
    if (answeredCount === undefined) return null;

    let combatResolvedTurn: number | null;
    if (version < 4) {
      combatResolvedTurn = history.some((entry) => entry.turn === raw.turn && COMBAT_TITLES.has(entry.title)) ? raw.turn : null;
    } else if (raw.combatResolvedTurn === null) {
      combatResolvedTurn = null;
    } else if (typeof raw.combatResolvedTurn === "number" && Number.isSafeInteger(raw.combatResolvedTurn) && raw.combatResolvedTurn >= 1 && raw.combatResolvedTurn <= raw.turn) {
      combatResolvedTurn = raw.combatResolvedTurn;
    } else {
      return null;
    }

    const userPoisonCounters = version < 5
      ? 0
      : isCount(raw.userPoisonCounters) ? raw.userPoisonCounters : undefined;
    const userLossProtected = version < GAME_STATE_VERSION
      ? false
      : typeof raw.userLossProtected === "boolean" ? raw.userLossProtected : undefined;
    if (userPoisonCounters === undefined || counterExchange === undefined || userLossProtected === undefined) return null;
    const userLoss = evaluateTrackedLoss({
      life: raw.userLife,
      poisonCounters: userPoisonCounters,
      commanderDamage: userCommanderDamage,
    }, userLossProtected);
    if (version === GAME_STATE_VERSION && gameOver === null && userLoss) return null;
    if (version < GAME_STATE_VERSION && gameOver === null && userLoss) {
      gameOver = userLoss.reason === "life"
        ? `You reached ${raw.userLife} life.`
        : userLoss.reason === "poison"
          ? `You reached ${userPoisonCounters} poison counters.`
          : "You reached 21 commander damage from one commander.";
    }

    const retiredCardAction = currentEvent.kind === "signature"
      || (currentEvent.kind === "development" && currentEvent.card !== "Table development");
    const normalizedEvent = retiredCardAction ? developmentEvent(currentEvent.id, eventSource) : currentEvent as SimEvent;
    if (retiredCardAction) {
      responseStage = responseStage === "resolved" ? "resolved" : "prompt";
      resolution = responseStage === "resolved" ? "This card-reveal action has been removed. Continue the simulation." : "";
      counterExchange = 0;
    }

    return {
      version: GAME_STATE_VERSION,
      turn: raw.turn,
      eventCounter: raw.eventCounter,
      defenseCounter: raw.defenseCounter,
      seed: raw.seed,
      opponents,
      userLife: raw.userLife,
      userLossProtected,
      userPoisonCounters,
      userCommanderDamage,
      currentEvent: normalizedEvent,
      responseStage,
      resolution,
      toxicDelugePayment,
      activeThreat,
      recentTemplateIds,
      history,
      answeredCount,
      combatResolvedTurn,
      counterExchange,
      gameOver,
    };
  } catch {
    return null;
  }
}
