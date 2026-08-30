import {
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

export const GAME_STATE_VERSION = 5 as const;

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
  userPoisonCounters: number;
  userCommanderDamage: Record<string, number>;
  currentEvent: SimEvent;
  responseStage: ResponseStage;
  resolution: string;
  activeThreat: Threat | null;
  recentTemplateIds: string[];
  history: HistoryEntry[];
  answeredCount: number;
  combatResolvedTurn: number | null;
  counterExchange: number;
  gameOver: string | null;
};

type UnknownRecord = Record<string, unknown>;

const PROFILES = new Set<string>(["midrange", "control", "swarm", "voltron", "combo", "graveyard"]);
const BRACKETS = new Set<unknown>([1, 2, 3, 4, 5]);
const EVENT_KINDS = new Set<string>(["targeted", "wipe", "counter", "disruption", "attack", "threat", "development"]);
const KEYWORDS = new Set<string>([
  "Flying",
  "Reach",
  "Trample",
  "Menace",
  "Vigilance",
  "Deathtouch",
  "First strike",
  "Double strike",
  "Haste",
  "Lifelink",
  "Infect",
]);
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
  return typeof value === "string" && value.trim().length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readStringArray(value: unknown, nonempty = false): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string" && (!nonempty || item.trim().length > 0)) ? value.map(String) : undefined;
}

function readDamageLedger(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([id, damage]) => !isNonemptyString(id) || !isCount(damage))) return undefined;
  return Object.fromEntries(entries) as Record<string, number>;
}

function readThreat(value: unknown, opponentIds: ReadonlySet<string>): Threat | undefined {
  if (!isRecord(value)
    || !isNonemptyString(value.id)
    || !isNonemptyString(value.ownerId)
    || !opponentIds.has(value.ownerId)
    || typeof value.title !== "string"
    || typeof value.description !== "string"
    || !isCount(value.remaining)
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

  const poisonCounters = version < GAME_STATE_VERSION
    ? 0
    : isCount(value.poisonCounters) ? value.poisonCounters : undefined;
  if (poisonCounters === undefined) return undefined;

  return {
    id: value.id,
    name: value.name,
    profile: value.profile as ProfileId,
    bracket: bracket as CommanderBracket,
    life: value.life,
    commanderDamage,
    poisonCounters,
    eliminated: value.eliminated,
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
  if (value.isCommander && version === GAME_STATE_VERSION && !commanderId) return undefined;

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
    attacker.commanderLabel = value.commanderLabel ?? `${sourceName}’s commander`;
  }
  return attacker;
}

function readEvent(value: unknown, opponentIds: ReadonlySet<string>, version: number): SimEvent | undefined {
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
  if (version === GAME_STATE_VERSION && !responseOptions) return undefined;
  const metadata = responseOptions
    ? { responseOptions, emptyOutcome: value.emptyOutcome as string | undefined }
    : responseMetadataForEvent(value.templateId, value.kind as EventKind);
  if (!metadata) return undefined;

  const event: SimEvent = {
    id: value.id,
    templateId: value.templateId,
    kind: value.kind as EventKind,
    sourceId: value.sourceId,
    sourceName: value.sourceName,
    title: value.title,
    prompt: value.prompt,
    card: value.card,
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
  return Array.isArray(value) && value.every(isHistoryEntry)
    ? value.map(({ id, turn, title, detail, tone }) => ({ id, turn, title, detail, tone }))
    : undefined;
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
      || typeof raw.userLife !== "number" || !Number.isSafeInteger(raw.userLife)
      || typeof raw.responseStage !== "string"
      || !RESPONSE_STAGES.has(raw.responseStage)
      || typeof raw.resolution !== "string"
      || (raw.gameOver !== null && typeof raw.gameOver !== "string")) return null;

    const opponents = raw.opponents.map((value) => readOpponent(value, version));
    if (!opponents.every((opponent): opponent is Opponent => opponent !== undefined)
      || new Set(opponents.map(({ id }) => id)).size !== opponents.length) return null;
    const opponentIds = new Set(opponents.map(({ id }) => id));

    const userCommanderDamage = readDamageLedger(raw.userCommanderDamage);
    const currentEvent = readEvent(raw.currentEvent, opponentIds, version);
    const recentTemplateIds = readStringArray(raw.recentTemplateIds, true);
    const history = readHistory(raw.history);
    if (!userCommanderDamage || !currentEvent || !recentTemplateIds || !history) return null;

    let activeThreat: Threat | null;
    if (raw.activeThreat === null) activeThreat = null;
    else {
      const parsedThreat = readThreat(raw.activeThreat, opponentIds);
      if (!parsedThreat) return null;
      activeThreat = parsedThreat;
    }

    const eventSource = opponents.find((opponent) => opponent.id === currentEvent.sourceId);
    const threatOwner = activeThreat ? opponents.find((opponent) => opponent.id === activeThreat.ownerId) : undefined;
    if ((activeThreat && threatOwner?.eliminated)
      || (raw.responseStage !== "resolved" && eventSource?.eliminated)
      || (raw.responseStage === "counterback" && !currentEvent.responseOptions.includes("counter"))) return null;

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

    const userPoisonCounters = version < GAME_STATE_VERSION
      ? 0
      : isCount(raw.userPoisonCounters) ? raw.userPoisonCounters : undefined;
    const counterExchange = version < GAME_STATE_VERSION
      ? 0
      : isCount(raw.counterExchange) ? raw.counterExchange : undefined;
    if (userPoisonCounters === undefined || counterExchange === undefined) return null;

    return {
      version: GAME_STATE_VERSION,
      turn: raw.turn,
      eventCounter: raw.eventCounter,
      defenseCounter: raw.defenseCounter,
      seed: raw.seed,
      opponents,
      userLife: raw.userLife,
      userPoisonCounters,
      userCommanderDamage,
      currentEvent,
      responseStage: raw.responseStage as ResponseStage,
      resolution: raw.resolution,
      activeThreat,
      recentTemplateIds,
      history,
      answeredCount,
      combatResolvedTurn,
      counterExchange,
      gameOver: raw.gameOver,
    };
  } catch {
    return null;
  }
}
