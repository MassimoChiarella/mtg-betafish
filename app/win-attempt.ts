import { evaluateTrackedLoss, winAttemptEvent } from "./simulator.ts";
import type { GameState } from "./session.ts";

export function expireThreat(state: GameState, turn: number): Partial<GameState> | null {
  const threat = state.activeThreat;
  const source = state.opponents.find((opponent) => opponent.id === threat?.ownerId && !opponent.eliminated);
  if (!threat || !source || threat.remaining > 1) return null;
  const eventCounter = Math.min(Number.MAX_SAFE_INTEGER, state.eventCounter + 1);
  return { turn, eventCounter, currentEvent: winAttemptEvent(threat, source, turn, eventCounter, state.seed), activeThreat: null, responseStage: "prompt", counterExchange: 0, toxicDelugePayment: null, reservoirPayment: null, resolution: "", gameOver: null };
}

export function payReservoir(state: GameState): Partial<GameState> {
  const source = state.opponents.find((opponent) => opponent.id === state.currentEvent.sourceId && !opponent.eliminated);
  if (state.currentEvent.templateId !== "reservoir-attempt" || !source || source.life < 50) throw new Error("The source needs at least 50 life to activate Reservoir. Mark the line not viable, or correct its actual life total first.");
  if (state.reservoirPayment === state.currentEvent.id) throw new Error("This activation’s cost is already paid.");
  const life = source.life - 50;
  const eliminated = Boolean(evaluateTrackedLoss({ ...source, life }, source.lossProtected));
  const opponents = state.opponents.map((opponent) => opponent.id === source.id ? { ...opponent, life, eliminated } : opponent);
  return { opponents, activeThreat: eliminated && state.activeThreat?.ownerId === source.id ? null : state.activeThreat, reservoirPayment: state.currentEvent.id, responseStage: eliminated ? "resolved" : "choose", resolution: eliminated ? `${source.name} paid 50 life and left the game; their activation was removed before responses.` : `${source.name} paid 50 life. The activation is now on the stack.`, gameOver: opponents.every((opponent) => opponent.eliminated) ? "Every simulated opponent has left the game." : state.gameOver };
}

export function reservoirDamage(state: GameState, target: string, damage: number): Partial<GameState> {
  if (state.currentEvent.templateId !== "reservoir-attempt" || state.reservoirPayment !== state.currentEvent.id || !state.opponents.some((opponent) => opponent.id === state.currentEvent.sourceId && !opponent.eliminated)) throw new Error("Pay the activation cost before resolving damage.");
  if (!Number.isSafeInteger(damage) || damage < 0) throw new Error("Enter nonnegative whole-number damage after prevention and replacement effects.");
  if (target !== "user" && !state.opponents.some((opponent) => opponent.id === target && !opponent.eliminated)) throw new Error("Choose a living target.");
  const subtract = (life: number) => Math.max(Number.MIN_SAFE_INTEGER, life - damage);
  const userLife = target === "user" ? subtract(state.userLife) : state.userLife;
  const opponents = state.opponents.map((opponent) => {
    const life = target === opponent.id ? subtract(opponent.life) : opponent.life;
    return { ...opponent, life, eliminated: opponent.eliminated || Boolean(evaluateTrackedLoss({ ...opponent, life }, opponent.lossProtected)) };
  });
  const userLost = evaluateTrackedLoss({ life: userLife, poisonCounters: state.userPoisonCounters, commanderDamage: state.userCommanderDamage }, state.userLossProtected);
  return { userLife, opponents, activeThreat: opponents.some((opponent) => opponent.id === state.activeThreat?.ownerId && opponent.eliminated) ? null : state.activeThreat, gameOver: userLost ? "You lost to Aetherflux Reservoir’s activation." : opponents.every((opponent) => opponent.eliminated) ? "Every simulated opponent has left the game." : null };
}
