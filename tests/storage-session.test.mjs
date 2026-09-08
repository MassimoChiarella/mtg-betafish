import assert from "node:assert/strict";
import test from "node:test";
import { generateEvent } from "../app/simulator.ts";
import { GAME_STATE_VERSION, CATALOG_REVISION } from "../app/session.ts";
import {
  backupKey, rejectedKey, exportSession, importSession, MAX_SESSION_BYTES,
  decideStorageEvent,
  hasCompetingStoredSession,
  newestStoredSession,
  nextStorageRevision,
  readStoredSession,
  serializeGameState,
  writeStoredSession,
} from "../app/storage-session.ts";

test("portable sessions validate contents, future versions and input size", () => {
  const game = gameState();
  assert.deepEqual(importSession(exportSession(game)), JSON.parse(JSON.stringify(game)));
  assert.deepEqual(importSession(JSON.stringify({ revision: 5, state: game })), JSON.parse(JSON.stringify(game)));
  assert.equal(writeStoredSession(memoryStorage(), "session", 1, { ...game, seed: "x".repeat(MAX_SESSION_BYTES) }), false);
  assert.throws(() => exportSession({ ...game, seed: "x".repeat(MAX_SESSION_BYTES) }));
  assert.equal(importSession("{"), null);
  assert.equal(importSession(" ".repeat(MAX_SESSION_BYTES + 1)), null);
  assert.equal(importSession(JSON.stringify({ format: "mtg-betafish-session", state: { ...game, version: GAME_STATE_VERSION + 1 } })), null);
});

test("writes preserve the prior valid save and quarantine invalid raw input", () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(writeStoredSession(storage, "session", 1, gameState()), true);
  const old = values.get("session");
  assert.equal(writeStoredSession(storage, "session", 2, gameState(39)), true);
  assert.equal(values.get(backupKey("session")), old);
  values.set("session", "future or corrupt data");
  assert.equal(writeStoredSession(storage, "session", 3, gameState(38)), true);
  assert.equal(values.get(rejectedKey("session")), "future or corrupt data");
  assert.equal(values.get(backupKey("session")), old);
  values.set("session", old);
  const failing = { getItem: storage.getItem, setItem: () => { throw Error("quota"); } };
  assert.equal(writeStoredSession(failing, "session", 4, gameState(37)), false);
  assert.equal(values.get("session"), old);
});

function gameState(userLife = 40) {
  const opponents = [{
    id: "one",
    name: "One",
    profile: "midrange",
    bracket: 3,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    lossProtected: false,
    eliminated: false,
  }];
  return {
    version: GAME_STATE_VERSION,
    catalogRevision: CATALOG_REVISION,
    turn: 1,
    eventCounter: 1,
    defenseCounter: 0,
    seed: "STORAGE-BEHAVIOR",
    opponents,
    userLife,
    userLossProtected: false,
    userPoisonCounters: 0,
    userCommanderDamage: {},
    currentEvent: generateEvent({ turn: 1, counter: 1, seed: "STORAGE-BEHAVIOR", opponents, recentTemplateIds: [], activeThreat: false, combatResolvedTurn: null }),
    responseStage: "prompt",
    resolution: "",
    toxicDelugePayment: null,
    activeThreat: null,
    recentTemplateIds: [],
    history: [{ id: "start", turn: 1, title: "Session started", detail: "Started.", tone: "neutral" }],
    answeredCount: 0,
    combatResolvedTurn: null,
    counterExchange: 0,
    gameOver: null,
  };
}

function memoryStorage(initial = null) {
  let value = initial;
  return {
    get value() { return value; },
    setItem(_key, next) { value = next; },
  };
}

test("storage envelopes and canonical serialization round-trip without property-order conflicts", () => {
  const state = gameState();
  const reordered = { gameOver: state.gameOver, ...state };
  assert.equal(serializeGameState(state), serializeGameState(reordered));

  const rawState = readStoredSession(JSON.stringify(state));
  assert.ok(rawState);
  assert.equal(rawState.revision, 0);

  const envelope = readStoredSession(JSON.stringify({ revision: 4, state }));
  assert.ok(envelope);
  assert.equal(envelope.revision, 4);
  assert.equal(envelope.serialized, serializeGameState(state));
  assert.equal(readStoredSession("{"), null);
  assert.equal(readStoredSession(JSON.stringify({ revision: -1, state })), null);
});

test("two tabs from one revision detect conflict and both choices advance deterministically", () => {
  const base = readStoredSession(JSON.stringify({ revision: 4, state: gameState() }));
  assert.ok(base);

  const shared = memoryStorage();
  assert.equal(writeStoredSession(shared, "session", 5, gameState(39)), true);
  const tabA = readStoredSession(shared.value);
  assert.ok(tabA);
  assert.equal(hasCompetingStoredSession(tabA, base.revision, base.serialized), true);
  assert.equal(newestStoredSession(tabA, shared.value).state.userLife, 39, "load chooses the current saved state");

  const keepRevision = nextStorageRevision(base.revision, tabA.revision);
  assert.equal(keepRevision, 6);
  assert.equal(writeStoredSession(shared, "session", keepRevision, gameState(38)), true);
  const kept = readStoredSession(shared.value);
  assert.ok(kept);
  assert.equal(kept.revision, 6);
  assert.equal(kept.state.userLife, 38);
});

test("stale invalid and deletion events cannot overwrite a newer valid value", () => {
  const validRaw = JSON.stringify({ revision: 8, state: gameState(32) });
  const staleInvalid = decideStorageEvent("{", validRaw);
  assert.equal(staleInvalid.action, "valid");
  assert.equal(staleInvalid.stored.revision, 8);

  assert.deepEqual(decideStorageEvent("{", "{"), { action: "restore", expectedRaw: "{" });
  assert.deepEqual(decideStorageEvent(null, null), { action: "restore", expectedRaw: null });
  assert.equal(decideStorageEvent(null, validRaw).action, "valid");
  assert.deepEqual(decideStorageEvent("{", "["), { action: "restore", expectedRaw: "[" });
  assert.deepEqual(decideStorageEvent(validRaw, null), { action: "restore", expectedRaw: null });
});

test("newest conflict selection, revision saturation, and storage exceptions fail safely", () => {
  const selected = readStoredSession(JSON.stringify({ revision: 10, state: gameState(30) }));
  assert.ok(selected);
  const newerRaw = JSON.stringify({ revision: 11, state: gameState(29) });
  assert.equal(newestStoredSession(selected, newerRaw).state.userLife, 29);
  assert.equal(newestStoredSession(selected, null), selected);
  assert.equal(newestStoredSession(selected, "{").revision, 10);

  assert.equal(nextStorageRevision(1, 9, 4), 10);
  assert.equal(nextStorageRevision(Number.MAX_SAFE_INTEGER), null);
  assert.equal(nextStorageRevision(-1), null);
  assert.equal(writeStoredSession({ setItem() { throw new Error("blocked"); } }, "session", 1, gameState()), false);

  const invalidState = { ...gameState(), userLife: 0 };
  const storage = memoryStorage();
  assert.equal(serializeGameState(invalidState), null);
  assert.equal(writeStoredSession(storage, "session", 1, invalidState), false);
  assert.equal(storage.value, null);
});
