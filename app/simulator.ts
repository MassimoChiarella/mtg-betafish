/**
 * Seeded Commander-table heuristics. Random outcomes must remain reproducible
 * for the same seed, turn, and action counter so saved sessions can be replayed.
 */

export type ProfileId = "midrange" | "control" | "swarm" | "voltron" | "combo" | "graveyard";
export type EventKind = "targeted" | "wipe" | "counter" | "disruption" | "attack" | "threat" | "development";
export type Keyword = "Flying" | "Reach" | "Trample" | "Menace" | "Vigilance" | "Deathtouch" | "First strike" | "Double strike" | "Haste" | "Lifelink" | "Infect";
export type CommanderSlot = "primary" | "partner";
export type CommanderBracket = 1 | 2 | 3 | 4 | 5;
export type ResponseOption = "counter" | "protect" | "redirect" | "custom";

export const opponentCommanderKey = (opponentId: string, slot: CommanderSlot = "primary") => slot === "primary"
  ? `opponent:${opponentId}:commander`
  : `opponent:${opponentId}:partner:commander`;

export const userCommanderKey = (slot: CommanderSlot) => `user:${slot}:commander`;

export type Opponent = {
  id: string;
  name: string;
  profile: ProfileId;
  bracket: CommanderBracket;
  life: number;
  poisonCounters: number;
  commanderDamage: Record<string, number>;
  eliminated: boolean;
};

export type Attacker = {
  id: string;
  name: string;
  power: number;
  toughness: number;
  keywords: Keyword[];
  isCommander: boolean;
  commanderId?: string;
  commanderLabel?: string;
};

export type Threat = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  remaining: number;
  delayed: boolean;
};

export type SimEvent = {
  id: string;
  templateId: string;
  kind: EventKind;
  sourceId: string;
  sourceName: string;
  title: string;
  prompt: string;
  card: string;
  tags: string[];
  responseOptions: ResponseOption[];
  emptyOutcome?: string;
  /** Complete declaration for one combat. Normal combat is never split across events. */
  attackers?: Attacker[];
  threat?: Threat;
};

export type DefenseResult = {
  type: "none" | "block" | "removal" | "fog";
  title: string;
  detail: string;
};

type EventTemplate = {
  id: string;
  kind: Exclude<EventKind, "attack" | "development">;
  minTurn: number;
  title: string;
  prompt: string;
  card: string;
  tags: string[];
  responseOptions: ResponseOption[];
  emptyOutcome: string;
  /** Withheld from Brackets 1–2. */
  gameChanger?: boolean;
};

export const KEYWORD_DEFINITIONS: Record<Keyword, string> = {
  Flying: "Can be blocked only by creatures with flying or reach.",
  Reach: "Can block a creature with flying.",
  Trample: "May assign excess combat damage to the defending player after lethal damage is assigned to blockers.",
  Menace: "Can’t be blocked except by two or more creatures.",
  Vigilance: "Attacking doesn’t cause this creature to tap.",
  Deathtouch: "Any nonzero amount of damage it deals to a creature is lethal.",
  "First strike": "Deals combat damage before creatures without first strike or double strike.",
  "Double strike": "Deals combat damage in both the first-strike and regular combat-damage steps.",
  Haste: "Can attack and use tap abilities immediately after coming under its controller’s control.",
  Lifelink: "Its controller gains that much life when it deals damage.",
  Infect: "Damage to creatures is dealt as −1/−1 counters, and damage to players is dealt as poison counters instead of causing life loss.",
};

export const GLOSSARY_DEFINITIONS = {
  ...KEYWORD_DEFINITIONS,
  Priority: "The permission to cast spells, activate abilities, and take certain special actions. Players receive it one at a time.",
  Counter: "Stop a spell or ability on the stack so it does not resolve. A countered spell normally goes to its owner’s graveyard.",
  Destroy: "Move a permanent from the battlefield to its owner’s graveyard. Indestructible and regeneration can prevent this.",
  Exile: "Move a card or permanent to the exile zone. Exiling is different from destroying.",
  "Board wipe": "An informal term for a spell or ability that removes many or all permanents of a kind from the battlefield.",
  Stack: "The game zone where spells and most abilities wait to resolve, newest first.",
  "Stack interaction": "Spells or abilities used while other spells or abilities are waiting on the stack, such as counters or redirection.",
  "Legal target": "An object or player that satisfies every targeting restriction of the spell or ability.",
  Hexproof: "A permanent or player with hexproof can’t be targeted by spells or abilities an opponent controls.",
  Indestructible: "Can’t be destroyed by damage or effects that say “destroy.” A creature can still be exiled, sacrificed, or put into a graveyard for having 0 or less toughness.",
  "Phase out": "Treat the permanent and anything attached to it as though they don’t exist until it phases in, usually during its controller’s next untap step.",
  Sacrifice: "Its controller moves it from the battlefield to the graveyard. This is not destruction.",
  Blink: "An informal term for exiling a permanent and then returning it to the battlefield, usually immediately.",
  Bounce: "An informal term for returning a permanent to its owner’s hand.",
  Fog: "An informal term for an effect that prevents combat damage, named after the card Fog.",
  Goad: "Until your next turn, the creature attacks each combat if able and attacks a player other than you if able.",
  "Commander damage": "A player who has been dealt 21 or more combat damage by the same commander over the game loses.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY_DEFINITIONS;

export const COMMANDER_BRACKETS: Record<CommanderBracket, {
  label: string;
  summary: string;
  turnGuide: string;
  turnOffset: number;
  pace: number;
  interaction: number;
  earliestThreatTurn: number;
  threatClock: number;
}> = {
  1: { label: "Exhibition", summary: "Theme-first decks with low-pressure, showcase-focused play.", turnGuide: "Games are generally expected to last 9 or more turns.", turnOffset: -2, pace: .68, interaction: .55, earliestThreatTurn: 7, threatClock: 3 },
  2: { label: "Core", summary: "Straightforward, unoptimized decks with incremental, disruptable wins.", turnGuide: "Games are generally expected to last 8 or more turns.", turnOffset: -1, pace: .84, interaction: .76, earliestThreatTurn: 6, threatClock: 3 },
  3: { label: "Upgraded", summary: "Strong synergy and card quality with frequent proactive and reactive plays.", turnGuide: "Games are generally expected to last 6 or more turns.", turnOffset: 0, pace: 1, interaction: 1, earliestThreatTurn: 5, threatClock: 2 },
  4: { label: "Optimized", summary: "Fast, consistent, explosive decks backed by efficient disruption.", turnGuide: "Games are generally expected to last 4 or more turns.", turnOffset: 2, pace: 1.2, interaction: 1.28, earliestThreatTurn: 3, threatClock: 2 },
  5: { label: "cEDH", summary: "Metagame-tuned competitive decks with efficient wins and razor-thin margins.", turnGuide: "Games can end on any turn.", turnOffset: 4, pace: 1.38, interaction: 1.52, earliestThreatTurn: 1, threatClock: 1 },
};

export function normalizeCommanderBracket(value: unknown): CommanderBracket {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : 3;
}

export const DECK_PROFILES: Record<ProfileId, {
  label: string;
  description: string;
  coreCards: Record<CommanderBracket, readonly string[]>;
  preferredTemplates: readonly string[];
  combat: number;
  counterBack: number;
  /** Relative event-selection weights. */
  events: Record<Exclude<EventKind, "attack" | "development">, number>;
  /** Base defense weights ordered as none, block, removal, and fog. */
  defense: [number, number, number, number];
}> = {
  midrange: {
    label: "Generic midrange",
    description: "Flexible value creatures, broad removal, and resilient combat pressure.",
    coreCards: {
      1: ["Scavenging Ooze", "Acidic Slime", "Biogenic Ooze"],
      2: ["Beast Within", "Eternal Witness", "Sun Titan"],
      3: ["Seedborn Muse", "Aura Shards", "Toski, Bearer of Secrets"],
      4: ["Ancient Tomb", "The One Ring", "Dauthi Voidwalker"],
      5: ["Tymna the Weaver", "Kraum, Ludevic’s Opus", "Orcish Bowmasters"],
    },
    preferredTemplates: ["destroy-creature", "destroy-wipe", "goad"],
    combat: 1, counterBack: .12, events: { targeted: 32, wipe: 18, counter: 10, disruption: 25, threat: 15 }, defense: [30, 42, 20, 8],
  },
  control: {
    label: "Control",
    description: "Permission, efficient removal, and sweepers that punish overextension.",
    coreCards: {
      1: ["Dismiss", "Rewind", "Aetherize"],
      2: ["Arcane Denial", "Generous Gift", "Austere Command"],
      3: ["Counterspell", "Swords to Plowshares", "Farewell"],
      4: ["Fierce Guardianship", "Cyclonic Rift", "The One Ring"],
      5: ["Niv-Mizzet, Parun", "Curiosity", "Force of Will"],
    },
    preferredTemplates: ["exile-commander", "counter-key-spell", "destroy-wipe"],
    combat: .65, counterBack: .35, events: { targeted: 30, wipe: 24, counter: 28, disruption: 10, threat: 8 }, defense: [18, 22, 35, 25],
  },
  swarm: {
    label: "Creature swarm",
    description: "Wide boards, go-wide combat, and an overrun-style closing turn.",
    coreCards: {
      1: ["Chatterstorm", "Squirrel Nest", "Deranged Hermit"],
      2: ["Secure the Wastes", "Beastmaster Ascension", "Camaraderie"],
      3: ["Adeline, Resplendent Cathar", "Skullclamp", "Biorhythm"],
      4: ["Gaea’s Cradle", "Natural Order", "Craterhoof Behemoth"],
      5: ["Najeela, the Blade-Blossom", "Derevi, Empyrial Tactician", "Nature’s Will"],
    },
    preferredTemplates: ["early-rock", "artifact-sweep", "combat-clock"],
    combat: 1.3, counterBack: .05, events: { targeted: 30, wipe: 8, counter: 2, disruption: 45, threat: 15 }, defense: [35, 50, 10, 5],
  },
  voltron: {
    label: "Voltron",
    description: "One oversized attacker protected by lean interaction and tempo plays.",
    coreCards: {
      1: ["Hero’s Blade", "Blackblade Reforged", "Forebear’s Blade"],
      2: ["Sword of the Animist", "All That Glitters", "Tamiyo’s Safekeeping"],
      3: ["Puresteel Paladin", "Sword of Feast and Famine", "Flawless Maneuver"],
      4: ["Sigarda’s Aid", "Colossus Hammer", "Enlightened Tutor"],
      5: ["Godo, Bandit Warlord", "Helm of the Host", "Mana Vault"],
    },
    preferredTemplates: ["exile-commander", "remove-engine", "goad"],
    combat: 1.1, counterBack: .1, events: { targeted: 38, wipe: 8, counter: 7, disruption: 27, threat: 20 }, defense: [42, 25, 23, 10],
  },
  combo: {
    label: "Combo",
    description: "A compact win package protected by stack interaction and bounce.",
    coreCards: {
      1: ["Efficient Construction", "Thopter Spy Network", "Mechanized Production"],
      2: ["Primal Amulet", "Storm-Kiln Artist", "Crackle with Power"],
      3: ["Bolas’s Citadel", "Sensei’s Divining Top", "Aetherflux Reservoir"],
      4: ["Food Chain", "Misthollow Griffin", "Walking Ballista"],
      5: ["Thassa’s Oracle", "Demonic Consultation", "Pact of Negation"],
    },
    preferredTemplates: ["counter-key-spell", "artifact-clock", "remove-engine"],
    combat: .55, counterBack: .25, events: { targeted: 18, wipe: 10, counter: 25, disruption: 14, threat: 33 }, defense: [35, 18, 27, 20],
  },
  graveyard: {
    label: "Graveyard value",
    description: "Recursive threats, death triggers, and mass reanimation pressure.",
    coreCards: {
      1: ["Undead Butler", "Gravedigger", "Zombie Apocalypse"],
      2: ["Satyr Wayfinder", "Victimize", "Kessig Cagebreakers"],
      3: ["Life from the Loam", "Mesmeric Orb", "Living Death"],
      4: ["Entomb", "Reanimate", "Vilis, Broker of Blood"],
      5: ["Underworld Breach", "Lion’s Eye Diamond", "Brain Freeze"],
    },
    preferredTemplates: ["living-death", "graveyard-hate", "destroy-creature"],
    combat: .95, counterBack: .08, events: { targeted: 24, wipe: 13, counter: 5, disruption: 36, threat: 22 }, defense: [28, 45, 22, 5],
  },
};

export type CombatDamageStep = {
  step: "first" | "regular";
  lifeDamage: number;
  commanderHits: Record<string, number>;
  poisonCounters: number;
  lifelinkGain: number;
};

export type CombatState = {
  life: number;
  poisonCounters: number;
  commanderDamage: Record<string, number>;
};

export type CombatResolution = CombatState & {
  defeated: boolean;
  lossReason: "life" | "poison" | "commander" | null;
  lethalCommander: string | null;
  stepsApplied: Array<CombatDamageStep["step"]>;
  lifeDamage: number;
  poisonAdded: number;
  lifelinkGain: number;
};

/** Current Game Changers used by the bracket-specific core packages. */
export const GAME_CHANGER_CARDS: ReadonlySet<string> = new Set([
  "Ancient Tomb", "Aura Shards", "Biorhythm", "Bolas’s Citadel", "Cyclonic Rift", "Enlightened Tutor",
  "Farewell", "Fierce Guardianship", "Force of Will", "Gaea’s Cradle", "Lion’s Eye Diamond", "Mana Vault",
  "Natural Order", "Orcish Bowmasters", "Seedborn Muse", "The One Ring", "Thassa’s Oracle", "Underworld Breach",
]);

export const PROFILE_LABELS = Object.fromEntries(Object.entries(DECK_PROFILES).map(([id, profile]) => [id, profile.label])) as Record<ProfileId, string>;

export const CARD_LIBRARY_UPDATED = "August 22, 2026";

export const CARD_LIBRARY = [
  { archetype: "Spot removal", cards: ["Swords to Plowshares", "Path to Exile", "Beast Within", "Anguished Unmaking"] },
  { archetype: "Board control", cards: ["Toxic Deluge", "Farewell", "Cyclonic Rift", "Vandalblast"] },
  { archetype: "Stack interaction", cards: ["Counterspell", "Swan Song", "Fierce Guardianship", "Deflecting Swat"] },
  { archetype: "Protection", cards: ["Heroic Intervention", "Teferi’s Protection", "Flawless Maneuver", "Tamiyo’s Safekeeping"] },
  { archetype: "Combo pressure", cards: ["Thassa’s Oracle", "Demonic Consultation", "Aetherflux Reservoir", "Craterhoof Behemoth"] },
  { archetype: "Graveyard pressure", cards: ["Bojuka Bog", "Rest in Peace", "Living Death", "Reanimate"] },
] as const;

export const EVENT_TEMPLATES: EventTemplate[] = [
  { id: "early-rock", kind: "targeted", minTurn: 1, title: "Your early mana is checked.", prompt: "Destroy an artifact or enchantment you control, prioritizing your most useful mana source. Its controller gains 4 life. If there is no legal artifact or enchantment target, the spell cannot be cast.", card: "Nature’s Claim", tags: ["Destroy", "Mana"], responseOptions: ["counter", "protect", "redirect", "custom"], emptyOutcome: "The spell could not be cast because there was no legal artifact or enchantment target." },
  { id: "destroy-creature", kind: "targeted", minTurn: 2, title: "Your best creature is targeted.", prompt: "Destroy your highest-power noncommander creature. Its controller creates a 3/3 green Beast creature token. Counter it, resolve a legal protection effect, or let it resolve.", card: "Beast Within", tags: ["Destroy", "Creature"], responseOptions: ["counter", "protect", "redirect", "custom"], emptyOutcome: "The spell could not be cast because there was no legal permanent target." },
  { id: "exile-commander", kind: "targeted", minTurn: 3, title: "Exile your commander.", prompt: "Your commander is targeted for exile. Its controller gains life equal to its power. If it leaves, make the normal command-zone choice in your playtester.", card: "Swords to Plowshares", tags: ["Exile", "Commander"], responseOptions: ["counter", "protect", "redirect", "custom"], emptyOutcome: "The spell could not be cast because there was no legal creature target." },
  { id: "remove-engine", kind: "targeted", minTurn: 3, title: "Your engine is exposed.", prompt: "Exile your most important nonland permanent, then the acting opponent loses 3 life. Can you counter it or resolve another legal answer?", card: "Anguished Unmaking", tags: ["Exile", "Permanent"], responseOptions: ["counter", "protect", "redirect", "custom"], emptyOutcome: "The spell could not be cast because there was no legal nonland permanent target." },
  { id: "destroy-wipe", kind: "wipe", minTurn: 5, title: "Destroy all creatures.", prompt: "Destroy all creatures. They can’t be regenerated. Resolve counters, indestructible, or another legal protection effect in your playtester.", card: "Wrath of God", tags: ["Board wipe", "Destroy"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "No creature you control was affected when the table action resolved." },
  { id: "minus-wipe", kind: "wipe", minTurn: 5, title: "The board gets −X/−X.", prompt: "The acting opponent pays X life as an additional cost. Give each creature −X/−X until end of turn, where X is the greatest toughness among creatures you control. Indestructible does not stop this.", card: "Toxic Deluge", tags: ["Board wipe", "Toughness"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "No creature you control was affected when the table action resolved." },
  { id: "living-death", kind: "wipe", minTurn: 5, title: "The battlefield and graveyards trade places.", prompt: "Exile creature cards from graveyards, sacrifice creatures, then return the exiled cards. Resolve the exact Living Death sequence in your playtester.", card: "Living Death", tags: ["Board wipe", "Graveyard"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "No creature card or creature you control changed zones during resolution." },
  { id: "mass-bounce", kind: "wipe", minTurn: 6, title: "Return your nonlands to hand.", prompt: "Return each nonland permanent you control to its owner’s hand unless you can stop the overloaded spell.", card: "Cyclonic Rift", tags: ["Board wipe", "Bounce"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "You controlled no nonland permanent affected by the overloaded spell.", gameChanger: true },
  { id: "exile-wipe", kind: "wipe", minTurn: 7, title: "Exile the battlefield.", prompt: "The chosen modes exile creatures, artifacts, and enchantments you control. Indestructible does not prevent exile.", card: "Farewell", tags: ["Board wipe", "Exile"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "You controlled no permanent affected by the chosen modes.", gameChanger: true },
  { id: "counter-key-spell", kind: "counter", minTurn: 2, title: "Your next key spell is countered.", prompt: "When you cast your next mana-value-4-or-greater spell this turn, the table tries to counter it.", card: "Counterspell", tags: ["Counter", "Stack"], responseOptions: ["counter", "redirect", "custom"], emptyOutcome: "No qualifying spell was cast this turn, so no counterspell was put on the stack." },
  { id: "counter-commander", kind: "counter", minTurn: 3, title: "Your commander meets permission.", prompt: "The next time you cast your commander this turn, the table tries to counter it. At the next turn’s upkeep, you may draw up to two cards and the acting opponent draws one card.", card: "Arcane Denial", tags: ["Counter", "Commander"], responseOptions: ["counter", "redirect", "custom"], emptyOutcome: "No commander spell was cast this turn, so no counterspell was put on the stack." },
  { id: "random-discard", kind: "disruption", minTurn: 2, title: "Discard at random.", prompt: "Randomize the nonland cards in your hand and discard one of them.", card: "Wheel pressure", tags: ["Discard", "Hand"], responseOptions: ["counter", "custom"], emptyOutcome: "You had no nonland card to discard." },
  { id: "graveyard-hate", kind: "disruption", minTurn: 3, title: "Exile your graveyard.", prompt: "Exile your graveyard before your next graveyard effect resolves. Can you save or use anything first?", card: "Bojuka Bog", tags: ["Exile", "Graveyard"], responseOptions: ["counter", "protect", "redirect", "custom"], emptyOutcome: "Your graveyard was empty when the ability resolved." },
  { id: "artifact-sweep", kind: "disruption", minTurn: 5, title: "Destroy your artifacts.", prompt: "The overloaded spell destroys each artifact the acting opponent doesn’t control, including yours. Mana rocks, Equipment, Treasures, and artifact creatures are caught; normal protection from destruction still applies.", card: "Vandalblast", tags: ["Destroy", "Artifacts"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "You controlled no artifact affected by the overloaded spell." },
  { id: "goad", kind: "disruption", minTurn: 4, title: "Your creatures are goaded.", prompt: "Until the acting opponent’s next turn, each creature they don’t control is goaded: it attacks each combat if able and attacks a player other than that opponent if able.", card: "Disrupt Decorum", tags: ["Goad", "Combat"], responseOptions: ["counter", "protect", "custom"], emptyOutcome: "You controlled no creature the table action could goad." },
  { id: "combo-clock", kind: "threat", minTurn: 1, title: "A two-card win is assembling.", prompt: "A compact combo is telegraphed. Remove a piece, stop the tutor, or prepare stack interaction before the clock expires.", card: "Thassa’s Oracle line", tags: ["Game-ending", "Combo"], responseOptions: ["custom"], emptyOutcome: "The telegraphed line is no longer a live threat.", gameChanger: true },
  { id: "artifact-clock", kind: "threat", minTurn: 1, title: "A lethal artifact is charging.", prompt: "An artifact engine will produce a game-ending activation when its countdown reaches zero.", card: "Aetherflux Reservoir", tags: ["Game-ending", "Artifact"], responseOptions: ["custom"], emptyOutcome: "The artifact engine is no longer a live threat." },
  { id: "combat-clock", kind: "threat", minTurn: 1, title: "A lethal combat turn is coming.", prompt: "The creature deck is building a lethal overrun. Remove the enabler or hold up a fog before the countdown expires.", card: "Craterhoof Behemoth", tags: ["Game-ending", "Combat"], responseOptions: ["custom"], emptyOutcome: "The combat setup is no longer a live threat." },
];

/** Supplies deterministic response metadata when migrating pre-v5 events. */
export function responseMetadataForEvent(templateId: string, kind: EventKind): Pick<SimEvent, "responseOptions" | "emptyOutcome"> | null {
  if (kind === "attack" || kind === "development") return { responseOptions: [] };
  const template = EVENT_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (template) return { responseOptions: [...template.responseOptions], emptyOutcome: template.emptyOutcome };
  return null;
}

// FNV-1a and Mulberry32 provide deterministic, non-cryptographic replay randomness.
// Keep both algorithms stable: existing session seeds depend on their exact output.
function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rngFor(value: string) {
  let state = hashSeed(value);
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const intBetween = (random: () => number, minimum: number, maximum: number) => Math.floor(random() * (maximum - minimum + 1)) + minimum;

/** Returns an exact tracked amount or `null` when the value is outside the app's numeric contract. */
export function nonnegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const safeAmount = (value: unknown) => nonnegativeSafeInteger(value) ?? 0;

const addAmounts = (left: number, right: number) => left > Number.MAX_SAFE_INTEGER - right ? Number.MAX_SAFE_INTEGER : left + right;

const subtractLife = (life: number, damage: number) => life < Number.MIN_SAFE_INTEGER + damage ? Number.MIN_SAFE_INTEGER : life - damage;

function safeLife(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function safeDamageMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, number>;
  return Object.fromEntries(Object.entries(value).filter(([source]) => source.length > 0).map(([source, damage]) => [source, safeAmount(damage)]));
}

function weightedPick<T extends string>(random: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  let roll = random() * total;
  for (const [choice, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll <= 0) return choice;
  }
  return entries.at(-1)![0];
}

function chooseKeyword(random: () => number, excluded: Keyword[] = []): Keyword {
  const weights: Record<Keyword, number> = {
    Flying: 24, Trample: 20, Menace: 12, Vigilance: 10, Deathtouch: 9,
    "First strike": 9, Haste: 8, Lifelink: 5, "Double strike": 3, Reach: 1, Infect: 0,
  };
  excluded.forEach((keyword) => { weights[keyword] = 0; });
  return weightedPick(random, weights);
}

function attackBand(turn: number) {
  if (turn <= 2) return { chance: .18, count: [1, 1], power: [1, 3], keyword: .15 };
  if (turn <= 4) return { chance: .38, count: [1, 2], power: [3, 8], keyword: .3 };
  if (turn <= 6) return { chance: .6, count: [2, 4], power: [7, 15], keyword: .45 };
  if (turn <= 9) return { chance: .78, count: [3, 6], power: [13, 26], keyword: .6 };
  return { chance: .9, count: [4, 8], power: [22, Math.min(60, 40 + (turn - 10) * 3)], keyword: .7 };
}

/** Returns app-tuned relative weights, not probabilities; weighted selection normalizes them. */
export function eventKindWeights(input: { turn: number; profile: ProfileId; bracket: CommanderBracket; activeThreat: boolean; combatResolvedTurn?: number | null }): Record<EventKind, number> {
  const bracket = normalizeCommanderBracket(input.bracket);
  const bracketRules = COMMANDER_BRACKETS[bracket];
  const profile = DECK_PROFILES[input.profile];
  const effectiveTurn = Math.max(1, input.turn + bracketRules.turnOffset);
  const eligibleKinds = new Set(EVENT_TEMPLATES.filter((template) => template.minTurn <= effectiveTurn && (bracket >= 3 || !template.gameChanger)).map((template) => template.kind));
  // Exponents and the attack factor are tuning constants, not official Magic rules.
  const interactionScale = bracketRules.interaction ** 4;
  return {
    targeted: eligibleKinds.has("targeted") ? profile.events.targeted * interactionScale : 0,
    wipe: eligibleKinds.has("wipe") ? profile.events.wipe * interactionScale : 0,
    counter: eligibleKinds.has("counter") ? profile.events.counter * interactionScale : 0,
    disruption: eligibleKinds.has("disruption") ? profile.events.disruption * bracketRules.pace : 0,
    attack: input.combatResolvedTurn === input.turn ? 0 : attackBand(effectiveTurn).chance * profile.combat * (bracketRules.pace ** 3) * 35,
    threat: !input.activeThreat && input.turn >= bracketRules.earliestThreatTurn && eligibleKinds.has("threat") ? profile.events.threat * bracketRules.pace : 0,
    development: ({ 1: 70, 2: 55, 3: 40, 4: 25, 5: 10 } as Record<CommanderBracket, number>)[bracket],
  };
}

function generateCombatDeclaration(random: () => number, turn: number, source: Opponent, pace: number, eventId: string): Attacker[] {
  const band = attackBand(turn);
  const profile = DECK_PROFILES[source.profile];
  const count = intBetween(random, band.count[0], band.count[1]);
  const rawTotal = intBetween(random, band.power[0], band.power[1]);
  const totalPower = Math.max(count, Math.round(rawTotal * profile.combat * pace));
  const weights = Array.from({ length: count }, () => .55 + random());
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const powers = weights.map((weight) => Math.max(1, Math.floor(totalPower * weight / weightTotal)));
  let remainder = totalPower - powers.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % powers.length) {
    powers[index] += 1;
    remainder -= 1;
  }

  const commanderChance = source.profile === "voltron" ? .8 : turn <= 2 ? 0 : turn <= 4 ? .3 : .5;
  const commanderIndex = random() < commanderChance ? intBetween(random, 0, count - 1) : -1;
  const names: Record<ProfileId, string[]> = {
    midrange: ["Value creature", "Siege beast", "Utility attacker"],
    control: ["Flash threat", "Flying finisher", "Animated land"],
    swarm: ["Token squad", "Pack leader", "Growing army"],
    voltron: ["Backup attacker", "Equipped threat", "Aura-bearer"],
    combo: ["Utility creature", "Combo enabler", "Construct token"],
    graveyard: ["Reanimated threat", "Sacrifice fodder", "Graveborn attacker"],
  };

  return powers.map((power, index) => {
    const keywords: Keyword[] = [];
    if (random() < band.keyword) keywords.push(chooseKeyword(random));
    if (turn >= 7 && random() < band.keyword * .34) keywords.push(chooseKeyword(random, keywords));
    const isCommander = index === commanderIndex;
    return {
      id: `${eventId}-attacker-${index}`,
      name: isCommander ? `${source.name}’s commander` : names[source.profile][index % names[source.profile].length],
      power,
      toughness: Math.max(1, power + intBetween(random, -1, 1)),
      keywords,
      isCommander,
      commanderId: isCommander ? opponentCommanderKey(source.id) : undefined,
      commanderLabel: isCommander ? `${source.name}’s commander` : undefined,
    };
  });
}

/**
 * Generates the same event for identical inputs and avoids recent templates
 * when an eligible alternative exists.
 * @throws When every opponent has been eliminated.
 */
export function generateEvent(input: {
  turn: number;
  counter: number;
  seed: string;
  opponents: Opponent[];
  recentTemplateIds: string[];
  activeThreat: boolean;
  combatResolvedTurn?: number | null;
}): SimEvent {
  const { turn, counter, seed, recentTemplateIds, activeThreat, combatResolvedTurn } = input;
  const livingOpponents = input.opponents.filter((opponent) => !opponent.eliminated);
  if (!livingOpponents.length) throw new Error("Cannot generate an event without a living opponent.");
  const random = rngFor(`${seed}:${turn}:${counter}`);
  const source = livingOpponents[intBetween(random, 0, livingOpponents.length - 1)];
  const profile = DECK_PROFILES[source.profile];
  const bracket = normalizeCommanderBracket(source.bracket);
  const bracketRules = COMMANDER_BRACKETS[bracket];
  const coreCards = profile.coreCards[bracket];
  const effectiveTurn = Math.max(1, turn + bracketRules.turnOffset);
  const eventId = `event-${turn}-${counter}`;

  const isEligible = (template: EventTemplate) => template.minTurn <= effectiveTurn && (bracket >= 3 || !template.gameChanger);
  const eventWeights = eventKindWeights({ turn, profile: source.profile, bracket, activeThreat, combatResolvedTurn });
  const kind = weightedPick(random, eventWeights);

  if (kind === "attack") {
    const attackers = generateCombatDeclaration(random, effectiveTurn, source, bracketRules.pace, eventId);
    return {
      id: eventId,
      templateId: "scaled-attack",
      kind: "attack",
      sourceId: source.id,
      sourceName: source.name,
      title: `${source.name} declares ${attackers.length === 1 ? "one attacker" : `all ${attackers.length} attackers`} at you.`,
      prompt: "These are all attackers declared at you for this combat. Resolve blocks and interaction once, then record each combat-damage step. Ordinary generation produces at most one combat each turn; record externally created extra combats separately.",
      card: `${PROFILE_LABELS[source.profile]} combat`,
      tags: ["Combat", "One generated combat this turn", `B${bracket} ${bracketRules.label}`, `Turn ${turn} scaling`],
      responseOptions: [],
      attackers,
    };
  }

  if (kind === "development") {
    const coreCard = coreCards[intBetween(random, 0, coreCards.length - 1)];
    return {
      id: eventId,
      templateId: "table-development",
      kind,
      sourceId: source.id,
      sourceName: source.name,
      title: `${source.name} reveals a signature card.`,
      prompt: "This is a matchup-defining inclusion for this profile and bracket. It is not being cast by this event; use the breathing room to advance your own plan.",
      card: coreCard,
      tags: ["Deck intel", "Core card", `B${bracket} ${bracketRules.label}`],
      responseOptions: [],
    };
  }

  let candidates = EVENT_TEMPLATES.filter((template) => template.kind === kind && isEligible(template) && !recentTemplateIds.includes(template.id));
  if (!candidates.length) candidates = EVENT_TEMPLATES.filter((template) => template.kind === kind && isEligible(template));
  const preferredCandidates = candidates.filter((template) => profile.preferredTemplates.includes(template.id));
  if (preferredCandidates.length) candidates = preferredCandidates;
  const template = candidates[intBetween(random, 0, candidates.length - 1)];

  return {
    id: eventId,
    templateId: template.id,
    kind: template.kind,
    sourceId: source.id,
    sourceName: source.name,
    title: template.title,
    prompt: template.prompt,
    card: template.card,
    tags: [...template.tags, `B${bracket} ${bracketRules.label}`],
    responseOptions: [...template.responseOptions],
    emptyOutcome: template.emptyOutcome,
    threat: template.kind === "threat" ? {
      id: `threat-${turn}-${counter}`,
      ownerId: source.id,
      title: template.title,
      description: template.prompt,
      remaining: bracketRules.threatClock,
      delayed: false,
    } : undefined,
  };
}

/** Rolls a deterministic response to the user's counterspell. */
export function counterBacks(input: {
  profile: ProfileId;
  bracket: CommanderBracket;
  seed: string;
  turn: number;
  eventCounter: number;
  exchange: number;
}) {
  const interaction = COMMANDER_BRACKETS[normalizeCommanderBracket(input.bracket)].interaction;
  return rngFor(`${input.seed}:counter:${input.turn}:${input.eventCounter}:${input.exchange}`)() < Math.min(.8, DECK_PROFILES[input.profile].counterBack * interaction);
}

/** Rolls one deterministic defense while leaving exact combat resolution to the playtester. */
export function rollDefense(input: {
  profile: ProfileId;
  bracket: CommanderBracket;
  seed: string;
  turn: number;
  counter: number;
  attackers: { name: string; power: number; keywords: Keyword[] }[];
}): DefenseResult {
  const random = rngFor(`${input.seed}:defense:${input.turn}:${input.counter}:${input.profile}`);
  const bracketRules = COMMANDER_BRACKETS[normalizeCommanderBracket(input.bracket)];
  const [none, block, removal, fog] = DECK_PROFILES[input.profile].defense;
  const effectiveTurn = Math.max(1, input.turn + bracketRules.turnOffset);
  const turnFactor = effectiveTurn <= 2 ? .45 : effectiveTurn <= 4 ? .75 : effectiveTurn >= 10 ? 1.1 : 1;
  const activeChance = Math.min(.92, (1 - none / 100) * turnFactor * bracketRules.interaction);
  if (random() >= activeChance) return { type: "none", title: "No response", detail: "The defending player has no relevant interaction. Resolve combat normally." };
  const type = weightedPick(random, { block, removal, fog });
  if (type === "removal") {
    const target = [...input.attackers].sort((a, b) => b.power - a.power)[0];
    return { type, title: "Spot removal", detail: `${target?.name ?? "Your largest attacker"} is targeted before combat damage. You may answer the removal.` };
  }
  if (type === "fog") return { type, title: "Fog effect", detail: "Prevent all combat damage this combat unless you can stop the effect." };
  const baseBlockerCount = Math.min(4, 1 + Math.floor((effectiveTurn - 1) / 4));
  const blockerCount = input.attackers.some((attacker) => attacker.keywords.includes("Menace")) ? Math.max(2, baseBlockerCount) : baseBlockerCount;
  const needsReach = input.attackers.some((attacker) => attacker.keywords.includes("Flying"));
  return { type, title: `${blockerCount} ${blockerCount === 1 ? "blocker" : "blockers"}`, detail: `The opponent commits ${blockerCount} plausible ${needsReach ? "blocker(s), including flying or reach where needed" : "blocker(s)"}. Resolve exact blocks in your playtester.` };
}

function addCommanderHit(damage: Record<string, number>, source: string, amount: number) {
  if (!source) return;
  const current = Object.prototype.hasOwnProperty.call(damage, source) ? safeAmount(damage[source]) : 0;
  Object.defineProperty(damage, source, { value: addAmounts(current, amount), enumerable: true, configurable: true, writable: true });
}

/** Builds editable full-attack defaults without inferring blocks, prevention, or replacement effects. */
export function buildDefaultCombatDamageSteps(attackers: readonly Attacker[], fallbackCommanderId?: string): CombatDamageStep[] {
  const first: CombatDamageStep = { step: "first", lifeDamage: 0, commanderHits: {}, poisonCounters: 0, lifelinkGain: 0 };
  const regular: CombatDamageStep = { step: "regular", lifeDamage: 0, commanderHits: {}, poisonCounters: 0, lifelinkGain: 0 };
  let hasFirst = false;
  let hasRegular = false;

  const addAttacker = (step: CombatDamageStep, attacker: Attacker, power: number) => {
    if (attacker.keywords.includes("Infect")) step.poisonCounters = addAmounts(step.poisonCounters, power);
    else step.lifeDamage = addAmounts(step.lifeDamage, power);
    if (attacker.isCommander) addCommanderHit(step.commanderHits, attacker.commanderId ?? fallbackCommanderId ?? "", power);
    if (attacker.keywords.includes("Lifelink")) step.lifelinkGain = addAmounts(step.lifelinkGain, power);
  };

  attackers.forEach((attacker) => {
    const power = safeAmount(attacker.power);
    const firstStrike = attacker.keywords.includes("First strike");
    const doubleStrike = attacker.keywords.includes("Double strike");
    if (firstStrike || doubleStrike) {
      hasFirst = true;
      addAttacker(first, attacker, power);
    }
    if (!firstStrike || doubleStrike) {
      hasRegular = true;
      addAttacker(regular, attacker, power);
    }
  });

  return [...(hasFirst ? [first] : []), ...(hasRegular ? [regular] : [])];
}

/** Applies combat-damage steps in rules order and checks tracked loss conditions between them. */
export function resolveCombatDamage(input: {
  state: CombatState;
  steps: readonly CombatDamageStep[];
  lossPrevented?: boolean;
}): CombatResolution {
  let life = safeLife(input.state?.life);
  let poisonCounters = safeAmount(input.state?.poisonCounters);
  const commanderDamage = safeDamageMap(input.state?.commanderDamage);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const stepsApplied: CombatResolution["stepsApplied"] = [];
  let lifeDamage = 0;
  let poisonAdded = 0;
  let lifelinkGain = 0;
  let defeated = false;
  let lossReason: CombatResolution["lossReason"] = null;
  let lethalCommander: string | null = null;

  for (const stepName of ["first", "regular"] as const) {
    const step = steps.find((candidate) => candidate?.step === stepName);
    if (!step) continue;
    const stepLifeDamage = safeAmount(step.lifeDamage);
    const stepPoison = safeAmount(step.poisonCounters);
    const stepLifelink = safeAmount(step.lifelinkGain);
    Object.entries(safeDamageMap(step.commanderHits)).forEach(([source, damage]) => addCommanderHit(commanderDamage, source, damage));
    life = subtractLife(life, stepLifeDamage);
    poisonCounters = addAmounts(poisonCounters, stepPoison);
    lifeDamage = addAmounts(lifeDamage, stepLifeDamage);
    poisonAdded = addAmounts(poisonAdded, stepPoison);
    lifelinkGain = addAmounts(lifelinkGain, stepLifelink);
    stepsApplied.push(stepName);

    const lethalEntry = Object.entries(commanderDamage).find(([, damage]) => damage >= 21);
    const reason = life <= 0 ? "life" : poisonCounters >= 10 ? "poison" : lethalEntry ? "commander" : null;
    if (reason && input.lossPrevented !== true) {
      defeated = true;
      lossReason = reason;
      lethalCommander = reason === "commander" ? lethalEntry?.[0] ?? null : null;
      break;
    }
  }

  return { life, poisonCounters, commanderDamage, defeated, lossReason, lethalCommander, stepsApplied, lifeDamage, poisonAdded, lifelinkGain };
}
