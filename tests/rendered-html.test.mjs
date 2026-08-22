import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";

async function render() {
  return worker.fetch(
    new Request("https://goldfish-lab.example/", { headers: { accept: "text/html", host: "goldfish-lab.example" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Goldfish Lab product shell and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Goldfish Lab — Commander Playtest Companion<\/title>/i);
  assert.match(html, /The table acts\./);
  assert.match(html, /Assign your combat damage/);
  assert.match(html, /Scenario library/);
  assert.match(html, /https:\/\/goldfish-lab\.example\/og\.png/);
});
