// Build a self-contained design reference from checked-in sources and assets.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

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
const sidebar = (await read("entrypoints/sidepanel/style.css")).replace(
  /^@import[^;]+;/m,
  "",
);
const components = (await read("docs/design/components.html"))
  .replace("{{THEME}}", theme)
  .replace("{{PANEL_CSS}}", sidebar)
  .replace("{{BRAND_ICON}}", await dataImage("public/icons/32.png"));
const picker = await read("lib/picker.js");
const pickerStyle = picker.match(/style\.textContent = `([\s\S]*?)`;/)?.[1];
if (!pickerStyle) throw new Error("取得バーのCSSを読み取れません");
const overlay = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${pickerStyle}
html,body {margin:0;background:#e9ede4} .guide {animation:none} </style></head><body>
<div class="guide" role="region" aria-label="取得バーの静的見本"><div class="instruction-row"><div class="instruction"><strong>ページ上の文字をクリック</strong><span class="hint">タイトルにする文字を選択してください</span></div><button class="close-button" title="選択モードを閉じる（Esc）" aria-label="選択モードを閉じる"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
<div class="toolbar"><div class="step-list"><button aria-current="step"><span class="step-label">タイトル</span><span class="step-check" aria-hidden="true">✓</span></button><button><span class="step-label">場所</span><span class="step-check" aria-hidden="true">✓</span></button><button><span class="step-label">詳細</span><span class="step-check" aria-hidden="true">✓</span></button></div><div class="controls"><button disabled>戻る</button><button>スキップ</button></div></div></div></body></html>`;
const colors = Object.fromEntries(
  [...theme.matchAll(/--(\w+):\s*(#[\da-f]+)/gi)].map((match) => [
    match[1],
    match[2],
  ]),
);
const descriptions = {
  paper: "基本背景",
  ink: "主文と見出し",
  green: "ブランドと主操作",
  muted: "補足とメタ情報",
  line: "罫線と通常の境界",
  wash: "ホバーの淡い面",
  ochre: "点とフォーカス",
};
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
