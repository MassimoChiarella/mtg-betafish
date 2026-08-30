import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultCombatDamageSteps,
  COMMANDER_BRACKETS,
  counterBacks,
  EVENT_TEMPLATES,
  generateEvent,
  KEYWORD_DEFINITIONS,
  nonnegativeSafeInteger,
  opponentCommanderKey,
  resolveCombatDamage,
  rollDefense,
  userCommanderKey,
} from "../app/simulator.ts";

const state = (overrides = {}) => ({ life: 40, poisonCounters: 0, commanderDamage: {}, ...overrides });
const attacker = (overrides = {}) => ({ id: "attacker", name: "Attacker", power: 1, toughness: 1, keywords: [], isCommander: false, ...overrides });

test("tracked amounts reject invalid numbers while ordered combat accepts safe results", () => {
  assert.equal(nonnegativeSafeInteger(0), 0);
  assert.equal(nonnegativeSafeInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
    assert.equal(nonnegativeSafeInteger(value), null);
  }

  const modified = resolveCombatDamage({
    state: state(),
    steps: [{ step: "regular", lifeDamage: 10, commanderHits: {}, poisonCounters: 0, lifelinkGain: 0 }],
  });
  assert.equal(modified.life, 30, "a safe damage result is not capped by modeled power");
});

test("primary commander keys remain compatible and Partner identities stay separate", () => {
  assert.equal(opponentCommanderKey("mara"), "opponent:mara:commander");
  assert.equal(opponentCommanderKey("mara", "primary"), "opponent:mara:commander");
  assert.equal(opponentCommanderKey("mara", "partner"), "opponent:mara:partner:commander");
  assert.notEqual(userCommanderKey("primary"), userCommanderKey("partner"));

  const primary = opponentCommanderKey("mara");
  const partner = opponentCommanderKey("mara", "partner");
  const split = resolveCombatDamage({
    state: state(),
    steps: [{ step: "regular", lifeDamage: 22, commanderHits: { [primary]: 11, [partner]: 11 }, poisonCounters: 0, lifelinkGain: 0 }],
  });
  assert.equal(split.defeated, false);
  assert.deepEqual(split.commanderDamage, { [primary]: 11, [partner]: 11 });

  const lethal = resolveCombatDamage({
    state: state({ commanderDamage: { [primary]: 20 } }),
    steps: [{ step: "regular", lifeDamage: 1, commanderHits: { [primary]: 1 }, poisonCounters: 0, lifelinkGain: 0 }],
  });
  assert.equal(lethal.defeated, true);
  assert.equal(lethal.lossReason, "commander");
  assert.equal(lethal.lethalCommander, primary);
});

test("double strike resolves first-strike damage and loss before regular damage", () => {
  const commanderId = "commander:alpha";
  const defaults = buildDefaultCombatDamageSteps([
    attacker({ power: 21, toughness: 21, isCommander: true, commanderId, keywords: ["Double strike", "Lifelink"] }),
  ]);
  assert.deepEqual(defaults.map(({ step }) => step), ["first", "regular"]);
  assert.deepEqual(defaults.map(({ lifeDamage }) => lifeDamage), [21, 21]);
  assert.deepEqual(defaults.map(({ lifelinkGain }) => lifelinkGain), [21, 21]);

  const result = resolveCombatDamage({ state: state(), steps: defaults });
  assert.equal(result.life, 19);
  assert.equal(result.commanderDamage[commanderId], 21);
  assert.equal(result.lifelinkGain, 21);
  assert.equal(result.defeated, true);
  assert.equal(result.lossReason, "commander");
  assert.deepEqual(result.stepsApplied, ["first"]);

  const existingTen = resolveCombatDamage({ state: state({ commanderDamage: { [commanderId]: 10 } }), steps: buildDefaultCombatDamageSteps([
    attacker({ power: 11, isCommander: true, commanderId, keywords: ["Double strike"] }),
  ]) });
  assert.equal(existingTen.commanderDamage[commanderId], 21);
  assert.deepEqual(existingTen.stepsApplied, ["first"]);
});

test("nonlethal double strike applies both steps and loss prevention keeps later steps", () => {
  const commanderId = "commander:beta";
  const defaults = buildDefaultCombatDamageSteps([
    attacker({ power: 5, isCommander: true, commanderId, keywords: ["Double strike", "Lifelink"] }),
  ]);
  const nonlethal = resolveCombatDamage({ state: state(), steps: defaults });
  assert.equal(nonlethal.life, 30);
  assert.equal(nonlethal.commanderDamage[commanderId], 10);
  assert.equal(nonlethal.lifelinkGain, 10);
  assert.deepEqual(nonlethal.stepsApplied, ["first", "regular"]);

  const lethalDefaults = buildDefaultCombatDamageSteps([
    attacker({ power: 21, isCommander: true, commanderId, keywords: ["Double strike", "Lifelink"] }),
  ]);
  const prevented = resolveCombatDamage({ state: state(), steps: lethalDefaults, lossPrevented: true });
  assert.equal(prevented.life, -2);
  assert.equal(prevented.commanderDamage[commanderId], 42);
  assert.equal(prevented.lifelinkGain, 42);
  assert.equal(prevented.defeated, false);
  assert.equal(prevented.lossReason, null);
  assert.deepEqual(prevented.stepsApplied, ["first", "regular"]);
});

test("life, poison, commander damage, and lifelink are independent results", () => {
  const blockedLifelink = resolveCombatDamage({
    state: state(),
    steps: [{ step: "regular", lifeDamage: 0, commanderHits: {}, poisonCounters: 0, lifelinkGain: 5 }],
  });
  assert.equal(blockedLifelink.life, 40);
  assert.equal(blockedLifelink.lifeDamage, 0);
  assert.equal(blockedLifelink.lifelinkGain, 5);

  const commanderId = "commander:infect";
  const infectDefaults = buildDefaultCombatDamageSteps([
    attacker({ power: 5, isCommander: true, commanderId, keywords: ["Infect", "Lifelink"] }),
  ]);
  assert.deepEqual(infectDefaults, [{ step: "regular", lifeDamage: 0, commanderHits: { [commanderId]: 5 }, poisonCounters: 5, lifelinkGain: 5 }]);
  const infected = resolveCombatDamage({ state: state(), steps: infectDefaults });
  assert.equal(infected.life, 40);
  assert.equal(infected.poisonCounters, 5);
  assert.equal(infected.commanderDamage[commanderId], 5);
  assert.equal(infected.lifelinkGain, 5);

  const poisonLoss = resolveCombatDamage({
    state: state({ poisonCounters: 5, commanderDamage: infected.commanderDamage }),
    steps: infectDefaults,
  });
  assert.equal(poisonLoss.life, 40);
  assert.equal(poisonLoss.poisonCounters, 10);
  assert.equal(poisonLoss.lossReason, "poison");

  const manualPoison = resolveCombatDamage({
    state: state(),
    steps: [{ step: "regular", lifeDamage: 2, commanderHits: {}, poisonCounters: 3, lifelinkGain: 0 }],
  });
  assert.equal(manualPoison.life, 38);
  assert.equal(manualPoison.poisonCounters, 3);
});

test("first-strike lethal suppresses ordinary attackers in the regular step", () => {
  const defaults = buildDefaultCombatDamageSteps([
    attacker({ id: "first", power: 40, keywords: ["First strike"] }),
    attacker({ id: "regular", power: 7 }),
  ]);
  const result = resolveCombatDamage({ state: state(), steps: defaults });
  assert.equal(result.lifeDamage, 40);
  assert.deepEqual(result.stepsApplied, ["first"]);
  assert.equal(result.life, 0);
});

test("the ordered resolver normalizes malformed step amounts at its public boundary", () => {
  const result = resolveCombatDamage({
    state: { life: 40, poisonCounters: Number.NaN, commanderDamage: { A: -2 } },
    steps: [{ step: "regular", lifeDamage: -4, commanderHits: { A: 1.5, B: Number.MAX_SAFE_INTEGER + 1 }, poisonCounters: Number.POSITIVE_INFINITY, lifelinkGain: -1 }],
  });
  assert.equal(result.life, 40);
  assert.equal(result.poisonCounters, 0);
  assert.deepEqual(result.commanderDamage, { A: 0, B: 0 });
  assert.equal(result.lifelinkGain, 0);
  assert.equal(result.defeated, false);
});

test("Menace defense never supplies a single blocker", () => {
  const result = rollDefense({
    profile: "swarm", bracket: 3, seed: "MENACE", turn: 3, counter: 4,
    attackers: [{ name: "Menace attacker", power: 3, keywords: ["Menace"] }],
  });
  assert.equal(result.type, "block");
  assert.doesNotMatch(result.title, /^1 blocker$/);
  assert.ok(Number.parseInt(result.title, 10) >= 2);
});

test("events expose intentional response metadata and corrected rules-reference copy", () => {
  assert.ok(EVENT_TEMPLATES.every((template) => template.responseOptions.length > 0 && template.emptyOutcome.length > 0));
  const livingDeath = EVENT_TEMPLATES.find(({ id }) => id === "living-death");
  assert.equal(livingDeath.responseOptions.includes("redirect"), false);
  assert.ok(EVENT_TEMPLATES.filter(({ kind }) => kind === "wipe").every(({ responseOptions }) => !responseOptions.includes("redirect")));

  const nature = EVENT_TEMPLATES.find(({ id }) => id === "early-rock");
  assert.match(nature.prompt, /artifact or enchantment/i);
  assert.match(nature.prompt, /gains 4 life/i);
  assert.doesNotMatch(nature.prompt, /mana creature/i);

  const goad = EVENT_TEMPLATES.find(({ id }) => id === "goad");
  assert.match(goad.prompt, /each creature/i);
  assert.match(goad.prompt, /until the acting opponent’s next turn/i);

  const requiredConsequences = {
    "destroy-creature": /3\/3 green Beast creature token/i,
    "exile-commander": /life equal to its power/i,
    "remove-engine": /loses 3 life/i,
    "counter-commander": /draw up to two cards[\s\S]*draws one card/i,
    "minus-wipe": /pays X life as an additional cost/i,
    "destroy-wipe": /can’t be regenerated/i,
    "artifact-sweep": /acting opponent doesn’t control/i,
  };
  for (const [id, pattern] of Object.entries(requiredConsequences)) assert.match(EVENT_TEMPLATES.find((template) => template.id === id).prompt, pattern);
  assert.match(KEYWORD_DEFINITIONS.Deathtouch, /nonzero amount/i);
  assert.ok(Object.values(COMMANDER_BRACKETS).every(({ turnGuide }) => !/at least/i.test(turnGuide)));

  const opponent = { id: "one", name: "One", profile: "voltron", bracket: 5, life: 40, commanderDamage: {}, eliminated: false };
  let generatedCommander;
  for (let counter = 0; counter < 500 && !generatedCommander; counter += 1) {
    const event = generateEvent({ turn: 10, counter, seed: "IDENTITY", opponents: [opponent], recentTemplateIds: [], activeThreat: false });
    assert.ok(Array.isArray(event.responseOptions));
    generatedCommander = event.attackers?.find(({ isCommander }) => isCommander);
  }
  assert.ok(generatedCommander);
  assert.equal(generatedCommander.commanderId, opponentCommanderKey(opponent.id));
  assert.equal(generatedCommander.commanderLabel, "One’s commander");
});

test("counterback rolls accept arbitrary exchange indices deterministically", () => {
  for (const exchange of [1, 2, 3, 4, 20]) {
    const input = { profile: "control", bracket: 5, seed: "STACK", turn: 7, eventCounter: 9, exchange };
    assert.equal(counterBacks(input), counterBacks(input));
  }
  const eventScoped = Array.from({ length: 64 }, (_, eventCounter) => counterBacks({
    profile: "control",
    bracket: 5,
    seed: "STACK-EVENTS",
    turn: 7,
    eventCounter,
    exchange: 3,
  }));
  assert.equal(counterBacks({ profile: "control", bracket: 5, seed: "STACK-EVENTS", turn: 7, eventCounter: 9, exchange: 3 }), eventScoped[9]);
  assert.equal(new Set(eventScoped).size, 2, "event identity should participate in the counter-exchange replay key");
});
