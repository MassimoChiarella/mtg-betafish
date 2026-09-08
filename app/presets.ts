import { DECK_PROFILES, type Opponent } from "./simulator.ts";

export const PRESET_PREFIX = "betafish-preset-v1:";
export const MAX_PRESET_BYTES = 16 * 1024;
export type MatchupPreset = { version: 1; id: string; name: string; seed: string; roundMode: "quick" | "table"; opponents: Pick<Opponent, "id" | "name" | "profile" | "bracket">[] };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const validId = (value: unknown): value is string => text(value, 64) && /^[a-z0-9_-]+$/i.test(value);

export function decodePreset(value: unknown): MatchupPreset | null {
  if (!record(value) || value.version !== 1 || !validId(value.id) || !text(value.name, 80) || !text(value.seed, 24) || (value.roundMode !== "quick" && value.roundMode !== "table") || !Array.isArray(value.opponents) || value.opponents.length < 1 || value.opponents.length > 3) return null;
  const opponents: MatchupPreset["opponents"] = [];
  for (const opponent of value.opponents) {
    if (!record(opponent) || !text(opponent.id, 256) || !opponent.id.isWellFormed() || !text(opponent.name, 80) || typeof opponent.profile !== "string" || !Object.hasOwn(DECK_PROFILES, opponent.profile) || ![1, 2, 3, 4, 5].includes(opponent.bracket as number)) return null;
    opponents.push({ id: opponent.id, name: opponent.name.trim(), profile: opponent.profile as Opponent["profile"], bracket: opponent.bracket as Opponent["bracket"] });
  }
  if (new Set(opponents.map(({ id }) => id)).size !== opponents.length || new Set(opponents.map(({ name }) => name.toLowerCase())).size !== opponents.length) return null;
  return { version: 1, id: value.id, name: value.name.trim(), seed: value.seed.trim(), roundMode: value.roundMode as MatchupPreset["roundMode"], opponents };
}

export function importPreset(raw: string) {
  if (raw.length > MAX_PRESET_BYTES || new TextEncoder().encode(raw).byteLength > MAX_PRESET_BYTES) return null;
  try { return decodePreset(JSON.parse(raw)); } catch { return null; }
}

export function listPresets(storage: Pick<Storage, "length" | "key" | "getItem">) {
  const presets: MatchupPreset[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PRESET_PREFIX)) continue;
    const preset = importPreset(storage.getItem(key) ?? "");
    if (preset && key === `${PRESET_PREFIX}${preset.id}`) presets.push(preset);
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name));
}

export function savePreset(storage: Pick<Storage, "length" | "key" | "getItem" | "setItem">, value: unknown) {
  const preset = decodePreset(value);
  if (!preset) throw new Error("Check the preset name, seed and one to three unique matchups.");
  if (listPresets(storage).length >= 20) throw new Error("This device already has 20 presets. Delete one before saving another.");
  const key = `${PRESET_PREFIX}${preset.id}`;
  if (storage.getItem(key) !== null) throw new Error("This preset already exists. Save a new copy instead.");
  storage.setItem(key, JSON.stringify(preset));
  return preset;
}

export function deletePreset(storage: Pick<Storage, "getItem" | "removeItem">, preset: MatchupPreset) {
  const key = `${PRESET_PREFIX}${preset.id}`;
  const latest = importPreset(storage.getItem(key) ?? "");
  if (JSON.stringify(latest) !== JSON.stringify(preset)) throw new Error("This preset changed in another tab. Review the refreshed list before deleting.");
  storage.removeItem(key);
}
