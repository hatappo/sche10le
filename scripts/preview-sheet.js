// Local development preview only. These API substitutes are never packaged.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function createSheetPreviewServer({ native = false } = {}) {
  const root = new URL("../", import.meta.url);
  let fixture = (await readFile(new URL("tests/fixtures/events.html", root), "utf8"))
    .replace("</head>", '<meta name="viewport" content="width=device-width, initial-scale=1" /></head>');
  if (!native) fixture = fixture.replace("</body>", `<button id="preview-launch" style="position:fixed;top:8px;right:8px;z-index:1">Sche10leを開く</button>
      <script src="/preview-api.js"></script><script src="/extension.js"></script><script src="/launch.js"></script></body>`);
  const bundle = native ? null : await readFile(new URL(".output/safari-mv3/content-scripts/sheet.js", root));
  const api = `(() => {
    const listeners = new Set();
    const key = 'sche10le-safari-preview';
    window.__sheetPreview = {
      show() { for (const fn of listeners) fn({type: 'sheet-show'}, {id: 'preview-safari'}, () => {}); },
      failSave: false,
    };
    window.chrome = {
      runtime: {
        id: 'preview-safari',
        onMessage: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
      },
      storage: {onChanged: {addListener() {}, removeListener() {}}, local: {
        async get() { return JSON.parse(localStorage.getItem(key) || '{}'); },
        async set(values) {
          if (window.__sheetPreview.failSave) throw new Error('Preview save failure');
          localStorage.setItem(key, JSON.stringify({...await this.get(), ...values}));
        },
      }},
    };
  })();`;
  const routes = new Map([
    ["/", { type: "text/html", body: fixture }],
    ...(native ? [] : [
      ["/preview-api.js", { type: "text/javascript", body: api }],
      ["/extension.js", { type: "text/javascript", body: bundle }],
      ["/launch.js", { type: "text/javascript", body: "document.getElementById('preview-launch').onclick = () => window.__sheetPreview.show(); window.__sheetPreview.show();" }],
    ]),
  ]);
  return createServer((req, res) => {
    const resource = routes.get(new URL(req.url, "http://localhost").pathname);
    if (!resource) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": `${resource.type};charset=utf-8`, "cache-control": "no-store" });
    res.end(resource.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const native = process.argv.includes("--native");
  const server = await createSheetPreviewServer({ native });
  const port = native ? 4175 : 4174;
  server.listen(port, "127.0.0.1", () => {
    console.log(native
      ? `Safari拡張の検証ページ: http://127.0.0.1:${port}（模擬APIなし。Safariの拡張メニューから起動してください）`
      : `共通UIプレビュー: http://127.0.0.1:${port}（設定APIは模擬。カレンダーのリンクは実際に開きます）`);
  });
}
