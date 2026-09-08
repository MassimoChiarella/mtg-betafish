import assert from "node:assert/strict";
import test from "node:test";
import { resolveMultiCombat } from "../app/multi-combat.ts";
import { fixture } from "./browser/fixtures.mjs";
const step = (name, damage) => ({ step: name, lifeDamage: damage, commanderHits: {}, poisonCounters: 0, lifelinkGain: damage });

test("a first-strike elimination skips only that defender's regular damage and lifelink", () => {
  const { opponents } = fixture(); opponents[0].life = 5;
  const defenders = opponents.map(({ id }) => ({ id, steps: [step("first", 5), step("regular", 7)], lossProtected: false }));
  const result = resolveMultiCombat(opponents, defenders);
  assert.deepEqual(result.opponents.map(({ life }) => life), [0, 28]);
  assert.equal(result.lifelinkGain, 17);
  assert.deepEqual(resolveMultiCombat(opponents, [...defenders].reverse()).opponents, result.opponents);
  assert.equal(opponents[0].life, 5);
  defenders[0].lossProtected = true;
  assert.equal(resolveMultiCombat(opponents, defenders).lifelinkGain, 24);
  assert.equal(resolveMultiCombat(opponents, defenders).opponents[0].eliminated, false);
});

test("global prevention blocks every defender, including poison and commander damage", () => {
  const { opponents } = fixture();
  const defenders = opponents.map(({ id }) => ({ id, steps: [{ ...step("first", 50), poisonCounters: 10, commanderHits: { "user-primary": 21 } }], lossProtected: false }));
  assert.deepEqual(resolveMultiCombat(opponents, defenders, true).opponents, opponents);
  assert.equal(resolveMultiCombat(opponents, defenders, true).lifelinkGain, 0);
  assert.ok(resolveMultiCombat(opponents, defenders).opponents.every(({ eliminated }) => eliminated));
});

test("invalid defenders reject the whole calculation without changing any player", () => {
  const { opponents } = fixture(); const original = structuredClone(opponents);
  const one = { id: "one", steps: [step("regular", 4)], lossProtected: false };
  assert.throws(() => resolveMultiCombat(opponents, [one, one]));
  assert.throws(() => resolveMultiCombat(opponents, [one, { ...one, id: "absent" }]));
  assert.deepEqual(opponents, original);
  opponents[0].eliminated = true;
  assert.throws(() => resolveMultiCombat(opponents, [one]));
});

test("ending loss protection checks lethal totals even with no damage steps or global Fog", () => {
  for (const patch of [{ life: 0 }, { poisonCounters: 10 }, { commanderDamage: { "user-primary": 21 } }]) {
    const { opponents } = fixture(); Object.assign(opponents[0], patch, { lossProtected: true });
    for (const fog of [true, false]) {
      const result = resolveMultiCombat(opponents, [{ id: "one", steps: [], lossProtected: false }], fog);
      assert.equal(result.opponents[0].eliminated, true);
      assert.equal(result.lifelinkGain, 0);
    }
  }
});
