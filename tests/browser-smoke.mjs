import assert from "node:assert/strict";

// Operator-run with an existing Codex Browser tab; never launches another browser.
// Use a disposable Preview deployment or localhost, not a player's production tab.
export async function runBrowserSmoke(tab, url, { vercelBuild } = {}) {
  const target = new URL(url);
  const local = ["localhost", "127.0.0.1"].includes(target.hostname);
  assert.ok(local || (target.protocol === "https:" && target.hostname.endsWith(".vercel.app") && target.hostname !== "mtg-betafish.vercel.app"), "Use localhost or a disposable Vercel Preview URL");

  await tab.goto(target.href);
  await tab.playwright.getByRole("heading", { name: /^(The table acts\.|Action resolved\.)$/ }).waitFor({ state: "visible" });
  const saved = tab.playwright.getByRole("status").filter({ hasText: /Saved locally/i });
  await saved.waitFor({ state: "visible" });

  const player = tab.playwright.getByRole("article").filter({ hasText: "Your board" });
  const readLife = async () => {
    const match = (await player.innerText()).match(/\n(-?\d+)\nLIFE\b/i);
    assert.ok(match, "The player's life total must be visible");
    return Number(match[1]);
  };
  const originalLife = await readLife();
  assert.ok(Number.isSafeInteger(originalLife) && originalLife > 0 && originalLife < Number.MAX_SAFE_INTEGER, "Use a nonterminal disposable session");

  try {
    await tab.playwright.getByRole("button", { name: "Add one life to you", exact: true }).click();
    await player.getByText(String(originalLife + 1), { exact: true }).waitFor({ state: "visible" });
    await saved.waitFor({ state: "visible" });
    assert.equal(await readLife(), originalLife + 1, "Life controls must hydrate");

    await tab.reload();
    await saved.waitFor({ state: "visible" });
    assert.equal(await readLife(), originalLife + 1, "Saved life must survive a reload");
  } finally {
    // Restore only our single increment; never overwrite another session change.
    if (await readLife() === originalLife + 1) {
      await tab.playwright.getByRole("button", { name: "Remove one life from you", exact: true }).click();
      await player.getByText(String(originalLife), { exact: true }).waitFor({ state: "visible" });
      await saved.waitFor({ state: "visible" });
    }
  }

  await tab.playwright.getByRole("button", { name: "Table setup", exact: true }).click();
  await tab.playwright.getByRole("dialog", { name: "Set up the table", exact: true }).waitFor({ state: "visible" });
  await tab.playwright.getByRole("button", { name: "Close Set up the table", exact: true }).click();
  await tab.playwright.getByRole("button", { name: /^Scenario library/ }).click();
  await tab.playwright.getByRole("dialog", { name: "Curated scenario-card library", exact: true }).waitFor({ state: "visible" });
  await tab.playwright.getByRole("button", { name: "Close Curated scenario-card library", exact: true }).click();

  const scripts = await tab.playwright.evaluate(() => Array.from(document.scripts, (script) => script.dataset.sdkn).filter(Boolean));
  const expectedMonitoringCount = (vercelBuild ?? !local) ? 1 : 0;
  for (const sdk of ["@vercel/analytics/react", "@vercel/speed-insights/react"]) {
    assert.equal(scripts.filter((name) => name === sdk).length, expectedMonitoringCount, `${sdk} script count must match the build environment`);
  }
  const errors = await tab.dev.logs({ levels: ["error"], limit: 20 });
  assert.equal(errors.length, 0, `Browser console errors: ${JSON.stringify(errors)}`);
  return { hydration: "passed", reloadPersistence: "passed", dialogs: "passed", monitoringScripts: "passed", consoleErrors: 0 };
}
