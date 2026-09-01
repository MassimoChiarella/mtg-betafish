import assert from "node:assert/strict";
import test from "node:test";
import { SIGNATURE_USE_TEMPLATE_ID } from "../app/simulator.ts";
import { decodeGameState, GAME_STATE_VERSION } from "../app/session.ts";

function currentState() {
  return {
    version: 5,
    turn: 6,
    eventCounter: 9,
    defenseCounter: 3,
    seed: "SESSION-V5",
    opponents: [
      {
        id: "one",
        name: "One",
        profile: "control",
        bracket: 4,
        life: 31,
        commanderDamage: { "user:primary:commander": 7, "user:partner:commander": 2 },
        poisonCounters: 2,
        eliminated: false,
      },
      {
        id: "two",
        name: "Two",
        profile: "swarm",
        bracket: 2,
        life: 0,
        commanderDamage: {},
        poisonCounters: 0,
        eliminated: true,
      },
    ],
    userLife: 27,
    userPoisonCounters: 3,
    userCommanderDamage: {
      "opponent:one:commander": 8,
      "opponent:two:partner:commander": 4,
    },
    currentEvent: {
      id: "SESSION-V5:6:9:targeted:one",
      templateId: "destroy-creature",
      kind: "targeted",
      sourceId: "one",
      sourceName: "One",
      title: "One points removal at your creature.",
      prompt: "Destroy your most important creature.",
      card: "Swords to Plowshares",
      tags: ["Exile", "Creature"],
      responseOptions: ["counter", "protect", "redirect", "custom"],
      emptyOutcome: "No legal target means the action does nothing.",
    },
    responseStage: "choose",
    resolution: "",
    activeThreat: {
      id: "threat-one",
      ownerId: "one",
      title: "A delayed win",
      description: "Answer this before its clock expires.",
      remaining: 0,
      delayed: true,
    },
    recentTemplateIds: ["counter-key-spell", "destroy-creature"],
    history: [
      { id: "combat-six", turn: 6, title: "Combat resolved", detail: "Damage was recorded.", tone: "damage" },
      { id: "answer-two", turn: 2, title: "Action answered", detail: "The spell was countered.", tone: "success" },
      { id: "session-start", turn: 1, title: "Session started", detail: "The table is live.", tone: "neutral" },
    ],
    answeredCount: 2,
    combatResolvedTurn: 6,
    counterExchange: 4,
    gameOver: null,
  };
}

function legacyState(version) {
  const state = structuredClone(currentState());
  state.version = version;
  delete state.userPoisonCounters;
  delete state.counterExchange;
  for (const opponent of state.opponents) delete opponent.poisonCounters;
  delete state.currentEvent.responseOptions;
  delete state.currentEvent.emptyOutcome;

  if (version < 4) delete state.combatResolvedTurn;
  if (version < 3) delete state.answeredCount;
  if (version === 1) {
    for (const opponent of state.opponents) delete opponent.bracket;
    state.difficulty = "balanced";
  }
  if (version < 3) {
    state.eventStatus = "pending";
    state.paused = false;
  }
  return state;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function makeAttack(state) {
  state.currentEvent.kind = "attack";
  state.currentEvent.templateId = "combat";
  state.currentEvent.attackers = [{
    id: "attacker-one",
    name: "Attacker",
    power: 4,
    toughness: 4,
    keywords: ["Flying"],
    isCommander: false,
  }];
}

test("an actionable signature-card encounter preserves its revealed source and card", () => {
  const state = currentState();
  state.currentEvent = {
    id: "signature-card-encounter",
    templateId: SIGNATURE_USE_TEMPLATE_ID,
    kind: "signature",
    sourceId: "one",
    sourceName: "One",
    title: "One uses the revealed Cyclonic Rift.",
    prompt: "Resolve the exact revealed card.",
    card: "Cyclonic Rift",
    tags: ["Signature follow-through", "Previously revealed"],
    responseOptions: ["custom"],
    emptyOutcome: "There was no legal opportunity to use the revealed card in the current playtest state.",
  };
  state.responseStage = "choose";

  const decoded = decodeGameState(state);
  assert.ok(decoded);
  assert.equal(decoded.currentEvent.kind, "signature");
  assert.equal(decoded.currentEvent.sourceId, "one");
  assert.equal(decoded.currentEvent.card, "Cyclonic Rift");
  assert.deepEqual(decoded.currentEvent.responseOptions, ["custom"]);
});

test("a valid v5 state round-trips as a fresh serializable value", () => {
  const raw = deepFreeze(currentState());
  const decoded = decodeGameState(raw);

  assert.deepEqual(decoded, raw);
  assert.equal(decoded.version, GAME_STATE_VERSION);
  assert.notStrictEqual(decoded, raw);
  assert.notStrictEqual(decoded.opponents, raw.opponents);
  assert.notStrictEqual(decoded.opponents[0].commanderDamage, raw.opponents[0].commanderDamage);
  assert.notStrictEqual(decoded.currentEvent, raw.currentEvent);
  assert.notStrictEqual(decoded.history, raw.history);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded)), decoded);
});

test("representative v1-v4 states migrate without losing deterministic or ledger data", async (t) => {
  for (const version of [1, 2, 3, 4]) {
    await t.test(`v${version}`, () => {
      const raw = legacyState(version);
      const decoded = decodeGameState(raw);

      assert.ok(decoded);
      assert.equal(decoded.version, 5);
      assert.equal(decoded.seed, raw.seed);
      assert.equal(decoded.currentEvent.id, raw.currentEvent.id);
      assert.equal(decoded.currentEvent.templateId, raw.currentEvent.templateId);
      assert.deepEqual(decoded.currentEvent.responseOptions, ["counter", "protect", "redirect", "custom"]);
      assert.equal(decoded.currentEvent.emptyOutcome, "The spell could not be cast because there was no legal permanent target.");
      assert.deepEqual(decoded.userCommanderDamage, raw.userCommanderDamage);
      assert.deepEqual(decoded.opponents.map(({ life }) => life), raw.opponents.map(({ life }) => life));
      assert.deepEqual(decoded.opponents.map(({ poisonCounters }) => poisonCounters), [0, 0]);
      assert.equal(decoded.userPoisonCounters, 0);
      assert.equal(decoded.counterExchange, 0);
      assert.equal(decoded.answeredCount, version < 3 ? 1 : 2);
      assert.equal(decoded.combatResolvedTurn, 6);
      assert.deepEqual(decoded.opponents.map(({ bracket }) => bracket), version === 1 ? [3, 3] : [4, 2]);
      assert.deepEqual(decoded.history, raw.history);
    });
  }
});

test("legacy-only poison and counter fields cannot smuggle v5 values", () => {
  const raw = legacyState(4);
  raw.userPoisonCounters = 9;
  raw.counterExchange = 17;
  raw.opponents[0].poisonCounters = 8;

  const decoded = decodeGameState(raw);
  assert.ok(decoded);
  assert.equal(decoded.userPoisonCounters, 0);
  assert.equal(decoded.counterExchange, 0);
  assert.equal(decoded.opponents[0].poisonCounters, 0);
});

test("legacy response metadata migrates by template and rejects unknown noncombat templates", () => {
  const livingDeath = legacyState(4);
  livingDeath.currentEvent.templateId = "living-death";
  livingDeath.currentEvent.kind = "wipe";
  livingDeath.currentEvent.card = "Living Death";
  const decodedWipe = decodeGameState(livingDeath);
  assert.ok(decodedWipe);
  assert.deepEqual(decodedWipe.currentEvent.responseOptions, ["counter", "protect", "custom"]);
  assert.equal(decodedWipe.currentEvent.emptyOutcome, "No creature card or creature you control changed zones during resolution.");

  const attack = legacyState(4);
  makeAttack(attack);
  const decodedAttack = decodeGameState(attack);
  assert.ok(decodedAttack);
  assert.deepEqual(decodedAttack.currentEvent.responseOptions, []);

  const unknown = legacyState(4);
  unknown.currentEvent.templateId = "unknown-legacy-template";
  assert.equal(decodeGameState(unknown), null);
});

test("missing v5 poison and counter fields fail closed", () => {
  const raw = currentState();
  delete raw.userPoisonCounters;
  delete raw.counterExchange;
  for (const opponent of raw.opponents) delete opponent.poisonCounters;

  assert.equal(decodeGameState(raw), null);
});

test("legacy commander attackers gain the source primary identity and existing identities survive", () => {
  const raw = legacyState(4);
  raw.currentEvent = {
    id: "legacy-attack",
    templateId: "combat",
    kind: "attack",
    sourceId: "one",
    sourceName: "One",
    title: "One attacks.",
    prompt: "Resolve all attackers.",
    card: "Combat step",
    tags: ["Combat"],
    attackers: [
      { id: "primary", name: "Primary", power: 5, toughness: 5, keywords: ["Lifelink"], isCommander: true },
      {
        id: "stolen-partner",
        name: "Stolen partner",
        power: 3,
        toughness: 3,
        keywords: ["Infect"],
        isCommander: true,
        commanderId: "opponent:two:partner:commander",
        commanderLabel: "Two's partner",
      },
      { id: "token", name: "Token", power: 1, toughness: 1, keywords: [], isCommander: false },
    ],
  };

  const decoded = decodeGameState(raw);
  assert.ok(decoded);
  assert.equal(decoded.currentEvent.attackers[0].commanderId, "opponent:one:commander");
  assert.equal(decoded.currentEvent.attackers[0].commanderLabel, "One’s commander");
  assert.equal(decoded.currentEvent.attackers[1].commanderId, "opponent:two:partner:commander");
  assert.equal(decoded.currentEvent.attackers[1].commanderLabel, "Two's partner");
  assert.equal(decoded.userCommanderDamage["opponent:one:commander"], 8);
  assert.equal(decoded.userCommanderDamage["opponent:two:partner:commander"], 4);
});

test("valid safe-integer boundaries and an owned threat are accepted", () => {
  const raw = currentState();
  raw.turn = Number.MAX_SAFE_INTEGER;
  raw.eventCounter = Number.MAX_SAFE_INTEGER;
  raw.defenseCounter = Number.MAX_SAFE_INTEGER;
  raw.userLife = Number.MIN_SAFE_INTEGER;
  raw.answeredCount = Number.MAX_SAFE_INTEGER;
  raw.combatResolvedTurn = Number.MAX_SAFE_INTEGER;
  raw.counterExchange = Number.MAX_SAFE_INTEGER;
  raw.userPoisonCounters = Number.MAX_SAFE_INTEGER;
  raw.userCommanderDamage["opponent:one:commander"] = Number.MAX_SAFE_INTEGER;
  raw.opponents[0].life = Number.MIN_SAFE_INTEGER;
  raw.opponents[0].poisonCounters = Number.MAX_SAFE_INTEGER;
  raw.activeThreat.remaining = Number.MAX_SAFE_INTEGER;

  assert.ok(decodeGameState(raw));
});

test("a resolved event may remain visible after its source is eliminated", () => {
  const raw = currentState();
  raw.responseStage = "resolved";
  raw.currentEvent.sourceId = "two";
  raw.currentEvent.sourceName = "Two";

  assert.ok(decodeGameState(raw));
});

test("malformed current state fails closed at every persistence boundary", async (t) => {
  const cases = [
    ["unsupported version", (state) => { state.version = 6; }],
    ["fractional version", (state) => { state.version = 4.5; }],
    ["zero turn", (state) => { state.turn = 0; }],
    ["unsafe event counter", (state) => { state.eventCounter = Number.MAX_SAFE_INTEGER + 1; }],
    ["negative defense counter", (state) => { state.defenseCounter = -1; }],
    ["non-string seed", (state) => { state.seed = null; }],
    ["empty opponents", (state) => { state.opponents = []; }],
    ["unknown profile", (state) => { state.opponents[0].profile = "ramp"; }],
    ["missing bracket", (state) => { delete state.opponents[0].bracket; }],
    ["unknown bracket", (state) => { state.opponents[0].bracket = 6; }],
    ["duplicate opponent ID", (state) => { state.opponents[1].id = "one"; }],
    ["empty opponent ID", (state) => { state.opponents[0].id = "   "; }],
    ["string damage ledger", (state) => { state.userCommanderDamage["opponent:one:commander"] = "8"; }],
    ["negative damage ledger", (state) => { state.opponents[0].commanderDamage["user:primary:commander"] = -1; }],
    ["array damage ledger", (state) => { state.userCommanderDamage = []; }],
    ["non-finite life", (state) => { state.userLife = Number.POSITIVE_INFINITY; }],
    ["unsafe opponent life", (state) => { state.opponents[0].life = Number.MIN_SAFE_INTEGER - 1; }],
    ["non-boolean elimination", (state) => { state.opponents[0].eliminated = 0; }],
    ["non-finite ledger", (state) => { state.userCommanderDamage.bad = Number.NaN; }],
    ["unsafe ledger", (state) => { state.userCommanderDamage.bad = Number.MAX_SAFE_INTEGER + 1; }],
    ["fractional counter", (state) => { state.defenseCounter = 1.5; }],
    ["negative poison", (state) => { state.userPoisonCounters = -1; }],
    ["string opponent poison", (state) => { state.opponents[0].poisonCounters = "2"; }],
    ["missing opponent poison", (state) => { delete state.opponents[0].poisonCounters; }],
    ["missing counter exchange", (state) => { delete state.counterExchange; }],
    ["unsafe counter exchange", (state) => { state.counterExchange = Number.MAX_SAFE_INTEGER + 1; }],
    ["unknown response stage", (state) => { state.responseStage = "stack"; }],
    ["null recent IDs", (state) => { state.recentTemplateIds = null; }],
    ["non-string recent ID", (state) => { state.recentTemplateIds = [3]; }],
    ["empty recent ID", (state) => { state.recentTemplateIds = [" "]; }],
    ["malformed current event", (state) => { state.currentEvent = []; }],
    ["missing event source", (state) => { state.currentEvent.sourceId = "gone"; }],
    ["unknown event kind", (state) => { state.currentEvent.kind = "mana"; }],
    ["malformed event tags", (state) => { state.currentEvent.tags = null; }],
    ["attack without attackers", (state) => { state.currentEvent.kind = "attack"; }],
    ["empty attack", (state) => { state.currentEvent.kind = "attack"; state.currentEvent.attackers = []; }],
    ["fractional attacker power", (state) => { makeAttack(state); state.currentEvent.attackers[0].power = 1.5; }],
    ["unknown attacker keyword", (state) => { makeAttack(state); state.currentEvent.attackers[0].keywords = ["Ward"]; }],
    ["empty commander identity", (state) => { makeAttack(state); state.currentEvent.attackers[0].isCommander = true; state.currentEvent.attackers[0].commanderId = ""; }],
    ["missing commander identity", (state) => { makeAttack(state); state.currentEvent.attackers[0].isCommander = true; }],
    ["identity on a noncommander", (state) => { makeAttack(state); state.currentEvent.attackers[0].commanderId = "commander"; }],
    ["unknown active threat owner", (state) => { state.activeThreat.ownerId = "gone"; }],
    ["eliminated active threat owner", (state) => { state.activeThreat.ownerId = "two"; }],
    ["unresolved event from eliminated source", (state) => { state.currentEvent.sourceId = "two"; state.currentEvent.sourceName = "Two"; }],
    ["threat event without a threat", (state) => { state.currentEvent.kind = "threat"; }],
    ["unknown event threat owner", (state) => { state.currentEvent.kind = "threat"; state.currentEvent.threat = { ...state.activeThreat, ownerId: "gone" }; }],
    ["threat attached to another event kind", (state) => { state.currentEvent.threat = { ...state.activeThreat }; }],
    ["null history", (state) => { state.history = null; }],
    ["malformed history turn", (state) => { state.history[0].turn = 0; }],
    ["fractional history turn", (state) => { state.history[0].turn = 1.5; }],
    ["unknown history tone", (state) => { state.history[0].tone = "info"; }],
    ["missing answered count", (state) => { delete state.answeredCount; }],
    ["negative answered count", (state) => { state.answeredCount = -1; }],
    ["future combat turn", (state) => { state.combatResolvedTurn = state.turn + 1; }],
    ["fractional combat turn", (state) => { state.combatResolvedTurn = 1.5; }],
    ["null response options", (state) => { state.currentEvent.responseOptions = null; }],
    ["missing response options", (state) => { delete state.currentEvent.responseOptions; }],
    ["unknown response option", (state) => { state.currentEvent.responseOptions = ["sacrifice"]; }],
    ["counterback without a counter response", (state) => { state.responseStage = "counterback"; state.currentEvent.responseOptions = ["custom"]; }],
    ["non-string empty outcome", (state) => { state.currentEvent.emptyOutcome = 3; }],
    ["non-string game over", (state) => { state.gameOver = false; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const state = currentState();
      mutate(state);
      assert.equal(decodeGameState(state), null);
    });
  }
});

test("hostile inputs and one deterministic JSON fuzz loop fail closed", () => {
  const cycle = {};
  cycle.self = cycle;
  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error("hostile prototype"); } });
  const throwingGetter = {};
  Object.defineProperty(throwingGetter, "version", { get() { throw new Error("hostile getter"); } });
  const arbitrary = [
    null,
    undefined,
    true,
    false,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "state",
    [],
    {},
    new Date(),
    cycle,
    hostile,
    throwingGetter,
  ];

  let seed = 0x5e5510;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const randomJson = (depth = 0) => {
    const kind = depth >= 3 ? Math.floor(random() * 4) : Math.floor(random() * 6);
    if (kind === 0) return null;
    if (kind === 1) return random() < 0.5;
    if (kind === 2) return Math.floor(random() * 21) - 10;
    if (kind === 3) return `value-${Math.floor(random() * 10)}`;
    if (kind === 4) return Array.from({ length: Math.floor(random() * 4) }, () => randomJson(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, (_, index) => [`key${index}`, randomJson(depth + 1)]));
  };
  arbitrary.push(...Array.from({ length: 2_500 }, () => randomJson()));

  for (const value of arbitrary) {
    assert.equal(decodeGameState(value), null);
  }
});
