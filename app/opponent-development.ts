import type { GameState } from "./session.ts";
import { coreEncounter, evaluateTrackedLoss, type DevelopmentState } from "./simulator.ts";

export function coreOutcome(state: GameState, result: string, sourceLife: number, userLife: number, development: DevelopmentState): Partial<GameState> {
  if (!coreEncounter(state.currentEvent.templateId) || !["resolved", "answered", "not-viable"].includes(result)) throw new Error("Choose an encounter outcome.");
  if (!Number.isSafeInteger(sourceLife) || !Number.isSafeInteger(userLife) || !["developing", "established", "rebuilding"].includes(development)) throw new Error("Check the final totals and board state.");
  if (result === "not-viable") return {};
  const opponents = state.opponents.map((opponent) => {
    if (opponent.id !== state.currentEvent.sourceId) return opponent;
    return { ...opponent, life: sourceLife, development: result === "resolved" ? development : opponent.development, eliminated: opponent.eliminated || Boolean(evaluateTrackedLoss({ ...opponent, life: sourceLife }, opponent.lossProtected)) };
  });
  const loss = evaluateTrackedLoss({ life: userLife, poisonCounters: state.userPoisonCounters, commanderDamage: state.userCommanderDamage }, state.userLossProtected);
  return { opponents, userLife, activeThreat: opponents.some((opponent) => opponent.id === state.activeThreat?.ownerId && opponent.eliminated) ? null : state.activeThreat, gameOver: loss ? `You lost after resolving ${state.currentEvent.card}.` : opponents.every((opponent) => opponent.eliminated) ? "Every simulated opponent has left the game." : state.gameOver };
}
