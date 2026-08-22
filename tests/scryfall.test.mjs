import assert from "node:assert/strict";
import test from "node:test";
import { scryfallCardUrl, scryfallImageUrl } from "../app/scryfall.ts";

test("Scryfall card lookups encode names and accept only hosted normal art", () => {
  assert.equal(new URL(scryfallCardUrl("Fire // Ice")).searchParams.get("exact"), "Fire // Ice");
  assert.equal(new URL(scryfallCardUrl("Nature’s Claim")).searchParams.get("exact"), "Nature's Claim");
  assert.equal(scryfallImageUrl({ image_uris: { normal: "https://cards.scryfall.io/normal/front/card.jpg" } }), "https://cards.scryfall.io/normal/front/card.jpg");
  assert.equal(scryfallImageUrl({ card_faces: [{ image_uris: { normal: "https://cards.scryfall.io/normal/front/face.jpg" } }] }), "https://cards.scryfall.io/normal/front/face.jpg");
  assert.equal(scryfallImageUrl({ image_uris: { normal: "https://example.com/not-scryfall.jpg" } }), null);
  assert.equal(scryfallImageUrl({}), null);
});
