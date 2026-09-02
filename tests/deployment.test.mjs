import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const publicDirectory = new URL("../dist/client/", import.meta.url);
const html = await readFile(new URL("index.html", publicDirectory), "utf8");

test("static deployment includes the HTML, hydration scripts, styles, and images", async () => {
  assert.match(html, /<html\b/);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
  const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0, "export must include hydration scripts");
  assert.ok(styles.length > 0, "export must include CSS");
  for (const asset of [...scripts, ...styles, "/og.png", "/fish-icon.png"]) {
    const url = new URL(asset, "https://static.example");
    assert.equal(url.origin, "https://static.example", "application assets must be local");
    const file = new URL(`.${url.pathname}`, publicDirectory);
    assert.ok(file.href.startsWith(publicDirectory.href), "asset must stay inside the public directory");
    const details = await stat(file);
    assert.ok(details.isFile() && details.size > 0, `missing or empty asset: ${asset}`);
  }
});

test("exported metadata has an absolute, consistent public origin", () => {
  const meta = (name) => html.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]+)"`))?.[1];
  assert.equal(meta("description"), "Stress-test Commander decks against bracket-aware matchup profiles, interaction, combat pressure, and countdown threats.");
  assert.equal(meta("og:title"), "MTG Betafish — Commander Playtest Companion");
  assert.equal(meta("twitter:title"), meta("og:title"));
  assert.equal(meta("og:description"), meta("description"));
  assert.equal(meta("twitter:description"), meta("description"));
  assert.equal(meta("twitter:card"), "summary_large_image");
  assert.equal(meta("twitter:image"), meta("og:image"));
  const image = new URL(meta("og:image"));
  assert.ok(["http:", "https:"].includes(image.protocol));
  assert.equal(image.pathname, "/og.png");
  assert.equal(image.username, "");
  assert.equal(image.password, "");
  const configuredHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const configuredUrl = process.env.SITE_URL || (configuredHost ? `https://${configuredHost}` : undefined);
  if (configuredUrl) assert.equal(image.origin, new URL(configuredUrl).origin);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  assert.equal(new URL(canonical).href, `${image.origin}/`);
  assert.equal(meta("og:url"), canonical);
  if (process.env.VERCEL) {
    assert.equal(image.protocol, "https:");
    assert.notEqual(image.hostname, "localhost", "Vercel builds must use a public site URL");
  }
});

test("Web Analytics is mounted only for Vercel builds with public endpoint configuration", async () => {
  const rsc = await readFile(new URL("index.rsc", publicDirectory), "utf8");
  const enabled = process.env.VERCEL === "1";
  assert.equal(/:I\[[^\n]*,"Analytics",/.test(rsc), enabled);
  assert.equal(rsc.includes('"configString":'), enabled);
  if (enabled && process.env.VERCEL_OBSERVABILITY_CLIENT_CONFIG) {
    const config = JSON.parse(process.env.VERCEL_OBSERVABILITY_CLIENT_CONFIG).analytics;
    for (const key of ["scriptSrc", "viewEndpoint", "eventEndpoint"]) {
      if (config?.[key]) assert.ok(rsc.includes(config[key]), `missing public analytics ${key}`);
    }
  }
});

test("Vercel publishes only the static directory and caches only versioned assets immutably", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "dist/client");
  assert.equal(config.buildCommand, "npm run check");
  assert.equal(config.installCommand, "npm ci");
  assert.deepEqual(config.headers.map((rule) => [rule.source, rule.headers[0].key, rule.headers[0].value]), [
    ["/(.*)", "Cache-Control", "public, max-age=0, must-revalidate"],
    ["/_next/static/:path*", "Cache-Control", "public, max-age=31536000, immutable"],
  ]);
});
