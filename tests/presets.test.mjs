import assert from "node:assert/strict";
import test from "node:test";
import { decodePreset, deletePreset, importPreset, listPresets, MAX_PRESET_BYTES, PRESET_PREFIX, savePreset } from "../app/presets.ts";
import { fixture } from "./browser/fixtures.mjs";
const preset = (patch = {}) => ({ version: 1, id: "preset-a", name: "Midrange table", seed: "FIXED", roundMode: "table", opponents: fixture().opponents, ...patch });
function storage() {
  const items = new Map();
  return { get length() { return items.size; }, key(index) { return [...items.keys()][index] ?? null; }, getItem(key) { return items.get(key) ?? null; }, setItem(key, value) { items.set(key, value); }, removeItem(key) { items.delete(key); } };
}

test("presets project configuration only and validate all imported fields", () => {
  const value = preset(); value.opponents[0].life = -1; value.opponents[0].eliminated = true;
  assert.deepEqual(Object.keys(decodePreset(value).opponents[0]).sort(), ["bracket", "id", "name", "profile"]);
  for (const patch of [{ version: 2 }, { name: " " }, { seed: "s".repeat(25) }, { roundMode: "unknown" }, { opponents: [] }, { opponents: [value.opponents[0], value.opponents[0]] }, { opponents: [{ ...value.opponents[0], profile: "__proto__" }] }, { opponents: [{ ...value.opponents[0], bracket: 6 }] }]) assert.equal(decodePreset(preset(patch)), null);
  assert.equal(importPreset("x".repeat(MAX_PRESET_BYTES + 1)), null);
  assert.equal(importPreset("{invalid}"), null);
  assert.equal(decodePreset(preset({ roundMode: ["table"] })), null);
  assert.equal(decodePreset(preset({ roundMode: {} })), null);
});

test("separate preset keys preserve other tabs and malformed records", () => {
  const db = storage(); const first = savePreset(db, preset());
  savePreset(db, preset({ id: "preset-b", name: "Second table" }));
  db.setItem(`${PRESET_PREFIX}bad`, "incompatible");
  assert.equal(listPresets(db).length, 2);
  deletePreset(db, first);
  assert.equal(listPresets(db)[0].id, "preset-b");
  assert.equal(db.getItem(`${PRESET_PREFIX}bad`), "incompatible");
});

test("conflicting deletion and quota errors preserve stored presets", () => {
  const db = storage(); const first = savePreset(db, preset());
  db.setItem(`${PRESET_PREFIX}${first.id}`, JSON.stringify({ ...first, name: "Updated elsewhere" }));
  assert.throws(() => deletePreset(db, first));
  assert.throws(() => savePreset({ ...db, setItem() { throw new Error("quota"); } }, preset({ id: "new" })));
  assert.equal(listPresets(db)[0].name, "Updated elsewhere");
  assert.throws(() => savePreset(db, first));
});
