import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("scenario-card names wrap without clipping in normal and threat badges", () => {
  const badge = css.match(/\.source-badge, \.danger-badge \{([^}]+)\}/)?.[1];
  assert.ok(badge);
  assert.match(badge, /white-space: normal/);
  assert.match(badge, /overflow-wrap: anywhere/);
  assert.doesNotMatch(badge, /overflow: hidden|text-overflow: ellipsis|white-space: nowrap/);

  const mobile = css.slice(css.indexOf("@media (max-width: 820px)"), css.indexOf("@media (max-width: 520px)"));
  assert.match(mobile, /\.card-topline \{[^}]*flex-direction: column/);
  assert.match(mobile, /\.source-badge, \.danger-badge \{[^}]*max-width: 100%/);
});

test("card-preview frames hug the image instead of stretching into the anchor area", () => {
  const panel = css.match(/\.card-preview-panel \{([^}]+)\}/)?.[1];
  assert.ok(panel);
  assert.match(panel, /height: fit-content/);
  assert.match(panel, /align-self: start/);
  assert.match(panel, /calc\(\(100dvh - 40px\) \* 488 \/ 680 \+ 16px\)/);
  assert.match(css, /\.card-preview-panel:popover-open \{ display: block; \}/);
  assert.match(css, /\.card-preview-panel img \{[^}]*height: auto;[^}]*aspect-ratio: 488 \/ 680/);
  assert.match(css, /\.card-preview-panel:has\(> img\) > \.card-preview-status \{ position: absolute; inset: 7px; \}/);
  assert.doesNotMatch(css, /\.card-preview-panel > \* \{[^}]*grid-area/);

  const compactScreens = css.slice(css.indexOf("@media (max-width: 900px), (max-height: 640px)"), css.indexOf("@media (max-width: 900px), (pointer: coarse)"));
  assert.match(compactScreens, /\.card-preview-panel \{ position-area: none; inset: 0; margin: auto; \}/);
});
