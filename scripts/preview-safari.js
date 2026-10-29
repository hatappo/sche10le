// Local development preview only. These API substitutes are never packaged.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function createSafariPreviewServer() {
  const root = new URL("../", import.meta.url);
  const fixture = (await readFile(new URL("tests/fixtures/events.html", root), "utf8"))
    .replace("</head>", '<meta name="viewport" content="width=device-width, initial-scale=1" /></head>')
    .replace("</body>", `<button id="preview-launch" style="position:fixed;top:8px;right:8px;z-index:1">Safari UI試作を開く</button>
      <script src="/preview-api.js"></script><script src="/extension.js"></script><script src="/launch.js"></script></body>`);
  const bundle = await readFile(new URL(".output/safari-mv3/content-scripts/safari.js", root));
  const api = `(() => {
    const listeners = new Set();
    const key = 'sche10le-safari-preview';
    window.__safariPreview = {
      show() { for (const fn of listeners) fn({type: 'safari-show'}, {id: 'preview-safari'}); },
      failSave: false, failOpen: false, lastCalendar: '',
    };
    window.chrome = {
      runtime: {
        id: 'preview-safari',
        onMessage: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
        async sendMessage(message) {
          window.__safariPreview.lastCalendar = message.url;
          return {ok: !window.__safariPreview.failOpen};
        },
      },
      storage: {local: {
        async get() { return JSON.parse(localStorage.getItem(key) || '{}'); },
        async set(values) {
          if (window.__safariPreview.failSave) throw new Error('Preview save failure');
          localStorage.setItem(key, JSON.stringify({...await this.get(), ...values}));
        },
      }},
    };
  })();`;
  const routes = new Map([
    ["/", { type: "text/html", body: fixture }],
    ["/preview-api.js", { type: "text/javascript", body: api }],
    ["/extension.js", { type: "text/javascript", body: bundle }],
    ["/launch.js", { type: "text/javascript", body: "document.getElementById('preview-launch').onclick = () => window.__safariPreview.show(); window.__safariPreview.show();" }],
  ]);
  return createServer((req, res) => {
    const resource = routes.get(new URL(req.url, "http://localhost").pathname);
    if (!resource) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": `${resource.type};charset=utf-8`, "cache-control": "no-store" });
    res.end(resource.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createSafariPreviewServer();
  server.listen(4174, "127.0.0.1", () => {
    console.log("Safari UIプレビュー: http://127.0.0.1:4174（拡張APIは模擬。カレンダーは開きません）");
  });
}
