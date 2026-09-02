import assert from "node:assert/strict";
import test from "node:test";
import {
  BRACKET_THREE_GAME_CHANGERS,
  buildDefaultCombatDamageSteps,
  COMMANDER_BRACKETS,
  counterBacks,
  DECK_PROFILES,
  EVENT_TEMPLATES,
  eventKindWeights,
  GAME_CHANGER_CARDS,
  gameChangerIdentity,
  generateEvent,
  GLOSSARY_DEFINITIONS,
  KEYWORD_DEFINITIONS,
  normalizeCommanderBracket,
  opponentCommanderKey,
  resolveCombatDamage,
  rollDefense,
  userCommanderKey,
} from "../app/simulator.ts";

const opponents = [
  { id: "one", name: "One", profile: "combo", bracket: 4, life: 40, commanderDamage: {}, eliminated: false },
  { id: "two", name: "Two", profile: "swarm", bracket: 2, life: 40, commanderDamage: {}, eliminated: false },
];

function bracketThreeSequence(profile, seed, rounds = 20) {
  const source = [{ id: "b3", name: "B3", profile, bracket: 3, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false }];
  const seen = new Set(DECK_PROFILES[profile].coreCards[3].filter((card) => GAME_CHANGER_CARDS.has(card)));
  const recentTemplateIds = [];
  for (let round = 1; round <= rounds; round += 1) {
    const event = generateEvent({ turn: round, counter: round, seed, opponents: source, recentTemplateIds, activeThreat: false });
    const identity = gameChangerIdentity(event.card);
    if (GAME_CHANGER_CARDS.has(identity)) seen.add(identity);
    recentTemplateIds.unshift(event.templateId);
    recentTemplateIds.splice(3);
  }
  return seen;
}

test("glossary covers combat keywords and app terms", () => {
  for (const keyword of Object.keys(KEYWORD_DEFINITIONS)) assert.equal(typeof GLOSSARY_DEFINITIONS[keyword], "string");
  assert.match(GLOSSARY_DEFINITIONS["Commander damage"], /21 or more combat damage/);
  assert.match(GLOSSARY_DEFINITIONS.Destroy, /Indestructible/);
});

test("seeded events and defenses are repeatable", () => {
  const input = { turn: 8, counter: 4, seed: "REPLAY-42", opponents, recentTemplateIds: [], activeThreat: false };
  assert.deepEqual(generateEvent(input), generateEvent(input));
  const defenseInput = { profile: "control", bracket: 3, seed: "REPLAY-42", turn: 8, counter: 1, attackers: [{ name: "Threat", power: 7, keywords: ["Flying"] }] };
  assert.deepEqual(rollDefense(defenseInput), rollDefense(defenseInput));
});

test("a generated attack declares one atomic attacker batch", () => {
  const event = generateEvent({
    turn: 10,
    counter: 1,
    seed: "ATOMIC-0",
    opponents: [{ id: "one", name: "One", profile: "swarm", bracket: 5, life: 40, commanderDamage: {}, eliminated: false }],
    recentTemplateIds: [],
    activeThreat: false,
  });
  const attackers = event.attackers ?? [];

  assert.equal(event.kind, "attack");
  assert.ok(attackers.length > 1);
  assert.deepEqual(new Set(attackers.map(({ id }) => id.replace(/-attacker-\d+$/, ""))), new Set([event.id]));
  assert.equal(event.title, `One declares all ${attackers.length} attackers at you.`);
  assert.match(event.prompt, /all attackers.*once/i);
  assert.ok(event.tags.includes("One generated combat this round"));
});

test("RC-03/RC-07 generated combat reaches primary, Partner, both, and rare Infect", () => {
  const source = [{ id: "partners", name: "Pair", profile: "voltron", bracket: 5, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false }];
  const primary = opponentCommanderKey("partners", "primary");
  const partner = opponentCommanderKey("partners", "partner");
  const identities = new Set();
  const keywords = new Set();
  let both = false;

  for (let counter = 0; counter < 50_000; counter += 1) {
    const event = generateEvent({ turn: 10, counter, seed: "PARTNER-INFECT", opponents: source, recentTemplateIds: [], activeThreat: false });
    if (event.kind !== "attack") continue;
    const commanders = event.attackers.filter(({ isCommander }) => isCommander);
    const commanderIds = commanders.map(({ commanderId }) => commanderId);
    assert.equal(new Set(commanderIds).size, commanderIds.length, `duplicate commander identity at counter ${counter}`);
    for (const commander of commanders) {
      identities.add(commander.commanderId);
      assert.equal(commander.commanderLabel, commander.commanderId === primary ? "Pair’s primary commander" : "Pair’s partner commander");
    }
    if (commanderIds.includes(primary) && commanderIds.includes(partner)) both = true;
    for (const attacker of event.attackers) for (const keyword of attacker.keywords) keywords.add(keyword);
  }

  assert.deepEqual(identities, new Set([primary, partner]));
  assert.equal(both, true);
  assert.deepEqual(keywords, new Set(Object.keys(KEYWORD_DEFINITIONS)));
});

test("resolved combat suppresses only attack weight for that turn", () => {
  const base = { turn: 10, profile: "swarm", bracket: 5, activeThreat: false };
  const open = eventKindWeights({ ...base, combatResolvedTurn: null });
  const locked = eventKindWeights({ ...base, combatResolvedTurn: 10 });
  const nextTurn = eventKindWeights({ ...base, turn: 11, combatResolvedTurn: 10 });

  assert.ok(open.attack > 0);
  assert.equal(locked.attack, 0);
  assert.ok(nextTurn.attack > 0);
  for (const kind of ["targeted", "wipe", "counter", "disruption", "threat", "development"]) {
    assert.equal(locked[kind], open[kind]);
  }
});

test("event generation honors the same-turn combat lock", () => {
  const input = {
    turn: 10,
    counter: 1,
    seed: "ATOMIC-0",
    opponents: [{ id: "one", name: "One", profile: "swarm", bracket: 5, life: 40, commanderDamage: {}, eliminated: false }],
    recentTemplateIds: [],
    activeThreat: false,
  };

  assert.equal(generateEvent({ ...input, combatResolvedTurn: null }).kind, "attack");
  assert.notEqual(generateEvent({ ...input, combatResolvedTurn: 10 }).kind, "attack");
});

test("deck profiles expose distinct, bracket-safe three-card cores", () => {
  const templateIds = new Set(EVENT_TEMPLATES.map((template) => template.id));
  assert.deepEqual(
    EVENT_TEMPLATES.filter((template) => template.gameChanger).map(({ id, card }) => [id, card]),
    [["mass-bounce", "Cyclonic Rift"], ["exile-wipe", "Farewell"], ["combo-clock", "Thassa’s Oracle line"]],
  );
  assert.ok(GAME_CHANGER_CARDS.has("Biorhythm"));
  assert.equal(GAME_CHANGER_CARDS.has("Food Chain"), false);
  assert.equal(gameChangerIdentity("Thassa’s Oracle line"), "Thassa’s Oracle");

  for (const [profileId, profile] of Object.entries(DECK_PROFILES)) {
    assert.deepEqual(Object.keys(profile.coreCards), ["1", "2", "3", "4", "5"]);
    assert.ok(profile.preferredTemplates.every((templateId) => templateIds.has(templateId)));

    const packageSignatures = new Set();
    const profileCards = [];
    for (const bracket of [1, 2, 3, 4, 5]) {
      const cards = profile.coreCards[bracket];
      assert.equal(cards.length, 3, `${profileId} B${bracket} should expose three core cards`);
      assert.equal(new Set(cards).size, 3, `${profileId} B${bracket} core cards should be unique`);
      assert.ok(bracket >= 3 || cards.every((card) => !GAME_CHANGER_CARDS.has(card)), `${profileId} B${bracket} cannot include a Game Changer`);
      assert.ok(bracket !== 3 || cards.filter((card) => GAME_CHANGER_CARDS.has(card)).length <= 3);
      packageSignatures.add([...cards].sort().join("|"));
      profileCards.push(...cards);
    }
    assert.equal(packageSignatures.size, 5, `${profileId} should change its core at every bracket`);
    assert.equal(new Set(profileCards).size, 15, `${profileId} should not recycle cards between brackets`);

    const b3GameChangers = BRACKET_THREE_GAME_CHANGERS[profileId];
    assert.equal(new Set(b3GameChangers).size, b3GameChangers.length);
    assert.ok(b3GameChangers.length <= 3, `${profileId} B3 must contain at most three Game Changers`);
    assert.ok(b3GameChangers.every((card) => GAME_CHANGER_CARDS.has(card)));
    for (const coreGameChanger of profile.coreCards[3].filter((card) => GAME_CHANGER_CARDS.has(card))) {
      assert.ok(b3GameChangers.includes(coreGameChanger), `${profileId} must retain the B3 core Game Changer ${coreGameChanger}`);
    }
  }
});

test("RC-02 B3GC-EARLY-4530 and 100,000 B3 round-20 sequences stay within three Game Changers", () => {
  assert.ok(bracketThreeSequence("midrange", "B3GC-EARLY-4530").size <= 3);
  const profiles = Object.keys(DECK_PROFILES);
  for (let sequence = 0; sequence < 100_000; sequence += 1) {
    const profile = profiles[sequence % profiles.length];
    const seen = bracketThreeSequence(profile, `B3-STRESS-${sequence}`);
    assert.ok(seen.size <= 3, `${profile} seed ${sequence} surfaced ${[...seen].join(", ")}`);
  }
});

test("development preserves bracket pacing without revealing cards or scheduling their use", () => {
  for (const profileId of Object.keys(DECK_PROFILES)) {
    for (const bracket of [1, 2, 3, 4, 5]) {
      assert.equal(eventKindWeights({ turn: 20, profile: profileId, bracket, activeThreat: false }).development, [70, 55, 40, 25, 10][bracket - 1]);
      let developmentCount = 0;
      for (let counter = 0; counter < 200; counter += 1) {
        const event = generateEvent({
          turn: 20,
          counter,
          seed: `CORE-${profileId}-${bracket}`,
          opponents: [{ id: "core", name: "Core", profile: profileId, bracket, life: 40, commanderDamage: {}, eliminated: false }],
          recentTemplateIds: [],
          activeThreat: false,
          combatResolvedTurn: 20,
        });
        assert.notEqual(event.kind, "signature");
        if (event.kind === "development") {
          developmentCount += 1;
          assert.equal(event.card, "Table development");
          assert.deepEqual(event.responseOptions, []);
          assert.match(event.prompt, /No spell or attacker is aimed at you by this action/);
          assert.doesNotMatch(JSON.stringify(event), /reveal|signature|Deck intel/i);
        }
      }
      assert.ok(developmentCount > 0, `${profileId} B${bracket} still has quiet development actions`);
    }
  }
});

test("retired signature follow-up inputs cannot override normal seeded generation", () => {
  const living = {
    id: "living",
    name: "Living",
    profile: "control",
    bracket: 3,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    lossProtected: false,
    eliminated: false,
  };
  const base = { turn: 8, counter: 22, seed: "STALE-SIGNATURE", opponents: [living], recentTemplateIds: [], activeThreat: false };
  const normal = generateEvent(base);

  assert.deepEqual(generateEvent({ ...base, signatureFollowUp: { sourceId: living.id, card: DECK_PROFILES.control.coreCards[3][0], profile: "control", bracket: 3 } }), normal);
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
        totals.attackDamage[bucket] += buildDefaultCombatDamageSteps(event.attackers ?? []).reduce((sum, step) => sum + step.lifeDamage + step.poisonCounters, 0);
      }
      if (event.kind === "threat") totals.threats[bucket] += 1;
      if (counterBacks({ profile: "control", bracket, seed: `COUNTER-${index}`, turn: 5, eventCounter: index + 1, exchange: 1 })) totals.counters[bucket] += 1;
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
  const gameChangerTemplates = new Set(EVENT_TEMPLATES.filter((template) => template.gameChanger).map((template) => template.id));
  for (const bracket of [1, 2]) {
    for (let index = 0; index < 300; index += 1) {
      const event = generateEvent({ turn: 12, counter: index, seed: `LEGAL-${bracket}-${index}`, opponents: [{ ...opponents[0], bracket }], recentTemplateIds: [], activeThreat: false });
      assert.equal(gameChangerTemplates.has(event.templateId), false);
      assert.equal(GAME_CHANGER_CARDS.has(event.card), false);
    }
  }
});

test("B4 and B5 retain every Game Changer scenario", () => {
  const expected = new Set(EVENT_TEMPLATES.filter(({ gameChanger }) => gameChanger).map(({ id }) => id));
  for (const bracket of [4, 5]) {
    const seen = new Set();
    for (const profile of Object.keys(DECK_PROFILES)) {
      for (let counter = 0; counter < 5_000 && seen.size < expected.size; counter += 1) {
        const event = generateEvent({ turn: 20, counter, seed: `UNRESTRICTED-${bracket}-${profile}`, opponents: [{ id: "high", name: "High", profile, bracket, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false }], recentTemplateIds: [], activeThreat: false });
        if (expected.has(event.templateId)) seen.add(event.templateId);
      }
    }
    assert.deepEqual(seen, expected);
  }
});

test("commander damage is tracked per source and becomes lethal at 21", () => {
  const safe = resolveCombatDamage({
    state: { life: 40, poisonCounters: 0, commanderDamage: { A: 10, B: 10 } },
    steps: [{ step: "regular", lifeDamage: 0, commanderHits: {}, poisonCounters: 0, lifelinkGain: 0 }],
  });
  assert.equal(safe.defeated, false);
  const lethal = resolveCombatDamage({
    state: { life: 40, poisonCounters: 0, commanderDamage: { A: 18, B: 10 } },
    steps: [{ step: "regular", lifeDamage: 5, commanderHits: { A: 3 }, poisonCounters: 0, lifelinkGain: 0 }],
  });
  assert.equal(lethal.life, 35);
  assert.equal(lethal.commanderDamage.A, 21);
  assert.equal(lethal.lethalCommander, "A");
  assert.equal(lethal.defeated, true);
});

test("commander identities stay separate from display names and partner damage", () => {
  assert.notEqual(userCommanderKey("primary"), userCommanderKey("partner"));
  const split = resolveCombatDamage({
    state: { life: 40, poisonCounters: 0, commanderDamage: {} },
    steps: [{
      step: "regular",
      lifeDamage: 22,
      commanderHits: { [userCommanderKey("primary")]: 11, [userCommanderKey("partner")]: 11 },
      poisonCounters: 0,
      lifelinkGain: 0,
    }],
  });
  assert.equal(split.defeated, false);
});

test("double strike counts twice for incoming and commander combat damage", () => {
  const commanderId = "commander:a";
  const attackers = [
    { id: "a", name: "Commander", power: 5, toughness: 5, keywords: ["Double strike"], isCommander: true, commanderId },
    { id: "b", name: "Token", power: 3, toughness: 3, keywords: [], isCommander: false },
  ];
  const steps = buildDefaultCombatDamageSteps(attackers);
  assert.equal(steps.reduce((sum, step) => sum + step.lifeDamage, 0), 13);
  assert.equal(steps.reduce((sum, step) => sum + (step.commanderHits[commanderId] ?? 0), 0), 10);
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
