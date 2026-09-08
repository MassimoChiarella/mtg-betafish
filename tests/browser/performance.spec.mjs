import { test, expect } from "@playwright/test";
import { fixture, loadFixture, stored } from "./fixtures.mjs";

test("CPU-throttled mobile interaction measurements", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The lab scenario targets mobile Chromium.");
  test.setTimeout(60000);
  page.on("pageerror", (error) => { throw error; });
  await page.route("https://api.scryfall.com/**", (route) => route.abort());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    window.__lab = { longTasks: [], events: [], shifts: [], clicks: [], phase: "setup", interactionStartedAt: Infinity };
    const phase = (entry) => entry.startTime >= window.__lab.interactionStartedAt ? "interaction" : "setup";
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__lab.longTasks.push({ startTime: entry.startTime, duration: entry.duration, phase: phase(entry) }); }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.interactionId) window.__lab.events.push({ name: entry.name, target: (entry.target?.getAttribute("aria-label") || entry.target?.closest("label")?.textContent || entry.target?.textContent || "").trim().slice(0, 100), startTime: entry.startTime, duration: entry.duration, interactionId: entry.interactionId, phase: phase(entry) }); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__lab.shifts.push(entry.value); }).observe({ type: "layout-shift", buffered: true });
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!button || window.__lab.phase !== "interaction") return;
      const name = button.getAttribute("aria-label") || button.textContent.trim();
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => window.__lab.clicks.push({ name, nextFrameMs: performance.now() - start })));
    }, true);
  });
  const history = Array.from({ length: 40 }, (_, index) => ({ id: `lab-${index}`, turn: 6, title: "Recorded event", detail: "Confirmed in the playtester. ".repeat(5), tone: "neutral" }));
  await loadFixture(page, fixture(undefined, { history }));
  await page.evaluate(() => { window.__lab.interactionStartedAt = performance.now(); window.__lab.phase = "interaction"; });
  for (let index = 0; index < 10; index++) await page.getByRole("button", { name: "Add one life to you", exact: true }).click();
  await expect.poll(async () => (await stored(page)).userLife).toBe(50);
  await page.getByRole("button", { name: "Table setup", exact: true }).click();
  await page.getByLabel("Session seed", { exact: true }).fill("");
  await page.getByLabel("Session seed", { exact: true }).pressSequentially("MOBILE-CHECK", { delay: 30 });
  await page.screenshot({ path: testInfo.outputPath("mobile-setup.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "No response", exact: true }).click();
  await page.getByRole("button", { name: "Confirm outcome", exact: true }).click();
  await expect.poll(async () => (await stored(page)).responseStage).toBe("resolved");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const report = await page.evaluate(() => ({ ...window.__lab, viewport: { width: innerWidth, height: innerHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
  expect(report.horizontalOverflow).toBe(false);
  expect(report.clicks.length).toBeGreaterThanOrEqual(10);
  await testInfo.attach("mobile-performance", { body: JSON.stringify({ cpuSlowdown: 4, scope: "Local Chromium lab, blocked card images, warm imported session. Event durations have a 16ms reporting threshold; double-rAF is a rendering proxy, not field INP. No absolute latency gate across different CI hardware.", ...report }, null, 2), contentType: "application/json" });
  console.log(`Mobile lab: ${report.clicks.length} click/frame samples; ${report.longTasks.filter((entry) => entry.phase === "interaction").length} interaction long tasks; worst event ${Math.max(0, ...report.events.filter((entry) => entry.phase === "interaction").map((entry) => entry.duration))} ms.`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
