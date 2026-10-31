import { readFile } from "node:fs/promises";

// Embed the same SVG for isolated/offline browser rendering of icons and tiles.
export async function brandStyles() {
  const root = new URL("../lib/", import.meta.url);
  const css = await readFile(new URL("brand.css", root), "utf8");
  const svg = await readFile(new URL("brand-mark.svg", root));
  return css.replace("./brand-mark.svg", `data:image/svg+xml;base64,${svg.toString("base64")}`);
}
