import { test, expect } from "@playwright/test";
import { fixture, loadFixture, stored } from "./fixtures.mjs";
import { CORE_ENCOUNTERS } from "../../app/simulator.ts";

test.beforeEach(async ({ page }) => {
  await page.route("https://api.scryfall.com/**", (route) => route.abort());
  page.on("pageerror", (error) => { throw error; });
});

test("spell outcome, target controller, undo, and reload", async ({ page }) => {
  await loadFixture(page, fixture("exile-commander"));
  await page.getByRole("button", { name: "No response", exact: true }).click();
  await page.getByLabel("Exiled creature’s power", { exact: false }).fill("7");
  await page.getByLabel("Target’s controller at resolution").selectOption("two");
  await page.getByRole("button", { name: "Confirm outcome" }).click();
  await expect.poll(async () => (await stored(page)).opponents[1].life).toBe(47);
  await page.reload();
  await expect(page.getByText(/Two gains 7 life/).first()).toBeVisible();
  await page.getByRole("button", { name: "Add one life to you", exact: true }).click();
  await expect.poll(async () => (await stored(page)).userLife).toBe(41);
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect.poll(async () => (await stored(page)).userLife).toBe(40);
});

test("illegal target after protection does not grant Claim life", async ({ page }) => {
  await loadFixture(page, fixture());
  await page.getByRole("button", { name: /Yes, I respond/ }).click();
  await page.getByRole("button", { name: /Use protection/ }).click();
  await page.getByRole("combobox", { name: "Spell result", exact: true }).selectOption("illegal");
  await page.getByRole("button", { name: "Confirm outcome" }).click();
  await expect.poll(async () => (await stored(page)).responseStage).toBe("resolved");
  expect((await stored(page)).userLife).toBe(40);
});

test("Toxic Deluge costs survive reload and are not paid again", async ({ page }) => {
  await loadFixture(page, fixture("minus-wipe"));
  await page.getByLabel("Life paid for X", { exact: false }).fill("5");
  await page.getByRole("button", { name: /Yes, I respond/ }).click();
  await expect.poll(async () => (await stored(page)).opponents[0].life).toBe(35);
  await page.reload();
  await page.getByRole("button", { name: /Other legal answer/ }).click();
  await expect.poll(async () => (await stored(page)).responseStage).toBe("resolved");
  expect((await stored(page)).opponents[0].life).toBe(35);
});

test("counter exchanges remain playable after reload", async ({ page }) => {
  const game = fixture("destroy-wipe", { responseStage: "counterback", counterExchange: 1 });
  await loadFixture(page, game);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your answer is countered." })).toBeVisible();
  await page.getByRole("button", { name: "Let the original resolve" }).click();
  await expect.poll(async () => (await stored(page)).responseStage).toBe("resolved");
});

test("lethal incoming combat, recovery, and one-step undo", async ({ page }) => {
  const game = fixture();
  game.currentEvent = { id: "attack", templateId: "scaled-attack", kind: "attack", sourceId: "one", sourceName: "One", title: "Combat test", prompt: "One attacks you.", card: "Combat", tags: [], responseOptions: [], attackers: [{ id: "a", name: "Attacker", power: 1, toughness: 1, keywords: ["First strike", "Infect"], isCommander: false }] };
  game.userPoisonCounters = 9;
  await loadFixture(page, game);
  await page.getByRole("button", { name: "Take the full attack" }).click();
  await expect(page.getByRole("dialog", { name: "The goldfish game ended" })).toBeVisible();
  expect((await stored(page)).userPoisonCounters).toBe(10);
  await page.getByRole("button", { name: "Undo last change" }).click();
  await page.getByRole("button", { name: "Fog / stop combat" }).click();
  await expect.poll(async () => (await stored(page)).responseStage).toBe("resolved");
  expect((await stored(page)).userPoisonCounters).toBe(9);
  await page.reload();
  await expect(page.getByText(/Combat was prevented|No combat damage|0 life damage/i).first()).toBeVisible();
});

test("another tab requires an explicit save-conflict choice", async ({ page, context }) => {
  await loadFixture(page, fixture());
  const second = await context.newPage(); await second.goto("/");
  await expect(second.getByRole("status").filter({ hasText: "Saved locally" })).toBeVisible();
  await page.getByRole("button", { name: "Add one life to you", exact: true }).click();
  await second.getByRole("button", { name: "Keep this tab" }).click();
  await expect.poll(async () => (await stored(second)).userLife).toBe(40);
  await page.getByRole("button", { name: "Load saved version" }).click();
  await expect(page.getByRole("button", { name: "Load saved version" })).toHaveCount(0);
});

test("failed previews expose retry and a keyboard-accessible reference", async ({ page }) => {
  await loadFixture(page, fixture());
  const preview = page.getByRole("button", { name: "Nature’s Claim", exact: true });
  await preview.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: /Read Nature’s Claim on Scryfall/ })).toBeVisible();
  await page.unroute("https://api.scryfall.com/**");
  await page.route("https://api.scryfall.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="black"/></svg>' }));
  await page.getByRole("button", { name: "Retry image" }).click();
  await expect(page.getByRole("img", { name: "Nature’s Claim card", exact: true })).toBeVisible();
  await expect(page.getByText("Card image unavailable.", { exact: false })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("an expired Oracle clock opens an answerable win attempt", async ({ page }) => {
  const game = fixture("combo-clock", { responseStage: "resolved" });
  game.activeThreat = { ...game.currentEvent.threat, remaining: 1 };
  await loadFixture(page, game);
  await page.getByRole("button", { name: /Next round/ }).click();
  await expect(page.getByRole("button", { name: "I stopped the attempt" })).toBeVisible();
  expect((await stored(page)).gameOver).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "I stopped the attempt" }).click();
  await expect.poll(async () => (await stored(page)).answeredCount).toBe(1);
});

test("Reservoir payment reload and nonlethal damage continue the run", async ({ page }) => {
  const game = fixture("artifact-clock", { responseStage: "resolved", userLife: 60 });
  game.opponents[0].life = 60; game.activeThreat = { ...game.currentEvent.threat, remaining: 1 };
  await loadFixture(page, game);
  await page.getByRole("button", { name: /Next round/ }).click();
  await page.getByRole("button", { name: "Pay 50 life and activate" }).click();
  await expect.poll(async () => (await stored(page)).opponents[0].life).toBe(10);
  await page.reload();
  await page.getByRole("button", { name: "Resolve activation damage" }).click();
  await expect.poll(async () => (await stored(page)).userLife).toBe(10);
  expect((await stored(page)).gameOver).toBeNull();
});

test("a defended Craterhoof attempt is not an automatic loss", async ({ page }) => {
  const game = fixture("combat-clock", { responseStage: "resolved" }); game.activeThreat = { ...game.currentEvent.threat, remaining: 1 };
  await loadFixture(page, game);
  await page.getByRole("button", { name: /Next round/ }).click();
  await page.getByRole("button", { name: "Fog / stop combat" }).click();
  await expect.poll(async () => (await stored(page)).responseStage).toBe("resolved");
  expect((await stored(page)).gameOver).toBeNull();
});

test("core-card results persist development and final totals", async ({ page }) => {
  const game = fixture(); const core = CORE_ENCOUNTERS.find((card) => card.card === "Scavenging Ooze");
  game.opponents[0].profile = core.profile; game.opponents[0].bracket = core.bracket;
  game.currentEvent = { ...game.currentEvent, ...core, templateId: core.id };
  await loadFixture(page, game);
  await page.getByRole("spinbutton", { name: "One’s final life", exact: true }).fill("41");
  await page.getByRole("checkbox", { name: /I checked prerequisites/ }).check();
  await page.getByRole("button", { name: "Record core-card outcome" }).click();
  await expect.poll(async () => (await stored(page)).opponents[0].development).toBe("established");
  await page.reload();
  expect((await stored(page)).opponents[0].life).toBe(41);
});

test("wipe setbacks are explicitly chosen and survive reload", async ({ page }) => {
  await loadFixture(page, fixture("destroy-wipe"));
  await page.getByRole("button", { name: "No response", exact: true }).click();
  await page.getByRole("button", { name: "Record affected boards" }).click();
  await page.getByRole("combobox", { name: "One’s board", exact: true }).selectOption("rebuilding");
  await page.getByRole("button", { name: "Save board development" }).click();
  await expect.poll(async () => (await stored(page)).opponents[0].development).toBe("rebuilding");
  await page.reload();
  await expect(page.getByRole("button", { name: "rebuilding · update board", exact: true })).toBeVisible();
});
