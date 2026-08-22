import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCombatDamage,
  generateEvent,
  incomingCommanderDamage,
  incomingDamage,
  opponentCommanderKey,
  rollDefense,
  userCommanderKey,
} from "../app/simulator.ts";

const opponents = [
  { id: "one", name: "One", profile: "combo", life: 40, commanderDamage: {}, eliminated: false },
  { id: "two", name: "Two", profile: "swarm", life: 40, commanderDamage: {}, eliminated: false },
];

test("seeded events and defenses are repeatable", () => {
  const input = { turn: 8, counter: 4, seed: "REPLAY-42", opponents, recentTemplateIds: [], activeThreat: false, difficulty: "balanced" };
  assert.deepEqual(generateEvent(input), generateEvent(input));
  const defenseInput = { profile: "control", seed: "REPLAY-42", turn: 8, counter: 1, difficulty: "balanced", attackers: [{ name: "Threat", power: 7, keywords: ["Flying"] }] };
  assert.deepEqual(rollDefense(defenseInput), rollDefense(defenseInput));
});

test("commander damage is tracked per source and becomes lethal at 21", () => {
  const safe = applyCombatDamage({ life: 40, commanderDamage: { A: 10, B: 10 }, regularDamage: 0, commanderHits: {} });
  assert.equal(safe.defeated, false);
  const lethal = applyCombatDamage({ life: 40, commanderDamage: { A: 18, B: 10 }, regularDamage: 2, commanderHits: { A: 3 } });
  assert.equal(lethal.life, 35);
  assert.equal(lethal.commanderDamage.A, 21);
  assert.equal(lethal.lethalCommander, "A");
  assert.equal(lethal.defeated, true);
});

test("commander identities stay separate from display names and partner damage", () => {
  assert.equal(opponentCommanderKey("one"), opponentCommanderKey("one"));
  assert.notEqual(userCommanderKey("primary"), userCommanderKey("partner"));
  const split = applyCombatDamage({
    life: 40,
    commanderDamage: {},
    regularDamage: 0,
    commanderHits: { [userCommanderKey("primary")]: 11, [userCommanderKey("partner")]: 11 },
  });
  assert.equal(split.defeated, false);
});

test("double strike counts twice for incoming and commander combat damage", () => {
  const attackers = [
    { id: "a", name: "Commander", power: 5, toughness: 5, keywords: ["Double strike"], isCommander: true },
    { id: "b", name: "Token", power: 3, toughness: 3, keywords: [], isCommander: false },
  ];
  assert.equal(incomingDamage(attackers), 13);
  assert.equal(incomingCommanderDamage(attackers), 10);
});

test("an existing countdown prevents a second threat event", () => {
  for (let index = 0; index < 50; index += 1) {
    const event = generateEvent({ turn: 9, counter: index, seed: `ACTIVE-${index}`, opponents, recentTemplateIds: [], activeThreat: true, difficulty: "balanced" });
    assert.notEqual(event.kind, "threat");
  }
});

test("eliminated tables cannot generate new opponent actions", () => {
  const eliminated = opponents.map((opponent) => ({ ...opponent, eliminated: true }));
  assert.throws(() => generateEvent({ turn: 9, counter: 1, seed: "DONE", opponents: eliminated, recentTemplateIds: [], activeThreat: false, difficulty: "balanced" }), /living opponent/);
});
