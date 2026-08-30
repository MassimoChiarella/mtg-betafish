import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultCombatDamageSteps,
  nonnegativeSafeInteger,
  resolveCombatDamage,
} from "../app/simulator.ts";

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
}

function attacker(index, overrides = {}) {
  return {
    id: `attacker-${index}`,
    name: `Attacker ${index}`,
    power: 1,
    toughness: 1,
    keywords: [],
    isCommander: false,
    ...overrides,
  };
}

function expectedDefaults(attackers) {
  const first = { step: "first", lifeDamage: 0, commanderHits: {}, poisonCounters: 0, lifelinkGain: 0 };
  const regular = { step: "regular", lifeDamage: 0, commanderHits: {}, poisonCounters: 0, lifelinkGain: 0 };
  let hasFirst = false;
  let hasRegular = false;

  const add = (step, creature) => {
    if (creature.keywords.includes("Infect")) step.poisonCounters += creature.power;
    else step.lifeDamage += creature.power;
    if (creature.isCommander) step.commanderHits[creature.commanderId] = (step.commanderHits[creature.commanderId] ?? 0) + creature.power;
    if (creature.keywords.includes("Lifelink")) step.lifelinkGain += creature.power;
  };

  for (const creature of attackers) {
    const firstStrike = creature.keywords.includes("First strike");
    const doubleStrike = creature.keywords.includes("Double strike");
    if (firstStrike || doubleStrike) {
      hasFirst = true;
      add(first, creature);
    }
    if (!firstStrike || doubleStrike) {
      hasRegular = true;
      add(regular, creature);
    }
  }
  return [...(hasFirst ? [first] : []), ...(hasRegular ? [regular] : [])];
}

test("safe-integer boundaries are exact and combat totals saturate safely", () => {
  assert.equal(nonnegativeSafeInteger(0), 0);
  assert.equal(nonnegativeSafeInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const invalid of [-1, 0.5, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) {
    assert.equal(nonnegativeSafeInteger(invalid), null);
  }

  const id = "commander:max";
  const defaults = buildDefaultCombatDamageSteps([
    attacker(0, { power: Number.MAX_SAFE_INTEGER, isCommander: true, commanderId: id, keywords: ["Double strike", "Lifelink"] }),
    attacker(1, { power: Number.MAX_SAFE_INTEGER, isCommander: true, commanderId: id, keywords: ["Double strike", "Lifelink"] }),
  ]);
  for (const step of defaults) {
    assert.equal(step.lifeDamage, Number.MAX_SAFE_INTEGER);
    assert.equal(step.commanderHits[id], Number.MAX_SAFE_INTEGER);
    assert.equal(step.lifelinkGain, Number.MAX_SAFE_INTEGER);
  }

  const result = resolveCombatDamage({
    state: { life: Number.MAX_SAFE_INTEGER, poisonCounters: 0, commanderDamage: {} },
    steps: defaults,
    lossPrevented: true,
  });
  assert.equal(result.life, Number.MIN_SAFE_INTEGER);
  assert.equal(result.lifeDamage, Number.MAX_SAFE_INTEGER);
  assert.equal(result.commanderDamage[id], Number.MAX_SAFE_INTEGER);
  assert.equal(result.lifelinkGain, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(result.stepsApplied, ["first", "regular"]);
});

test("fixed-seed attacker batches obey strike, Infect, lifelink, and commander-ID properties", () => {
  const random = randomFor(0x5a17e5);
  const integer = (maximum) => Math.floor(random() * maximum);
  for (let run = 0; run < 750; run += 1) {
    const creatures = Array.from({ length: 1 + integer(8) }, (_, index) => {
      const keywords = [];
      if (random() < 0.35) keywords.push("First strike");
      if (random() < 0.35) keywords.push("Double strike");
      if (random() < 0.4) keywords.push("Infect");
      if (random() < 0.5) keywords.push("Lifelink");
      const isCommander = random() < 0.55;
      return attacker(index, {
        power: integer(21),
        toughness: 1 + integer(21),
        keywords,
        isCommander,
        ...(isCommander ? { commanderId: `commander:${integer(4)}` } : {}),
      });
    });
    const creatureSnapshot = structuredClone(creatures);
    const expected = expectedDefaults(creatures);
    const actual = buildDefaultCombatDamageSteps(creatures);
    assert.deepEqual(actual, expected, `default mismatch at run ${run}`);
    assert.deepEqual(creatures, creatureSnapshot, `attackers mutated at run ${run}`);

    const initial = { life: 100_000, poisonCounters: 0, commanderDamage: { baseline: 7 } };
    const initialSnapshot = structuredClone(initial);
    const resolved = resolveCombatDamage({ state: initial, steps: actual, lossPrevented: true });
    const lifeDamage = expected.reduce((sum, step) => sum + step.lifeDamage, 0);
    const poisonAdded = expected.reduce((sum, step) => sum + step.poisonCounters, 0);
    const lifelinkGain = expected.reduce((sum, step) => sum + step.lifelinkGain, 0);
    const commanderDamage = { baseline: 7 };
    for (const step of expected) {
      for (const [id, damage] of Object.entries(step.commanderHits)) commanderDamage[id] = (commanderDamage[id] ?? 0) + damage;
    }

    assert.equal(resolved.life, initial.life - lifeDamage, `life mismatch at run ${run}`);
    assert.equal(resolved.poisonCounters, poisonAdded, `poison mismatch at run ${run}`);
    assert.equal(resolved.lifeDamage, lifeDamage, `life total mismatch at run ${run}`);
    assert.equal(resolved.poisonAdded, poisonAdded, `poison total mismatch at run ${run}`);
    assert.equal(resolved.lifelinkGain, lifelinkGain, `lifelink mismatch at run ${run}`);
    assert.deepEqual(resolved.commanderDamage, commanderDamage, `commander ledger mismatch at run ${run}`);
    assert.deepEqual(resolved.stepsApplied, expected.map(({ step }) => step));
    assert.equal(resolved.defeated, false);
    assert.equal(resolved.lossReason, null);
    assert.deepEqual(initial, initialSnapshot, `combat state mutated at run ${run}`);
    assert.notStrictEqual(resolved.commanderDamage, initial.commanderDamage);
  }
});

test("losses stop between steps unless lossPrevented explicitly keeps resolving", () => {
  const cases = [
    {
      name: "life",
      state: { life: 5, poisonCounters: 0, commanderDamage: {} },
      first: { step: "first", lifeDamage: 5, commanderHits: {}, poisonCounters: 0, lifelinkGain: 5 },
    },
    {
      name: "poison",
      state: { life: 40, poisonCounters: 9, commanderDamage: {} },
      first: { step: "first", lifeDamage: 0, commanderHits: {}, poisonCounters: 1, lifelinkGain: 1 },
    },
    {
      name: "commander",
      state: { life: 40, poisonCounters: 0, commanderDamage: { "commander:lethal": 20 } },
      first: { step: "first", lifeDamage: 1, commanderHits: { "commander:lethal": 1 }, poisonCounters: 0, lifelinkGain: 1 },
    },
  ];
  const regular = { step: "regular", lifeDamage: 7, commanderHits: { "commander:later": 7 }, poisonCounters: 3, lifelinkGain: 7 };

  for (const scenario of cases) {
    const ordered = resolveCombatDamage({ state: scenario.state, steps: [regular, scenario.first] });
    assert.equal(ordered.lossReason, scenario.name);
    assert.equal(ordered.defeated, true);
    assert.deepEqual(ordered.stepsApplied, ["first"]);
    assert.equal(ordered.commanderDamage["commander:later"], undefined);

    const prevented = resolveCombatDamage({ state: scenario.state, steps: [regular, scenario.first], lossPrevented: true });
    assert.equal(prevented.defeated, false);
    assert.equal(prevented.lossReason, null);
    assert.deepEqual(prevented.stepsApplied, ["first", "regular"]);
    assert.equal(prevented.commanderDamage["commander:later"], 7);
    assert.equal(prevented.lifelinkGain, scenario.first.lifelinkGain + regular.lifelinkGain);
  }
});

test("combat numeric fuzz always returns bounded values without throwing", () => {
  const malformed = [-10, -0.5, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "7", null, undefined];
  const random = randomFor(0xbadf00d);
  for (let run = 0; run < 1_000; run += 1) {
    const bad = malformed[Math.floor(random() * malformed.length)];
    let result;
    assert.doesNotThrow(() => {
      result = resolveCombatDamage({
        state: { life: 40, poisonCounters: bad, commanderDamage: { malformed: bad } },
        steps: [{ step: run % 2 ? "regular" : "first", lifeDamage: bad, commanderHits: { malformed: bad }, poisonCounters: bad, lifelinkGain: bad }],
      });
    });
    assert.ok(Number.isSafeInteger(result.life));
    for (const value of [result.poisonCounters, result.lifeDamage, result.poisonAdded, result.lifelinkGain, ...Object.values(result.commanderDamage)]) {
      assert.ok(Number.isSafeInteger(value) && value >= 0);
    }
  }
});
