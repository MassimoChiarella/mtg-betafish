import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCombatDamage,
  COMMANDER_BRACKETS,
  counterBacks,
  DECK_PROFILES,
  EVENT_TEMPLATES,
  eventKindWeights,
  generateEvent,
  incomingCommanderDamage,
  incomingDamage,
  normalizeCommanderBracket,
  rollDefense,
  userCommanderKey,
} from "../app/simulator.ts";

const opponents = [
  { id: "one", name: "One", profile: "combo", bracket: 4, life: 40, commanderDamage: {}, eliminated: false },
  { id: "two", name: "Two", profile: "swarm", bracket: 2, life: 40, commanderDamage: {}, eliminated: false },
];

test("seeded events and defenses are repeatable", () => {
  const input = { turn: 8, counter: 4, seed: "REPLAY-42", opponents, recentTemplateIds: [], activeThreat: false };
  assert.deepEqual(generateEvent(input), generateEvent(input));
  const defenseInput = { profile: "control", bracket: 3, seed: "REPLAY-42", turn: 8, counter: 1, attackers: [{ name: "Threat", power: 7, keywords: ["Flying"] }] };
  assert.deepEqual(rollDefense(defenseInput), rollDefense(defenseInput));
});

test("deck profiles expose valid, bracket-safe included cards", () => {
  const templates = new Map(EVENT_TEMPLATES.map((template) => [template.id, template]));
  assert.deepEqual(
    EVENT_TEMPLATES.filter((template) => template.gameChanger).map(({ id, card }) => [id, card]),
    [["mass-bounce", "Cyclonic Rift"], ["exile-wipe", "Farewell"], ["combo-clock", "Thassa’s Oracle line"]],
  );
  for (const profile of Object.values(DECK_PROFILES)) {
    assert.equal(profile.guaranteedCards.length, 3);
    assert.equal(new Set(profile.guaranteedCards.map((card) => card.name)).size, 3);
    for (const card of profile.guaranteedCards) {
      assert.equal(templates.get(card.templateId)?.card, card.name);
      assert.equal(Boolean(templates.get(card.templateId)?.gameChanger), false);
    }
  }
});

test("Commander brackets increase pace and interaction without changing replayability", () => {
  const brackets = Object.values(COMMANDER_BRACKETS);
  assert.deepEqual(brackets.map((rules) => rules.earliestThreatTurn), [7, 6, 5, 3, 1]);
  for (let index = 1; index < brackets.length; index += 1) {
    assert.ok(brackets[index].turnOffset > brackets[index - 1].turnOffset);
    assert.ok(brackets[index].pace > brackets[index - 1].pace);
    assert.ok(brackets[index].interaction > brackets[index - 1].interaction);
    assert.ok(brackets[index].earliestThreatTurn <= brackets[index - 1].earliestThreatTurn);
    assert.ok(brackets[index].threatClock <= brackets[index - 1].threatClock);
  }
  assert.equal(normalizeCommanderBracket(undefined), 3);
  const attackers = [{ name: "Threat", power: 7, keywords: ["Flying"] }];
  const totals = { attacks: [0, 0], attackDamage: [0, 0], counters: [0, 0], defenses: [0, 0], threats: [0, 0] };
  for (let index = 0; index < 500; index += 1) {
    for (const [bucket, bracket] of [1, 5].entries()) {
      const source = [{ ...opponents[0], bracket }];
      const event = generateEvent({ turn: 3, counter: index, seed: `BRACKET-${index}`, opponents: source, recentTemplateIds: [], activeThreat: false });
      if (event.kind === "attack") {
        totals.attacks[bucket] += 1;
        totals.attackDamage[bucket] += incomingDamage(event.attackers ?? []);
      }
      if (event.kind === "threat") totals.threats[bucket] += 1;
      if (counterBacks({ profile: "control", bracket, seed: `COUNTER-${index}`, turn: 5, counter: index })) totals.counters[bucket] += 1;
      if (rollDefense({ profile: "control", bracket, seed: `DEFENSE-${index}`, turn: 5, counter: index, attackers }).type !== "none") totals.defenses[bucket] += 1;
    }
  }
  assert.ok(totals.attacks[1] > totals.attacks[0]);
  assert.ok(totals.attackDamage[1] > totals.attackDamage[0]);
  assert.ok(totals.counters[1] > totals.counters[0]);
  assert.ok(totals.defenses[1] > totals.defenses[0]);
  assert.equal(totals.threats[0], 0);
  assert.ok(totals.threats[1] > 0);
});

test("generated counter and removal pressure rises through every bracket and profile", () => {
  for (const profile of Object.keys(DECK_PROFILES)) {
    for (const turn of [1, 5, 10]) {
      const interactionShares = [1, 2, 3, 4, 5].map((bracket) => {
        const weights = eventKindWeights({ turn, profile, bracket, activeThreat: false });
        const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
        return (weights.targeted + weights.wipe + weights.counter) / total;
      });
      for (let index = 1; index < interactionShares.length; index += 1) {
        assert.ok(interactionShares[index] > interactionShares[index - 1], `${profile} turn ${turn}: ${interactionShares.join(" < ")} should rise by bracket`);
      }
    }
  }
});

test("lower brackets never surface Game Changer scenarios", () => {
  const gameChangers = new Set(EVENT_TEMPLATES.filter((template) => template.gameChanger).map((template) => template.card));
  for (const bracket of [1, 2]) {
    for (let index = 0; index < 300; index += 1) {
      const event = generateEvent({ turn: 12, counter: index, seed: `LEGAL-${bracket}-${index}`, opponents: [{ ...opponents[0], bracket }], recentTemplateIds: [], activeThreat: false });
      assert.equal(gameChangers.has(event.card), false);
    }
  }
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
    const event = generateEvent({ turn: 9, counter: index, seed: `ACTIVE-${index}`, opponents, recentTemplateIds: [], activeThreat: true });
    assert.notEqual(event.kind, "threat");
  }
});

test("eliminated tables cannot generate new opponent actions", () => {
  const eliminated = opponents.map((opponent) => ({ ...opponent, eliminated: true }));
  assert.throws(() => generateEvent({ turn: 9, counter: 1, seed: "DONE", opponents: eliminated, recentTemplateIds: [], activeThreat: false }), /living opponent/);
});
