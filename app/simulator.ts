export type Difficulty = "friendly" | "balanced" | "punishing";
export type ProfileId = "midrange" | "control" | "swarm" | "voltron" | "combo" | "graveyard";
export type EventKind = "targeted" | "wipe" | "counter" | "disruption" | "attack" | "threat";
export type Keyword = "Flying" | "Reach" | "Trample" | "Menace" | "Vigilance" | "Deathtouch" | "First strike" | "Double strike" | "Haste" | "Lifelink";
export type CommanderSlot = "primary" | "partner";

export function opponentCommanderKey(opponentId: string) {
  return `opponent:${opponentId}:commander`;
}

export function userCommanderKey(slot: CommanderSlot) {
  return `user:${slot}:commander`;
}

export type Opponent = {
  id: string;
  name: string;
  profile: ProfileId;
  life: number;
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
  kind: Exclude<EventKind, "attack">;
  minTurn: number;
  title: string;
  prompt: string;
  card: string;
  tags: string[];
};

export const KEYWORD_DEFINITIONS: Record<Keyword, string> = {
  Flying: "Can be blocked only by creatures with flying or reach.",
  Reach: "Can block a creature with flying.",
  Trample: "May assign excess combat damage to the defending player after lethal damage is assigned to blockers.",
  Menace: "Can’t be blocked except by two or more creatures.",
  Vigilance: "Attacking doesn’t cause this creature to tap.",
  Deathtouch: "Any amount of damage it deals to a creature is lethal.",
  "First strike": "Deals combat damage before creatures without first strike or double strike.",
  "Double strike": "Deals combat damage in both the first-strike and regular combat-damage steps.",
  Haste: "Can attack and use tap abilities immediately after coming under its controller’s control.",
  Lifelink: "Its controller gains that much life when it deals damage.",
};

export const PROFILE_LABELS: Record<ProfileId, string> = {
  midrange: "Generic midrange",
  control: "Control",
  swarm: "Creature swarm",
  voltron: "Voltron",
  combo: "Combo",
  graveyard: "Graveyard value",
};

const PROFILES: Record<ProfileId, {
  combat: number;
  counterBack: number;
  events: Record<Exclude<EventKind, "attack">, number>;
  defense: [number, number, number, number];
}> = {
  swarm: { combat: 1.3, counterBack: .05, events: { targeted: 30, wipe: 8, counter: 2, disruption: 45, threat: 15 }, defense: [35, 50, 10, 5] },
  voltron: { combat: 1.1, counterBack: .1, events: { targeted: 38, wipe: 8, counter: 7, disruption: 27, threat: 20 }, defense: [42, 25, 23, 10] },
  midrange: { combat: 1, counterBack: .12, events: { targeted: 32, wipe: 18, counter: 10, disruption: 25, threat: 15 }, defense: [30, 42, 20, 8] },
  control: { combat: .65, counterBack: .35, events: { targeted: 30, wipe: 24, counter: 28, disruption: 10, threat: 8 }, defense: [18, 22, 35, 25] },
  combo: { combat: .55, counterBack: .25, events: { targeted: 18, wipe: 10, counter: 25, disruption: 14, threat: 33 }, defense: [35, 18, 27, 20] },
  graveyard: { combat: .95, counterBack: .08, events: { targeted: 24, wipe: 13, counter: 5, disruption: 36, threat: 22 }, defense: [28, 45, 22, 5] },
};

export const CARD_LIBRARY_UPDATED = "August 18, 2026";

export const CARD_LIBRARY = [
  { archetype: "Spot removal", cards: ["Swords to Plowshares", "Path to Exile", "Beast Within", "Anguished Unmaking"] },
  { archetype: "Board control", cards: ["Toxic Deluge", "Farewell", "Cyclonic Rift", "Vandalblast"] },
  { archetype: "Stack interaction", cards: ["Counterspell", "Swan Song", "Fierce Guardianship", "Deflecting Swat"] },
  { archetype: "Protection", cards: ["Heroic Intervention", "Teferi’s Protection", "Flawless Maneuver", "Tamiyo’s Safekeeping"] },
  { archetype: "Combo pressure", cards: ["Thassa’s Oracle", "Demonic Consultation", "Aetherflux Reservoir", "Craterhoof Behemoth"] },
  { archetype: "Graveyard pressure", cards: ["Bojuka Bog", "Rest in Peace", "Living Death", "Reanimate"] },
] as const;

const TEMPLATES: EventTemplate[] = [
  { id: "early-rock", kind: "targeted", minTurn: 1, title: "Your early mana is checked.", prompt: "Destroy your most useful mana rock or mana creature. If there is no legal target, let the table action miss.", card: "Nature’s Claim", tags: ["Destroy", "Mana"] },
  { id: "destroy-creature", kind: "targeted", minTurn: 2, title: "Your best creature is targeted.", prompt: "Destroy your highest-power noncommander creature. Counter, protect it, or let the spell resolve.", card: "Beast Within", tags: ["Destroy", "Creature"] },
  { id: "exile-commander", kind: "targeted", minTurn: 3, title: "Exile your commander.", prompt: "Your commander is targeted by an exile effect. If it leaves, make the normal command-zone choice in your playtester.", card: "Swords to Plowshares", tags: ["Exile", "Commander"] },
  { id: "remove-engine", kind: "targeted", minTurn: 3, title: "Your engine is exposed.", prompt: "Exile your most important artifact or enchantment. Can you counter, protect, sacrifice, or otherwise save it?", card: "Anguished Unmaking", tags: ["Exile", "Permanent"] },
  { id: "destroy-wipe", kind: "wipe", minTurn: 5, title: "Destroy all creatures.", prompt: "A board wipe goes on the stack. Indestructible creatures survive; can you counter it or protect your board?", card: "Wrath of God", tags: ["Board wipe", "Destroy"] },
  { id: "minus-wipe", kind: "wipe", minTurn: 5, title: "The board gets −X/−X.", prompt: "Give each creature you control −X/−X until end of turn, where X is the greatest toughness among them. Indestructible does not stop this.", card: "Toxic Deluge", tags: ["Board wipe", "Toughness"] },
  { id: "mass-bounce", kind: "wipe", minTurn: 6, title: "Return your nonlands to hand.", prompt: "Return each nonland permanent you control to its owner’s hand unless you can stop the overloaded spell.", card: "Cyclonic Rift", tags: ["Board wipe", "Bounce"] },
  { id: "exile-wipe", kind: "wipe", minTurn: 7, title: "Exile the battlefield.", prompt: "Exile creatures, artifacts, and enchantments you control. Indestructible does not prevent exile.", card: "Farewell", tags: ["Board wipe", "Exile"] },
  { id: "counter-key-spell", kind: "counter", minTurn: 2, title: "Your next key spell is countered.", prompt: "When you cast your next mana-value-4-or-greater spell this turn, the table tries to counter it.", card: "Counterspell", tags: ["Counter", "Stack"] },
  { id: "counter-commander", kind: "counter", minTurn: 3, title: "Your commander meets permission.", prompt: "The next time you cast your commander this turn, the table tries to counter that spell.", card: "Fierce Guardianship", tags: ["Counter", "Commander"] },
  { id: "random-discard", kind: "disruption", minTurn: 2, title: "Discard at random.", prompt: "Randomize the nonland cards in your hand and discard one of them.", card: "Wheel pressure", tags: ["Discard", "Hand"] },
  { id: "graveyard-hate", kind: "disruption", minTurn: 3, title: "Exile your graveyard.", prompt: "Exile your graveyard before your next graveyard effect resolves. Can you save or use anything first?", card: "Bojuka Bog", tags: ["Exile", "Graveyard"] },
  { id: "artifact-sweep", kind: "disruption", minTurn: 5, title: "Destroy your artifacts.", prompt: "Destroy each artifact you control. Mana rocks, Equipment, Treasures, and artifact creatures are all caught.", card: "Vandalblast", tags: ["Destroy", "Artifacts"] },
  { id: "goad", kind: "disruption", minTurn: 4, title: "Your strongest creature is goaded.", prompt: "Your highest-power creature must attack a player other than the acting opponent next combat, if able.", card: "Disrupt Decorum", tags: ["Goad", "Combat"] },
  { id: "combo-clock", kind: "threat", minTurn: 5, title: "A two-card win is assembling.", prompt: "A compact combo is telegraphed. Remove a piece, stop the tutor, or prepare stack interaction before the clock expires.", card: "Thassa’s Oracle line", tags: ["Game-ending", "Combo"] },
  { id: "artifact-clock", kind: "threat", minTurn: 6, title: "A lethal artifact is charging.", prompt: "An artifact engine will produce a game-ending activation when its countdown reaches zero.", card: "Aetherflux Reservoir", tags: ["Game-ending", "Artifact"] },
  { id: "combat-clock", kind: "threat", minTurn: 5, title: "A lethal combat turn is coming.", prompt: "The creature deck is building a lethal overrun. Remove the enabler or hold up a fog before the countdown expires.", card: "Craterhoof Behemoth", tags: ["Game-ending", "Combat"] },
];

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

function intBetween(random: () => number, minimum: number, maximum: number) {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
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
    "First strike": 9, Haste: 8, Lifelink: 5, "Double strike": 3, Reach: 1,
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

function generateAttack(random: () => number, turn: number, source: Opponent, difficulty: Difficulty, eventId: string): Attacker[] {
  const band = attackBand(turn);
  const profile = PROFILES[source.profile];
  const difficultyScale = difficulty === "friendly" ? .82 : difficulty === "punishing" ? 1.18 : 1;
  const count = intBetween(random, band.count[0], band.count[1]);
  const rawTotal = intBetween(random, band.power[0], band.power[1]);
  const totalPower = Math.max(count, Math.round(rawTotal * profile.combat * difficultyScale));
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
    };
  });
}

export function incomingDamage(attackers: Attacker[]) {
  return attackers.reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0);
}

export function incomingCommanderDamage(attackers: Attacker[]) {
  return attackers.filter((attacker) => attacker.isCommander).reduce((sum, attacker) => sum + attacker.power * (attacker.keywords.includes("Double strike") ? 2 : 1), 0);
}

export function generateEvent(input: {
  turn: number;
  counter: number;
  seed: string;
  opponents: Opponent[];
  recentTemplateIds: string[];
  activeThreat: boolean;
  difficulty: Difficulty;
}): SimEvent {
  const { turn, counter, seed, recentTemplateIds, activeThreat, difficulty } = input;
  const livingOpponents = input.opponents.filter((opponent) => !opponent.eliminated);
  if (!livingOpponents.length) throw new Error("Cannot generate an event without a living opponent.");
  const random = rngFor(`${seed}:${turn}:${counter}`);
  const source = livingOpponents[intBetween(random, 0, livingOpponents.length - 1)];
  const profile = PROFILES[source.profile];
  const band = attackBand(turn);
  const difficultyChance = difficulty === "friendly" ? .78 : difficulty === "punishing" ? 1.14 : 1;
  const eventId = `event-${turn}-${counter}`;

  if (random() < Math.min(.95, band.chance * profile.combat * difficultyChance)) {
    const attackers = generateAttack(random, turn, source, difficulty, eventId);
    return {
      id: eventId,
      templateId: "scaled-attack",
      kind: "attack",
      sourceId: source.id,
      sourceName: source.name,
      title: `${source.name} sends ${attackers.length === 1 ? "an attacker" : `${attackers.length} attackers`} at you.`,
      prompt: "Declare blocks or interaction in your playtester, then record the combat damage that gets through.",
      card: `${PROFILE_LABELS[source.profile]} combat`,
      tags: ["Combat", `Turn ${turn} scaling`],
      attackers,
    };
  }

  const eventWeights = { ...profile.events };
  if (turn < 5 || activeThreat) eventWeights.threat = 0;
  if (turn < 5) eventWeights.wipe = Math.min(eventWeights.wipe, 2);
  let kind = weightedPick(random, eventWeights);
  let candidates = TEMPLATES.filter((template) => template.kind === kind && template.minTurn <= turn && !recentTemplateIds.includes(template.id));
  if (!candidates.length) candidates = TEMPLATES.filter((template) => template.kind === kind && template.minTurn <= turn);
  if (!candidates.length) {
    kind = "targeted";
    candidates = TEMPLATES.filter((template) => template.kind === kind && template.minTurn <= turn);
  }
  const template = candidates[intBetween(random, 0, candidates.length - 1)];
  const threatTurns = turn <= 6 ? 3 : turn <= 9 ? 2 : intBetween(random, 1, 2);

  return {
    id: eventId,
    templateId: template.id,
    kind: template.kind,
    sourceId: source.id,
    sourceName: source.name,
    title: template.title,
    prompt: template.prompt,
    card: template.card,
    tags: template.tags,
    threat: template.kind === "threat" ? {
      id: `threat-${turn}-${counter}`,
      ownerId: source.id,
      title: template.title,
      description: template.prompt,
      remaining: threatTurns,
      delayed: false,
    } : undefined,
  };
}

export function counterBacks(input: { profile: ProfileId; seed: string; turn: number; counter: number; difficulty: Difficulty }) {
  const difficultyScale = input.difficulty === "friendly" ? .7 : input.difficulty === "punishing" ? 1.25 : 1;
  return rngFor(`${input.seed}:counter:${input.turn}:${input.counter}`)() < Math.min(.6, PROFILES[input.profile].counterBack * difficultyScale);
}

export function rollDefense(input: {
  profile: ProfileId;
  seed: string;
  turn: number;
  counter: number;
  difficulty: Difficulty;
  attackers: { name: string; power: number; keywords: Keyword[] }[];
}): DefenseResult {
  const random = rngFor(`${input.seed}:defense:${input.turn}:${input.counter}:${input.profile}`);
  const [none, block, removal, fog] = PROFILES[input.profile].defense;
  const turnFactor = input.turn <= 2 ? .45 : input.turn <= 4 ? .75 : input.turn >= 10 ? 1.1 : 1;
  const difficultyFactor = input.difficulty === "friendly" ? .75 : input.difficulty === "punishing" ? 1.16 : 1;
  const activeChance = Math.min(.85, (1 - none / 100) * turnFactor * difficultyFactor);
  if (random() >= activeChance) return { type: "none", title: "No response", detail: "The defending player has no relevant interaction. Resolve combat normally." };
  const type = weightedPick(random, { block, removal, fog });
  if (type === "removal") {
    const target = [...input.attackers].sort((a, b) => b.power - a.power)[0];
    return { type, title: "Spot removal", detail: `${target?.name ?? "Your largest attacker"} is targeted before combat damage. You may answer the removal.` };
  }
  if (type === "fog") return { type, title: "Fog effect", detail: "Prevent all combat damage this combat unless you can stop the effect." };
  const blockerCount = Math.min(4, 1 + Math.floor((input.turn - 1) / 4));
  const needsReach = input.attackers.some((attacker) => attacker.keywords.includes("Flying"));
  return { type, title: `${blockerCount} ${blockerCount === 1 ? "blocker" : "blockers"}`, detail: `The opponent commits ${blockerCount} plausible ${needsReach ? "blocker(s), including flying or reach where needed" : "blocker(s)"}. Resolve exact blocks in your playtester.` };
}

export function applyCombatDamage(input: {
  life: number;
  commanderDamage: Record<string, number>;
  regularDamage: number;
  commanderHits: Record<string, number>;
}) {
  const regularDamage = Math.max(0, Math.floor(Number(input.regularDamage) || 0));
  const commanderHits = Object.fromEntries(Object.entries(input.commanderHits).map(([source, damage]) => [source, Math.max(0, Math.floor(Number(damage) || 0))]));
  const commanderDamage = { ...input.commanderDamage };
  Object.entries(commanderHits).forEach(([source, damage]) => {
    commanderDamage[source] = (commanderDamage[source] ?? 0) + damage;
  });
  const totalDamage = regularDamage + Object.values(commanderHits).reduce((sum, damage) => sum + damage, 0);
  const life = input.life - totalDamage;
  const lethalCommander = Object.entries(commanderDamage).find(([, damage]) => damage >= 21)?.[0] ?? null;
  return { life, commanderDamage, totalDamage, defeated: life <= 0 || Boolean(lethalCommander), lethalCommander };
}
