import assert from "node:assert/strict";
import test from "node:test";
import { scryfallImageUrl } from "../app/scryfall.ts";

test("Scryfall card previews use the direct, encoded normal-image endpoint", () => {
  const splitCard = new URL(scryfallImageUrl("Fire // Ice"));
  const apostrophe = new URL(scryfallImageUrl("Nature’s Claim"));
  assert.equal(splitCard.origin + splitCard.pathname, "https://api.scryfall.com/cards/named");
  assert.equal(splitCard.searchParams.get("exact"), "Fire // Ice");
  assert.equal(splitCard.searchParams.get("format"), "image");
  assert.equal(splitCard.searchParams.get("version"), "normal");
  assert.equal(apostrophe.searchParams.get("exact"), "Nature's Claim");
});
