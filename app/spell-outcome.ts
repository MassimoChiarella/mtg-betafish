import type { GameState } from "./session.ts";
import { evaluateTrackedLoss } from "./simulator.ts";

export type SpellResult = "resolved" | "countered" | "illegal";

// Board-dependent effects stay in the playtester; only confirmed numeric effects
// are applied here. A legal indestructible target does not stop a spell resolving.
export function spellOutcome(state: GameState, result: SpellResult, controller: string, power = 0) {
  const event = state.currentEvent;
  if (!["resolved", "countered", "illegal"].includes(result)) throw new Error("Choose a spell result.");
  if (!Number.isSafeInteger(power)) throw new Error("Enter the creature’s whole-number power.");
  const recipient = controller === "user" ? null : state.opponents.find((opponent) => opponent.id === controller && !opponent.eliminated);
  if (controller !== "user" && !recipient) throw new Error("Choose a living target controller.");
  if (result !== "resolved") return {
    patch: {} as Partial<GameState>,
    detail: `${event.card} ${result === "countered" ? "was countered" : "does not resolve because every target is illegal"}. No resolution effects occur; casting costs remain paid.`,
  };
  const gain = event.templateId === "early-rock" ? 4 : event.templateId === "exile-commander" ? Math.max(0, power) : 0;
  const safeAdd = (value: number, delta: number) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(Number.MIN_SAFE_INTEGER, value + delta));
  const userLife = controller === "user" ? safeAdd(state.userLife, gain) : state.userLife;
  const opponents = state.opponents.map((opponent) => {
    const delta = (opponent.id === controller ? gain : 0) - (event.templateId === "remove-engine" && opponent.id === event.sourceId ? 3 : 0);
    const life = safeAdd(opponent.life, delta);
    return { ...opponent, life, eliminated: opponent.eliminated || Boolean(evaluateTrackedLoss({ ...opponent, life }, opponent.lossProtected)) };
  });
  const recipientName = controller === "user" ? "You" : recipient!.name;
  const detail = `${event.card} resolves.${gain > 0 ? ` ${recipientName} ${controller === "user" ? "gain" : "gains"} ${gain} life.` : ""}${event.templateId === "remove-engine" ? ` ${event.sourceName} loses 3 life.` : ""}${event.templateId === "destroy-creature" ? ` ${recipientName} ${controller === "user" ? "create" : "creates"} a 3/3 green Beast token even if a legal target survives destruction.` : ""} Apply the remaining effects and any replacements in your playtester; correct tracked totals if needed.`;
  return {
    patch: {
      userLife, opponents,
      activeThreat: opponents.find((opponent) => opponent.id === state.activeThreat?.ownerId)?.eliminated ? null : state.activeThreat,
      gameOver: opponents.every((opponent) => opponent.eliminated) ? "Every simulated opponent has left the game." : state.gameOver,
    } satisfies Partial<GameState>,
    detail,
  };
}
