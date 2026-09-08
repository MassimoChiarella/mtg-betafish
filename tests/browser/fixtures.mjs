import { expect } from "@playwright/test";
import { CATALOG_REVISION, GAME_STATE_VERSION } from "../../app/session.ts";
import { EVENT_TEMPLATES, generateEvent } from "../../app/simulator.ts";

export function fixture(templateId = "early-rock", patch = {}) {
  const opponents = ["one", "two"].map((id, index) => ({ id, name: index ? "Two" : "One", profile: "midrange", bracket: 3, life: 40, poisonCounters: 0, commanderDamage: {}, lossProtected: false, eliminated: false }));
  const template = EVENT_TEMPLATES.find((item) => item.id === templateId);
  const currentEvent = template ? { ...template, id: "browser-event", templateId, sourceId: "one", sourceName: "One", threat: template.kind === "threat" ? { id: "browser-threat", ownerId: "one", title: template.title, description: template.prompt, remaining: 2, delayed: false } : undefined } : generateEvent({ turn: 6, counter: 1, seed: "BROWSER", opponents, recentTemplateIds: [], activeThreat: false });
  return { version: GAME_STATE_VERSION, catalogRevision: CATALOG_REVISION, turn: 6, eventCounter: 1, defenseCounter: 0, seed: "BROWSER", opponents, userLife: 40, userLossProtected: false, userPoisonCounters: 0, userCommanderDamage: {}, currentEvent, responseStage: "prompt", resolution: "", toxicDelugePayment: null, activeThreat: null, recentTemplateIds: [], history: [], answeredCount: 0, combatResolvedTurn: null, counterExchange: 0, gameOver: null, ...patch };
}

export async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("goldfish-lab-session-v1"))?.state);
}

export async function loadFixture(page, state) {
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Saved locally" })).toBeVisible();
  await page.getByRole("button", { name: "Save / restore", exact: true }).click();
  await page.getByLabel("Import session file").setInputFiles({ name: "session.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "mtg-betafish-session", state })) });
  await page.getByRole("button", { name: "Replace run with this session" }).click();
  await expect.poll(async () => (await stored(page)).seed).toBe(state.seed);
}
