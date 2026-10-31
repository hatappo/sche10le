import { readFile } from "node:fs/promises";

const root = new URL("../lib/", import.meta.url);
const artwork = await readFile(new URL("brand-mark.svg", root), "utf8");
export const BRAND_COLORS = {
  background: artwork.match(/<rect[^>]*fill="(#[\da-f]+)"/i)[1],
  foreground: artwork.match(/<text[^>]*fill="(#[\da-f]+)"/i)[1],
};

// Embed the same SVG for isolated/offline browser rendering of icons and tiles.
export async function brandStyles(palette = BRAND_COLORS) {
  const css = await readFile(new URL("brand.css", root), "utf8");
  const svg = Buffer.from(artwork.replaceAll(BRAND_COLORS.background, palette.background).replaceAll(BRAND_COLORS.foreground, palette.foreground));
  return css.replace("./brand-mark.svg", `data:image/svg+xml;base64,${svg.toString("base64")}`);
}
