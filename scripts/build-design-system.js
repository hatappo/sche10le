// Build a self-contained design reference from checked-in sources and assets.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createThemeSelector } from "../lib/theme-selector.js";
import { THEMES, resolveTheme } from "../lib/themes.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const escape = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
const dataImage = async (path) =>
  `data:image/png;base64,${(await readFile(new URL(path, root))).toString("base64")}`;
const template = await read("docs/design/design-system.template.html");
const markdown = await read("docs/design/design-system.md");
const theme = await read("lib/theme.css");
const sheet = await read("lib/sheet.css");
const components = (await read("docs/design/components.html"))
  .replace("{{THEME}}", theme)
  .replace("{{PANEL_CSS}}", sheet)
  .replace("{{ICS_ICON}}", await read("lib/ics-icon.svg"))
  .replace("{{THEME_SELECTOR_SCRIPT}}", `const THEMES = ${JSON.stringify(THEMES)};\n${resolveTheme.toString()}\n${createThemeSelector.toString()}`)
  .replace("{{THEME_IDS}}", JSON.stringify(THEMES.map((theme) => theme.id)));
const overlay = components.replace('body data-demo="list"', 'body data-demo="pick"')
  .replace('class="sheet" data-mode="list"', 'class="sheet" data-mode="pick"')
  .replace('id="heading">日時を選ぶ', 'id="heading">タイトルを選択');
const descriptions = {
  paper: "基本背景",
  ink: "主文と見出し",
  accent: "操作中の文字と枠",
  muted: "補足とメタ情報",
  line: "罫線と通常の境界",
  wash: "ホバーの淡い面",
  focus: "キーボードのフォーカス",
};
// Show the default palette only, not the final theme override in this stylesheet.
const defaults = Object.fromEntries(
  [...theme.slice(0, theme.indexOf("\n}"))
    .matchAll(/--([\w-]+):\s*(#[\da-f]+)/gi)]
    .map((match) => [match[1], match[2]]),
);
const colors = Object.fromEntries(Object.keys(descriptions).map((name) => [name, defaults[name]]));
const swatches = Object.entries(colors)
  .map(
    ([name, value]) =>
      `<article class="swatch" style="--swatch:${value}"><div class="swatch-color"></div><div class="swatch-info"><strong>--${name}</strong><span>${value}</span><p>${descriptions[name]}</p></div></article>`,
  )
  .join("\n");
function luminance(hex) {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((values[0] + 0.05) / (values[1] + 0.05)).toFixed(2);
};
const version = JSON.parse(await read("package.json")).version;
if (!markdown.includes(`拡張機能 ${version}`))
  throw new Error("Markdownの対象バージョンを更新してください");
const values = {
  VERSION: version,
  COMMIT: execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  ICON16: await dataImage("public/icons/16.png"),
  ICON32: await dataImage("public/icons/32.png"),
  ICON48: await dataImage("public/icons/48.png"),
  ICON128: await dataImage("public/icons/128.png"),
  SMALL: await dataImage("store/promotional/small-440x280.png"),
  MARQUEE: await dataImage("store/promotional/marquee-1400x560.png"),
  SWATCHES: swatches,
  INK_CONTRAST: contrast(colors.ink, colors.paper),
  MUTED_CONTRAST: contrast(colors.muted, colors.paper),
  COMPONENTS: escape(components.replace(/[\t ]+$/gm, "")),
  THEME_OPTIONS: THEMES.map((theme) => `<option value="${theme.id}">${theme.name}（${theme.reading}）</option>`).join(""),
  OVERLAY: escape(overlay.replace(/[\t ]+$/gm, "")),
  MD_LINES: String(markdown.trimEnd().split("\n").length),
  MARKDOWN: escape(markdown),
  MD_JSON: JSON.stringify(markdown).replaceAll("<", "\\u003c"),
};
const html = template.replace(/\{\{([A-Z_0-9]+)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error(`不明なプレースホルダー: ${key}`);
  return values[key];
});
await writeFile(new URL("docs/design/design-system.html", root), html);
console.log(
  `design-system.html: ${Buffer.byteLength(html).toLocaleString()} bytes / v${version}`,
);
