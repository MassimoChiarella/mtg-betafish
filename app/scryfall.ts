type CardImageData = {
  image_uris?: { normal?: unknown };
  card_faces?: { image_uris?: { normal?: unknown } }[];
};

const imageCache = new Map<string, Promise<string | null>>();
const normalizeCardName = (name: string) => name.replace(/[’‘]/g, "'");

export function scryfallCardUrl(name: string) {
  const url = new URL("https://api.scryfall.com/cards/named");
  url.searchParams.set("exact", normalizeCardName(name));
  return url.toString();
}

export function scryfallImageUrl(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const card = data as CardImageData;
  const image = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
  return typeof image === "string" && image.startsWith("https://cards.scryfall.io/") ? image : null;
}

export function loadCardImage(name: string) {
  const key = normalizeCardName(name).toLowerCase();
  if (!imageCache.has(key)) {
    const request = fetch(scryfallCardUrl(name), { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then(scryfallImageUrl)
      .catch(() => null);
    imageCache.set(key, request);
    void request.then((image) => { if (!image && imageCache.get(key) === request) imageCache.delete(key); });
  }
  return imageCache.get(key)!;
}
