const normalizeCardName = (name: string) => name.replace(/[’‘]/g, "'");

export function scryfallImageUrl(name: string) {
  const url = new URL("https://api.scryfall.com/cards/named");
  url.searchParams.set("exact", normalizeCardName(name));
  url.searchParams.set("format", "image");
  url.searchParams.set("version", "normal");
  return url.toString();
}
