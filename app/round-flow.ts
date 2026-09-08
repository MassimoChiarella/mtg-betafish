import type { EffectReminder, GameState } from "./session.ts";

export function activeReminders(state: Pick<GameState, "reminders" | "opponents">) {
  const living = (id: string) => state.opponents.some((opponent) => opponent.id === id && !opponent.eliminated);
  return state.reminders?.filter((reminder) => reminder.due === "source-next-turn" || (living(reminder.sourceId) && (reminder.recipientId === "user" || living(reminder.recipientId))));
}

// A cadence of table actions, not a replacement for Magic's priority/turn engine.
export function nextRoundAction(state: GameState) {
  const living = state.opponents.filter((opponent) => !opponent.eliminated);
  if (state.roundMode === "table") {
    const actedOpponentIds = [...new Set([...(state.actedOpponentIds ?? []), state.currentEvent.sourceId])].filter((id) => state.opponents.some((opponent) => opponent.id === id));
    const next = living.find((opponent) => !actedOpponentIds.includes(opponent.id));
    if (next) return { turn: state.turn, sourceId: next.id, actedOpponentIds, roundCombatIds: state.roundCombatIds ?? [] };
  }
  return { turn: Math.min(Number.MAX_SAFE_INTEGER, state.turn + 1), sourceId: state.roundMode === "table" ? living[0]?.id : undefined, actedOpponentIds: [], roundCombatIds: [] as string[] };
}

export function remindersAfterResolution(state: GameState, recipientId = "user"): EffectReminder[] {
  const event = state.currentEvent;
  const reminders = [...(state.reminders ?? [])];
  const recipientName = recipientId === "user" ? "You" : state.opponents.find((opponent) => opponent.id === recipientId)?.name;
  const add = (suffix: string, due: EffectReminder["due"], targetId: string, targetName: string, text: string) => {
    const id = suffix === "ring" ? `ring:${event.sourceId}` : `${event.id}:${suffix}`;
    if (!reminders.some((reminder) => reminder.id === id)) reminders.push({ id, sourceId: event.sourceId, sourceName: event.sourceName, recipientId: targetId, recipientName: targetName, due, card: event.card, text });
  };
  if (event.card === "Arcane Denial" && recipientName) {
    add("denial-target", "next-upkeep", recipientId, recipientName, "May draw up to two cards at the next turn’s upkeep, even if the target spell could not be countered.");
    add("denial-source", "next-upkeep", event.sourceId, event.sourceName, "Draw one card at the next turn’s upkeep.");
  }
  if (event.templateId === "goad") add("goad", "source-next-turn", "table", "Affected creatures", "Goad ends at the source’s next turn. If that player leaves, it ends when that turn would have begun, not immediately.");
  if (event.card === "Pact of Negation") add("pact", "source-next-upkeep", event.sourceId, event.sourceName, "At the source’s next upkeep, pay 3UU as the trigger resolves or lose the game. Confirm costs, interaction and any can’t-lose effect in the playtester.");
  if (event.card === "The One Ring") add("ring", "source-next-upkeep", event.sourceId, event.sourceName, "If The One Ring remains on the battlefield, its upkeep ability triggers even if a tap ability was countered. Lose life equal to the actual burden counters as that trigger resolves. This is one standing reminder, not an extra trigger per activation. Check later upkeeps in the playtester; dismiss if it leaves.");
  return reminders;
}
