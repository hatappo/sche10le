import { readFile } from "node:fs/promises";

const root = new URL("../lib/", import.meta.url);
const artwork = await readFile(new URL("brand-mark.svg", root), "utf8");
export const BRAND_COLORS = {
  background: artwork.match(/<rect[^>]*fill="(#[\da-f]+)"/i)[1],
  foreground: artwork.match(/<text[^>]*fill="(#[\da-f]+)"/i)[1],
};

// Embed the same SVG for isolated/offline browser rendering of icons and tiles.
export async function brandStyles(palette = BRAND_COLORS, { ios = false } = {}) {
  const css = await readFile(new URL("brand.css", root), "utf8");
  // The full-bleed iOS canvas needs a slightly larger, higher date than the tile.
  const layout = ios ? artwork
    .replace('<g id="date-mark">', '<g id="date-mark" transform="translate(0 -1.3) translate(16 21.5) scale(1.11) translate(-16 -21.5)">')
    .replace('d="M7 7.5h18"', 'd="M6.55 7.5h18.9"') : artwork;
  const svg = Buffer.from(layout.replaceAll(BRAND_COLORS.background, palette.background).replaceAll(BRAND_COLORS.foreground, palette.foreground));
  return css.replace("./brand-mark.svg", `data:image/svg+xml;base64,${svg.toString("base64")}`);
}
