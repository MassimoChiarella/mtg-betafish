import { decodeGameState, type GameState } from "./session.ts";

export const MAX_SESSION_BYTES = 1024 * 1024;
export const backupKey = (key: string) => `${key}:backup`;
export const rejectedKey = (key: string) => `${key}:rejected`;
const withinSizeLimit = (raw: string) => raw.length <= MAX_SESSION_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_SESSION_BYTES;

export function exportSession(state: GameState) {
  const decoded = decodeGameState(state);
  if (!decoded) throw new Error("This session cannot be exported safely.");
  const serialized = JSON.stringify({ format: "mtg-betafish-session", state: decoded }, null, 2);
  if (!withinSizeLimit(serialized)) throw new Error("This session exceeds the 1 MiB file limit.");
  return serialized;
}

export function importSession(raw: string): GameState | null {
  if (!withinSizeLimit(raw)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("format" in value)) return readStoredSession(raw)?.state ?? null;
    if (value.format !== "mtg-betafish-session" || !("state" in value)) return null;
    return decodeGameState(value.state);
  } catch { return null; }
}

export type StoredSession = {
  revision: number;
  state: GameState;
};

export type StorageConflict = StoredSession & {
  serialized: string;
};

export type StorageEventDecision =
  | { action: "valid"; stored: StorageConflict }
  | { action: "restore"; expectedRaw: string | null };

export function serializeGameState(state: GameState) {
  const decoded = decodeGameState(state);
  return decoded ? JSON.stringify(decoded) : null;
}

export function readStoredSession(raw: string): StorageConflict | null {
  if (!withinSizeLimit(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "revision" in parsed && "state" in parsed) {
      const revision = (parsed as { revision?: unknown }).revision;
      const state = decodeGameState((parsed as { state?: unknown }).state);
      if (!Number.isSafeInteger(revision) || (revision as number) < 0 || !state) return null;
      return { revision: revision as number, state, serialized: JSON.stringify(state) };
    }
    const state = decodeGameState(parsed);
    return state ? { revision: 0, state, serialized: JSON.stringify(state) } : null;
  } catch {
    return null;
  }
}

export function decideStorageEvent(eventRaw: string | null, currentRaw: string | null): StorageEventDecision {
  if (currentRaw === eventRaw) {
    const eventStored = eventRaw === null ? null : readStoredSession(eventRaw);
    return eventStored ? { action: "valid", stored: eventStored } : { action: "restore", expectedRaw: eventRaw };
  }
  if (!currentRaw) return { action: "restore", expectedRaw: null };
  const currentStored = readStoredSession(currentRaw);
  return currentStored ? { action: "valid", stored: currentStored } : { action: "restore", expectedRaw: currentRaw };
}

export function newestStoredSession(selected: StorageConflict, currentRaw: string | null): StorageConflict {
  if (!currentRaw) return selected;
  const current = readStoredSession(currentRaw);
  if (!current || current.revision < selected.revision) return selected;
  if (current.revision === selected.revision && current.serialized === selected.serialized) return selected;
  return current;
}

export function nextStorageRevision(...revisions: number[]): number | null {
  if (!revisions.length || revisions.some((revision) => !Number.isSafeInteger(revision) || revision < 0)) return null;
  const latest = Math.max(...revisions);
  return latest >= Number.MAX_SAFE_INTEGER ? null : latest + 1;
}

export function hasCompetingStoredSession(stored: StorageConflict, observedRevision: number, savedSerialization: string) {
  return stored.revision >= observedRevision && stored.serialized !== savedSerialization;
}

export function writeStoredSession(storage: Pick<Storage, "setItem"> & Partial<Pick<Storage, "getItem">>, key: string, revision: number, state: GameState) {
  if (!Number.isSafeInteger(revision) || revision < 0) return false;
  const decoded = decodeGameState(state);
  if (!decoded) return false;
  try {
    const serialized = JSON.stringify({ revision, state: decoded } satisfies StoredSession);
    if (!withinSizeLimit(serialized)) return false;
    const previous = storage.getItem?.(key);
    // Preserve recoverable data before replacing it; a failed backup aborts the save.
    if (previous) storage.setItem(readStoredSession(previous) ? backupKey(key) : rejectedKey(key), previous);
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}
