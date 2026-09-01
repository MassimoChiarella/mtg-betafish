import assert from "node:assert/strict";
import test from "node:test";
import { decodeGameState, GAME_STATE_VERSION } from "../app/session.ts";
import { EVENT_TEMPLATES, SIGNATURE_USE_TEMPLATE_ID } from "../app/simulator.ts";

function eventFromTemplate(templateId, sourceId = "one", sourceName = "One") {
  const template = EVENT_TEMPLATES.find(({ id }) => id === templateId);
  assert.ok(template, `missing test template ${templateId}`);
  const event = {
    id: `SESSION-V6:6:9:${template.kind}:${sourceId}`,
    templateId,
    kind: template.kind,
    sourceId,
    sourceName,
    title: template.title,
    prompt: template.prompt,
    card: template.card,
    tags: [...template.tags, "B4 Optimized"],
    responseOptions: [...template.responseOptions],
    emptyOutcome: template.emptyOutcome,
  };
  if (template.kind === "threat") {
    event.threat = {
      id: "threat-current",
      ownerId: sourceId,
      title: template.title,
      description: template.prompt,
      remaining: 2,
      delayed: false,
    };
  }
  return event;
}

function currentState() {
  return {
    version: GAME_STATE_VERSION,
    turn: 6,
    eventCounter: 9,
    defenseCounter: 3,
    seed: "SESSION-V6",
    opponents: [
      {
        id: "one",
        name: "One",
        profile: "control",
        bracket: 4,
        life: 31,
        commanderDamage: { "user:primary:commander": 7, "user:partner:commander": 2 },
        poisonCounters: 2,
        lossProtected: true,
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
        lossProtected: false,
        eliminated: true,
      },
    ],
    userLife: 27,
    userLossProtected: true,
    userPoisonCounters: 3,
    userCommanderDamage: {
      "opponent:one:commander": 8,
      "opponent:two:partner:commander": 4,
    },
    currentEvent: eventFromTemplate("destroy-creature"),
    responseStage: "choose",
    resolution: "",
    toxicDelugePayment: null,
    activeThreat: {
      id: "threat-one",
      ownerId: "one",
      title: "A delayed win",
      description: "Answer this before its clock expires.",
      remaining: 2,
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
    counterExchange: 0,
    gameOver: null,
  };
}

function legacyState(version) {
  const state = structuredClone(currentState());
  state.version = version;
  state.seed = `SESSION-V${version}`;
  delete state.toxicDelugePayment;
  delete state.userLossProtected;
  for (const opponent of state.opponents) delete opponent.lossProtected;

  state.currentEvent.title = "Old title";
  state.currentEvent.prompt = "Old prompt";
  state.currentEvent.card = "Old card";
  state.currentEvent.tags = ["Preserved legacy context"];
  state.currentEvent.responseOptions = ["custom"];
  state.currentEvent.emptyOutcome = "Old empty outcome";

  if (version < 5) {
    delete state.userPoisonCounters;
    delete state.counterExchange;
    for (const opponent of state.opponents) delete opponent.poisonCounters;
    delete state.currentEvent.responseOptions;
    delete state.currentEvent.emptyOutcome;
  }
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
  state.currentEvent = {
    id: "scaled-attack",
    templateId: "scaled-attack",
    kind: "attack",
    sourceId: "one",
    sourceName: "One",
    title: "One attacks.",
    prompt: "Resolve all attackers.",
    card: "Control combat",
    tags: ["Combat"],
    responseOptions: [],
    attackers: [{
      id: "attacker-one",
      name: "Attacker",
      power: 4,
      toughness: 4,
      keywords: ["Flying"],
      isCommander: false,
    }],
  };
  state.responseStage = "prompt";
  state.counterExchange = 0;
}

function makeDevelopment(state) {
  state.currentEvent = {
    id: "table-development",
    templateId: "table-development",
    kind: "development",
    sourceId: "one",
    sourceName: "One",
    title: "One reveals a signature card.",
    prompt: "Record the deck information.",
    card: "Counterspell",
    tags: ["Deck intel"],
    responseOptions: [],
  };
  state.responseStage = "prompt";
  state.counterExchange = 0;
}

function makeThreat(state, stage = "prompt") {
  state.currentEvent = eventFromTemplate("combo-clock");
  state.responseStage = stage;
  state.counterExchange = 0;
  state.activeThreat = stage === "resolved" ? structuredClone(state.currentEvent.threat) : null;
}

test("a valid v6 state round-trips as a fresh serializable value", () => {
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

test("an actionable signature-card encounter preserves its revealed source and card", () => {
  const raw = currentState();
  raw.currentEvent = {
    id: "signature-card-encounter",
    templateId: SIGNATURE_USE_TEMPLATE_ID,
    kind: "signature",
    sourceId: "one",
    sourceName: "One",
    title: "One uses the revealed Counterspell.",
    prompt: "Resolve the exact previously revealed card.",
    card: "Counterspell",
    tags: ["Signature follow-through", "Previously revealed"],
    responseOptions: ["custom"],
    emptyOutcome: "There was no legal opportunity to use the revealed card in the current playtest state.",
  };
  raw.responseStage = "prompt";
  raw.counterExchange = 0;

  const decoded = decodeGameState(raw);
  assert.ok(decoded);
  assert.deepEqual(decoded.currentEvent, raw.currentEvent);
});

test("a recorded signature reveal preserves the exact pending follow-up through reload", () => {
  const raw = currentState();
  makeDevelopment(raw);
  raw.responseStage = "resolved";

  const decoded = decodeGameState(raw);
  assert.ok(decoded);
  assert.equal(decoded.responseStage, "resolved");
  assert.deepEqual(decoded.currentEvent, raw.currentEvent);
});

test("native signature encounters require their registered template and response metadata", async (t) => {
  const signatureState = () => {
    const state = currentState();
    state.currentEvent = {
      id: "signature-card-encounter",
      templateId: SIGNATURE_USE_TEMPLATE_ID,
      kind: "signature",
      sourceId: "one",
      sourceName: "One",
      title: "One uses the revealed Counterspell.",
      prompt: "Resolve the exact previously revealed card.",
      card: "Counterspell",
      tags: ["Signature follow-through", "Previously revealed"],
      responseOptions: ["custom"],
      emptyOutcome: "There was no legal opportunity to use the revealed card in the current playtest state.",
    };
    state.responseStage = "prompt";
    return state;
  };
  const cases = [
    ["unknown template", (state) => { state.currentEvent.templateId = "unknown-signature"; }],
    ["wrong response", (state) => { state.currentEvent.responseOptions = ["counter"]; }],
    ["wrong empty outcome", (state) => { state.currentEvent.emptyOutcome = "Tampered"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const state = signatureState();
      mutate(state);
      assert.equal(decodeGameState(state), null);
    });
  }
});

test("representative v1-v5 states migrate fields and canonical copy without losing identity or ledgers", async (t) => {
  const canonical = eventFromTemplate("destroy-creature");
  for (const version of [1, 2, 3, 4, 5]) {
    await t.test(`v${version}`, () => {
      const raw = legacyState(version);
      const decoded = decodeGameState(raw);

      assert.ok(decoded);
      assert.equal(decoded.version, 6);
      assert.equal(decoded.seed, raw.seed);
      assert.equal(decoded.currentEvent.id, raw.currentEvent.id);
      assert.equal(decoded.currentEvent.templateId, raw.currentEvent.templateId);
      assert.equal(decoded.currentEvent.sourceId, raw.currentEvent.sourceId);
      assert.equal(decoded.currentEvent.sourceName, raw.currentEvent.sourceName);
      assert.deepEqual(decoded.currentEvent.tags, ["Preserved legacy context"]);
      for (const field of ["title", "prompt", "card", "responseOptions", "emptyOutcome"]) {
        assert.deepEqual(decoded.currentEvent[field], canonical[field], field);
      }
      assert.deepEqual(decoded.userCommanderDamage, raw.userCommanderDamage);
      assert.deepEqual(decoded.opponents.map(({ life }) => life), raw.opponents.map(({ life }) => life));
      assert.deepEqual(decoded.opponents.map(({ poisonCounters }) => poisonCounters), version < 5 ? [0, 0] : [2, 0]);
      assert.equal(decoded.userPoisonCounters, version < 5 ? 0 : 3);
      assert.equal(decoded.counterExchange, 0);
      assert.equal(decoded.userLossProtected, false);
      assert.deepEqual(decoded.opponents.map(({ lossProtected }) => lossProtected), [false, false]);
      assert.equal(decoded.answeredCount, version < 3 ? 1 : 2);
      assert.equal(decoded.combatResolvedTurn, 6);
      assert.deepEqual(decoded.opponents.map(({ bracket }) => bracket), version === 1 ? [3, 3] : [4, 2]);
      assert.deepEqual(decoded.history, raw.history);
    });
  }
});

test("legacy-only new fields cannot smuggle values and v5 poison data remains intact", () => {
  const v4 = legacyState(4);
  v4.userPoisonCounters = 9;
  v4.counterExchange = 17;
  v4.userLossProtected = true;
  v4.opponents[0].poisonCounters = 8;
  v4.opponents[0].lossProtected = true;

  const decodedV4 = decodeGameState(v4);
  assert.ok(decodedV4);
  assert.equal(decodedV4.userPoisonCounters, 0);
  assert.equal(decodedV4.counterExchange, 0);
  assert.equal(decodedV4.userLossProtected, false);
  assert.equal(decodedV4.opponents[0].poisonCounters, 0);
  assert.equal(decodedV4.opponents[0].lossProtected, false);

  const legacyCounterback = legacyState(4);
  legacyCounterback.responseStage = "counterback";
  legacyCounterback.counterExchange = 1;
  const decodedCounterback = decodeGameState(legacyCounterback);
  assert.ok(decodedCounterback);
  assert.equal(decodedCounterback.counterExchange, 1);

  const v5 = legacyState(5);
  v5.userLossProtected = true;
  v5.opponents[0].lossProtected = true;
  const decodedV5 = decodeGameState(v5);
  assert.ok(decodedV5);
  assert.equal(decodedV5.userPoisonCounters, 3);
  assert.equal(decodedV5.opponents[0].poisonCounters, 2);
  assert.equal(decodedV5.userLossProtected, false);
  assert.equal(decodedV5.opponents[0].lossProtected, false);
});

test("legacy lethal totals normalize to losses while inconsistent native v6 totals fail closed", () => {
  const legacyUser = legacyState(5);
  legacyUser.userLife = 0;
  const decodedUser = decodeGameState(legacyUser);
  assert.ok(decodedUser);
  assert.equal(decodedUser.userLossProtected, false);
  assert.match(decodedUser.gameOver, /reached 0 life/);

  const legacyOpponent = legacyState(5);
  legacyOpponent.opponents[0].poisonCounters = 10;
  legacyOpponent.opponents[0].eliminated = false;
  const decodedOpponent = decodeGameState(legacyOpponent);
  assert.ok(decodedOpponent);
  assert.equal(decodedOpponent.opponents[0].lossProtected, false);
  assert.equal(decodedOpponent.opponents[0].eliminated, true);
  assert.equal(decodedOpponent.responseStage, "resolved");

  const nativeUser = currentState();
  nativeUser.userLife = 0;
  nativeUser.userLossProtected = false;
  assert.equal(decodeGameState(nativeUser), null);
  nativeUser.userLossProtected = true;
  assert.ok(decodeGameState(nativeUser));

  const nativeOpponent = currentState();
  nativeOpponent.opponents[0].poisonCounters = 10;
  nativeOpponent.opponents[0].lossProtected = false;
  nativeOpponent.opponents[0].eliminated = false;
  assert.equal(decodeGameState(nativeOpponent), null);
  nativeOpponent.opponents[0].lossProtected = true;
  assert.ok(decodeGameState(nativeOpponent));
});

test("Toxic Deluge payment is locked across reload and validated against its encounter", () => {
  const raw = currentState();
  raw.currentEvent = eventFromTemplate("minus-wipe");
  raw.responseStage = "counterback";
  raw.counterExchange = 2;
  raw.toxicDelugePayment = { eventId: raw.currentEvent.id, amount: 7 };

  const decoded = decodeGameState(JSON.parse(JSON.stringify(raw)));
  assert.ok(decoded);
  assert.deepEqual(decoded.toxicDelugePayment, { eventId: raw.currentEvent.id, amount: 7 });

  const wrongEvent = structuredClone(raw);
  wrongEvent.toxicDelugePayment.eventId = "another-event";
  assert.equal(decodeGameState(wrongEvent), null);

  const promptWithPayment = structuredClone(raw);
  promptWithPayment.responseStage = "prompt";
  promptWithPayment.counterExchange = 0;
  assert.equal(decodeGameState(promptWithPayment), null);

  const missingLockedPayment = structuredClone(raw);
  missingLockedPayment.toxicDelugePayment = null;
  assert.equal(decodeGameState(missingLockedPayment), null);
});

test("pre-field v6 and legacy Toxic Deluge drafts migrate without inventing X", () => {
  const ordinaryV6 = currentState();
  delete ordinaryV6.toxicDelugePayment;
  assert.equal(decodeGameState(ordinaryV6)?.toxicDelugePayment, null);

  const toxicV6 = currentState();
  toxicV6.currentEvent = eventFromTemplate("minus-wipe");
  toxicV6.responseStage = "counterback";
  toxicV6.counterExchange = 3;
  delete toxicV6.toxicDelugePayment;
  const decodedV6 = decodeGameState(toxicV6);
  assert.ok(decodedV6);
  assert.equal(decodedV6.responseStage, "prompt");
  assert.equal(decodedV6.counterExchange, 0);
  assert.equal(decodedV6.toxicDelugePayment, null);
  assert.match(decodedV6.resolution, /Re-enter Toxic Deluge/);

  const toxicV5 = legacyState(5);
  toxicV5.currentEvent = eventFromTemplate("minus-wipe");
  toxicV5.responseStage = "choose";
  const decodedV5 = decodeGameState(toxicV5);
  assert.ok(decodedV5);
  assert.equal(decodedV5.responseStage, "prompt");
  assert.equal(decodedV5.counterExchange, 0);
  assert.equal(decodedV5.toxicDelugePayment, null);
});

test("legacy response metadata migrates by template before uniqueness checks", () => {
  const livingDeath = legacyState(4);
  livingDeath.currentEvent = eventFromTemplate("living-death");
  delete livingDeath.currentEvent.responseOptions;
  delete livingDeath.currentEvent.emptyOutcome;
  const decodedWipe = decodeGameState(livingDeath);
  assert.ok(decodedWipe);
  assert.deepEqual(decodedWipe.currentEvent.responseOptions, ["counter", "protect", "custom"]);
  assert.equal(decodedWipe.currentEvent.emptyOutcome, "No creature card or creature you control changed zones during resolution.");

  const duplicateV5 = legacyState(5);
  duplicateV5.currentEvent.responseOptions = ["counter", "counter"];
  assert.deepEqual(decodeGameState(duplicateV5)?.currentEvent.responseOptions, ["counter", "protect", "redirect", "custom"]);

  const attack = legacyState(4);
  makeAttack(attack);
  delete attack.currentEvent.responseOptions;
  const decodedAttack = decodeGameState(attack);
  assert.ok(decodedAttack);
  assert.deepEqual(decodedAttack.currentEvent.responseOptions, []);

  const unknown = legacyState(4);
  unknown.currentEvent.templateId = "unknown-legacy-template";
  assert.equal(decodeGameState(unknown), null);
});

test("legacy threat copy is canonicalized while instance, source, tags, and countdown identity survive", () => {
  const raw = legacyState(5);
  makeThreat(raw);
  raw.currentEvent.id = "legacy-event-instance";
  raw.currentEvent.tags = ["B5 cEDH", "Preserve me"];
  raw.currentEvent.title = "Old event title";
  raw.currentEvent.prompt = "Old event prompt";
  raw.currentEvent.card = "Old event card";
  raw.currentEvent.responseOptions = ["counter"];
  raw.currentEvent.emptyOutcome = "Old event outcome";
  raw.currentEvent.threat = {
    ...raw.currentEvent.threat,
    id: "legacy-threat-instance",
    ownerId: "two",
    title: "Old threat title",
    description: "Old threat description",
    remaining: 3,
    delayed: true,
  };
  raw.responseStage = "resolved";
  raw.activeThreat = { ...raw.currentEvent.threat, remaining: 2, delayed: false };

  const decoded = decodeGameState(raw);
  const canonical = eventFromTemplate("combo-clock");
  assert.ok(decoded);
  assert.equal(decoded.currentEvent.id, "legacy-event-instance");
  assert.equal(decoded.currentEvent.sourceId, "one");
  assert.deepEqual(decoded.currentEvent.tags, ["B5 cEDH", "Preserve me"]);
  assert.equal(decoded.currentEvent.title, canonical.title);
  assert.equal(decoded.currentEvent.prompt, canonical.prompt);
  assert.equal(decoded.currentEvent.card, canonical.card);
  assert.deepEqual(decoded.currentEvent.responseOptions, canonical.responseOptions);
  assert.equal(decoded.currentEvent.emptyOutcome, canonical.emptyOutcome);
  assert.deepEqual(decoded.currentEvent.threat, {
    id: "legacy-threat-instance",
    ownerId: "one",
    title: canonical.title,
    description: canonical.prompt,
    remaining: 3,
    delayed: true,
  });
  assert.deepEqual(decoded.activeThreat, {
    id: "legacy-threat-instance",
    ownerId: "one",
    title: canonical.title,
    description: canonical.prompt,
    remaining: 2,
    delayed: false,
  });
});

test("native v6 known-template metadata and threat copy must be canonical", async (t) => {
  const eventCases = [
    ["title", (state) => { state.currentEvent.title = "Tampered"; }],
    ["prompt", (state) => { state.currentEvent.prompt = "Tampered"; }],
    ["card", (state) => { state.currentEvent.card = "Tampered"; }],
    ["response option membership", (state) => { state.currentEvent.responseOptions = ["custom"]; }],
    ["response option order", (state) => { state.currentEvent.responseOptions.reverse(); }],
    ["empty outcome", (state) => { state.currentEvent.emptyOutcome = "Tampered"; }],
    ["template kind", (state) => { state.currentEvent.kind = "wipe"; }],
  ];
  for (const [name, mutate] of eventCases) {
    await t.test(name, () => {
      const state = currentState();
      mutate(state);
      assert.equal(decodeGameState(state), null);
    });
  }

  for (const [name, mutate] of [
    ["threat owner", (state) => { state.currentEvent.threat.ownerId = "two"; }],
    ["threat title", (state) => { state.currentEvent.threat.title = "Tampered"; }],
    ["threat description", (state) => { state.currentEvent.threat.description = "Tampered"; }],
  ]) {
    await t.test(name, () => {
      const state = currentState();
      makeThreat(state);
      mutate(state);
      assert.equal(decodeGameState(state), null);
    });
  }
});

test("missing native v6 poison, counter, and protection fields fail closed", async (t) => {
  const cases = [
    ["user poison", (state) => { delete state.userPoisonCounters; }],
    ["opponent poison", (state) => { delete state.opponents[0].poisonCounters; }],
    ["counter exchange", (state) => { delete state.counterExchange; }],
    ["user protection", (state) => { delete state.userLossProtected; }],
    ["opponent protection", (state) => { delete state.opponents[0].lossProtected; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const state = currentState();
      mutate(state);
      assert.equal(decodeGameState(state), null);
    });
  }
});

test("legacy commander attackers gain the source primary identity and existing identities survive", () => {
  const raw = legacyState(4);
  makeAttack(raw);
  delete raw.currentEvent.responseOptions;
  raw.currentEvent.attackers = [
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
  ];

  const decoded = decodeGameState(raw);
  assert.ok(decoded);
  assert.equal(decoded.currentEvent.attackers[0].commanderId, "opponent:one:commander");
  assert.equal(decoded.currentEvent.attackers[0].commanderLabel, "One’s primary commander");
  assert.equal(decoded.currentEvent.attackers[1].commanderId, "opponent:two:partner:commander");
  assert.equal(decoded.currentEvent.attackers[1].commanderLabel, "Two's partner");
  assert.equal(decoded.userCommanderDamage["opponent:one:commander"], 8);
  assert.equal(decoded.userCommanderDamage["opponent:two:partner:commander"], 4);
});

test("valid safe-integer boundaries and positive owned threats are accepted", () => {
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

test("allowed event-kind and response-stage combinations decode", async (t) => {
  const cases = [
    ["attack prompt", (state) => makeAttack(state), "prompt"],
    ["attack combat", (state) => makeAttack(state), "combat"],
    ["attack resolved", (state) => makeAttack(state), "resolved"],
    ["development prompt", (state) => makeDevelopment(state), "prompt"],
    ["development resolved", (state) => makeDevelopment(state), "resolved"],
    ["noncombat prompt", () => {}, "prompt"],
    ["noncombat choose", () => {}, "choose"],
    ["noncombat counterback", () => {}, "counterback"],
    ["noncombat resolved", () => {}, "resolved"],
  ];
  for (const [name, arrange, stage] of cases) {
    await t.test(name, () => {
      const state = currentState();
      arrange(state);
      state.responseStage = stage;
      state.counterExchange = stage === "counterback" ? 1 : state.counterExchange;
      assert.ok(decodeGameState(state));
    });
  }
});

test("a resolved event may remain visible after its source is eliminated", () => {
  const raw = currentState();
  raw.responseStage = "resolved";
  raw.currentEvent = eventFromTemplate("destroy-creature", "two", "Two");

  assert.ok(decodeGameState(raw));
});

test("a resolved threat may match the active threat, but a pending or different second threat cannot", () => {
  const resolved = currentState();
  makeThreat(resolved, "resolved");
  assert.ok(decodeGameState(resolved));

  const pending = structuredClone(resolved);
  pending.responseStage = "prompt";
  assert.equal(decodeGameState(pending), null);

  const different = structuredClone(resolved);
  different.activeThreat.id = "another-threat";
  assert.equal(decodeGameState(different), null);
});

test("a legacy terminal draft with an expired active threat migrates to a cleared v6 threat", () => {
  const raw = legacyState(5);
  raw.activeThreat.remaining = 0;
  raw.gameOver = "The delayed threat resolved.";

  const decoded = decodeGameState(raw);
  assert.ok(decoded);
  assert.equal(decoded.version, GAME_STATE_VERSION);
  assert.equal(decoded.activeThreat, null);
  assert.equal(decoded.gameOver, "The delayed threat resolved.");

  const blankTerminal = legacyState(5);
  blankTerminal.activeThreat.remaining = 0;
  blankTerminal.gameOver = "";
  assert.equal(decodeGameState(blankTerminal), null);
});

test("table elimination is terminal in native v6 and normalized for legacy drafts", () => {
  const native = currentState();
  native.opponents = native.opponents.map((opponent) => ({ ...opponent, eliminated: true }));
  native.activeThreat = null;
  native.responseStage = "resolved";
  native.gameOver = null;
  assert.equal(decodeGameState(native), null);

  const legacy = legacyState(5);
  legacy.opponents = legacy.opponents.map((opponent) => ({ ...opponent, eliminated: true }));
  legacy.activeThreat = null;
  legacy.responseStage = "resolved";
  legacy.gameOver = null;
  const decoded = decodeGameState(legacy);
  assert.ok(decoded);
  assert.equal(decoded.gameOver, "You eliminated every simulated opponent.");
});

test("structural duplicate classes and cross-field contradictions fail closed", async (t) => {
  const cases = [
    ["four opponents", (state) => { state.opponents.push({ ...structuredClone(state.opponents[0]), id: "three", name: "Three" }, { ...structuredClone(state.opponents[0]), id: "four", name: "Four" }); }],
    ["duplicate opponent ID", (state) => { state.opponents[1].id = "one"; }],
    ["duplicate attacker ID", (state) => { makeAttack(state); state.currentEvent.attackers.push({ ...state.currentEvent.attackers[0] }); }],
    ["duplicate commander identity", (state) => {
      makeAttack(state);
      const commander = { ...state.currentEvent.attackers[0], isCommander: true, commanderId: "opponent:one:commander", commanderLabel: "One’s primary commander" };
      state.currentEvent.attackers = [commander, { ...commander, id: "attacker-two" }];
    }],
    ["unlabeled foreign commander identity", (state) => {
      makeAttack(state);
      state.currentEvent.attackers[0] = { ...state.currentEvent.attackers[0], name: "", isCommander: true, commanderId: "foreign:commander" };
    }],
    ["duplicate response option", (state) => { state.currentEvent.templateId = "unknown-native"; state.currentEvent.responseOptions = ["counter", "counter"]; }],
    ["noncombat without response metadata", (state) => { state.currentEvent.templateId = "unknown-native"; state.currentEvent.responseOptions = []; }],
    ["duplicate history ID", (state) => { state.history[1].id = state.history[0].id; }],
    ["source-name disagreement", (state) => { state.currentEvent.sourceName = "Not One"; }],
    ["attack choose stage", (state) => { makeAttack(state); state.responseStage = "choose"; }],
    ["attack counterback stage", (state) => { makeAttack(state); state.responseStage = "counterback"; state.counterExchange = 1; }],
    ["development choose stage", (state) => { makeDevelopment(state); state.responseStage = "choose"; }],
    ["development combat stage", (state) => { makeDevelopment(state); state.responseStage = "combat"; }],
    ["development template on attack", (state) => { makeAttack(state); state.currentEvent.templateId = "table-development"; }],
    ["attack template on development", (state) => { makeDevelopment(state); state.currentEvent.templateId = "scaled-attack"; }],
    ["signature template on attack", (state) => { makeAttack(state); state.currentEvent.templateId = SIGNATURE_USE_TEMPLATE_ID; }],
    ["noncombat combat stage", (state) => { state.responseStage = "combat"; }],
    ["counterback without counter metadata", (state) => { state.currentEvent.templateId = "unknown-native"; state.currentEvent.responseOptions = ["custom"]; state.responseStage = "counterback"; state.counterExchange = 1; }],
    ["counterback without an exchange", (state) => { state.responseStage = "counterback"; state.counterExchange = 0; }],
    ["zero active threat clock", (state) => { state.activeThreat.remaining = 0; }],
    ["zero event threat clock", (state) => { makeThreat(state); state.currentEvent.threat.remaining = 0; }],
    ["eliminated active threat owner", (state) => { state.activeThreat.ownerId = "two"; }],
    ["event threat owner differs from source", (state) => { makeThreat(state); state.currentEvent.threat.ownerId = "two"; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const state = currentState();
      mutate(state);
      assert.equal(decodeGameState(state), null);
    });
  }
});

test("malformed current state fails closed at every persistence boundary", async (t) => {
  const cases = [
    ["unsupported version", (state) => { state.version = 7; }],
    ["fractional version", (state) => { state.version = 5.5; }],
    ["zero turn", (state) => { state.turn = 0; }],
    ["unsafe event counter", (state) => { state.eventCounter = Number.MAX_SAFE_INTEGER + 1; }],
    ["negative defense counter", (state) => { state.defenseCounter = -1; }],
    ["non-string seed", (state) => { state.seed = null; }],
    ["empty opponents", (state) => { state.opponents = []; }],
    ["unknown profile", (state) => { state.opponents[0].profile = "ramp"; }],
    ["missing bracket", (state) => { delete state.opponents[0].bracket; }],
    ["unknown bracket", (state) => { state.opponents[0].bracket = 6; }],
    ["empty opponent ID", (state) => { state.opponents[0].id = "   "; }],
    ["string damage ledger", (state) => { state.userCommanderDamage["opponent:one:commander"] = "8"; }],
    ["negative damage ledger", (state) => { state.opponents[0].commanderDamage["user:primary:commander"] = -1; }],
    ["array damage ledger", (state) => { state.userCommanderDamage = []; }],
    ["non-finite life", (state) => { state.userLife = Number.POSITIVE_INFINITY; }],
    ["unsafe opponent life", (state) => { state.opponents[0].life = Number.MIN_SAFE_INTEGER - 1; }],
    ["non-boolean elimination", (state) => { state.opponents[0].eliminated = 0; }],
    ["non-boolean user protection", (state) => { state.userLossProtected = 1; }],
    ["non-boolean opponent protection", (state) => { state.opponents[0].lossProtected = 1; }],
    ["non-finite ledger", (state) => { state.userCommanderDamage.bad = Number.NaN; }],
    ["unsafe ledger", (state) => { state.userCommanderDamage.bad = Number.MAX_SAFE_INTEGER + 1; }],
    ["ill-formed commander identity", (state) => { state.userCommanderDamage["\uD800"] = 1; }],
    ["fractional counter", (state) => { state.defenseCounter = 1.5; }],
    ["negative poison", (state) => { state.userPoisonCounters = -1; }],
    ["string opponent poison", (state) => { state.opponents[0].poisonCounters = "2"; }],
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
    ["empty attack", (state) => { makeAttack(state); state.currentEvent.attackers = []; }],
    ["fractional attacker power", (state) => { makeAttack(state); state.currentEvent.attackers[0].power = 1.5; }],
    ["unknown attacker keyword", (state) => { makeAttack(state); state.currentEvent.attackers[0].keywords = ["Ward"]; }],
    ["empty commander identity", (state) => { makeAttack(state); state.currentEvent.attackers[0].isCommander = true; state.currentEvent.attackers[0].commanderId = ""; }],
    ["missing commander identity", (state) => { makeAttack(state); state.currentEvent.attackers[0].isCommander = true; }],
    ["identity on a noncommander", (state) => { makeAttack(state); state.currentEvent.attackers[0].commanderId = "commander"; }],
    ["unknown active threat owner", (state) => { state.activeThreat.ownerId = "gone"; }],
    ["unresolved event from eliminated source", (state) => { state.currentEvent = eventFromTemplate("destroy-creature", "two", "Two"); }],
    ["threat event without a threat", (state) => { makeThreat(state); delete state.currentEvent.threat; }],
    ["unknown event threat owner", (state) => { makeThreat(state); state.currentEvent.threat.ownerId = "gone"; }],
    ["threat attached to another event kind", (state) => { state.currentEvent.threat = structuredClone(state.activeThreat); }],
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
    ["unknown response option", (state) => { state.currentEvent.templateId = "unknown-native"; state.currentEvent.responseOptions = ["sacrifice"]; }],
    ["non-string empty outcome", (state) => { state.currentEvent.emptyOutcome = 3; }],
    ["non-string game over", (state) => { state.gameOver = false; }],
    ["empty game over", (state) => { state.gameOver = ""; }],
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
