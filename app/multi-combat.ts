import { resolveCombatDamage, type CombatDamageStep, type Opponent } from "./simulator.ts";

export function resolveMultiCombat(opponents: readonly Opponent[], defenders: readonly { id: string; steps: readonly CombatDamageStep[]; lossProtected: boolean }[], preventAllDamage = false) {
  if (!defenders.length || new Set(defenders.map((defender) => defender.id)).size !== defenders.length || defenders.some((defender) => !opponents.some((opponent) => opponent.id === defender.id && !opponent.eliminated))) throw new Error("Choose each living defender only once.");
  // Each defender starts from the same combat snapshot. Their first-strike loss
  // skips only their regular step; the other defenders still receive damage.
  const results = defenders.map((defender) => {
    const opponent = opponents.find((candidate) => candidate.id === defender.id)!;
    return { id: defender.id, lossProtected: defender.lossProtected, ...resolveCombatDamage({ state: opponent, steps: preventAllDamage ? [] : defender.steps, lossProtected: defender.lossProtected }) };
  });
  return {
    results,
    lifelinkGain: results.reduce((sum, result) => Math.min(Number.MAX_SAFE_INTEGER, sum + result.lifelinkGain), 0),
    opponents: opponents.map((opponent) => {
      const result = results.find((candidate) => candidate.id === opponent.id);
      return result ? { ...opponent, life: result.life, poisonCounters: result.poisonCounters, commanderDamage: result.commanderDamage, lossProtected: result.lossProtected, eliminated: result.defeated } : opponent;
    }),
  };
}
