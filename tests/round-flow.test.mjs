import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./browser/fixtures.mjs";
import { activeReminders, nextRoundAction, remindersAfterResolution } from "../app/round-flow.ts";
import { decodeGameState } from "../app/session.ts";
import { generateEvent } from "../app/simulator.ts";

test("table cadence visits each living seat once before incrementing the round", () => {
  const game = fixture("early-rock", { roundMode: "table", actedOpponentIds: [], roundCombatIds: ["one"] });
  let next = nextRoundAction(game);
  assert.equal(next.turn, game.turn); assert.equal(next.sourceId, "two");
  const second = { ...game, ...next, currentEvent: { ...game.currentEvent, sourceId: "two", sourceName: "Two" } };
  next = nextRoundAction(second);
  assert.equal(next.turn, game.turn + 1); assert.equal(next.sourceId, "one");
  assert.deepEqual(next.actedOpponentIds, []); assert.deepEqual(next.roundCombatIds, []);
  game.opponents[1].eliminated = true;
  assert.equal(nextRoundAction(game).turn, game.turn + 1);
  game.roundMode = "quick";
  assert.equal(nextRoundAction(game).sourceId, undefined);
});

test("scheduled generation uses the requested living source", () => {
  const game = fixture();
  const input = { turn: 6, counter: 1, seed: game.seed, opponents: game.opponents, recentTemplateIds: [], activeThreat: false, sourceId: "two" };
  assert.equal(generateEvent(input).sourceId, "two");
  assert.deepEqual(generateEvent(input), generateEvent(input));
  assert.throws(() => generateEvent({ ...input, sourceId: "missing" }));
});

test("Arcane Denial records separate next-upkeep recipients without duplicates", () => {
  const game = fixture("counter-commander");
  const reminders = remindersAfterResolution(game, "two");
  assert.deepEqual(reminders.map((reminder) => reminder.recipientId), ["two", "one"]);
  assert.ok(reminders.every((reminder) => reminder.due === "next-upkeep"));
  assert.equal(remindersAfterResolution({ ...game, reminders }, "two").length, 2);
  assert.equal(decodeGameState({ ...game, reminders }).reminders.length, 2);
});

test("goad keeps the source-next-turn deadline even after that source leaves", () => {
  const game = fixture("goad", { responseStage: "resolved" });
  game.reminders = remindersAfterResolution(game);
  game.opponents[0].eliminated = true;
  assert.equal(game.reminders[0].due, "source-next-turn");
  assert.match(game.reminders[0].text, /not immediately/);
  assert.deepEqual(decodeGameState(game).reminders, game.reminders);
  assert.equal(activeReminders(game).length, 1);
});

test("departed controllers cannot create delayed triggers and Ring reminders do not multiply per tap", () => {
  const game = fixture("counter-commander");
  game.reminders = remindersAfterResolution(game);
  game.opponents[0].eliminated = true;
  assert.equal(activeReminders(game).length, 0);
  game.opponents[0].eliminated = false;
  game.currentEvent.card = "The One Ring"; game.reminders = [];
  game.reminders = remindersAfterResolution(game);
  game.currentEvent.id = "second-activation";
  assert.equal(remindersAfterResolution(game).length, 1);
});
