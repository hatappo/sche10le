import themeCss from "./theme.css?inline";
import { applyTheme } from "./themes.js";
import { compactText } from "./source-locator.js";

/** Maps visible text to DOM ranges once per scan; never changes the page's markup.
 * The bounded index is discarded when the page UI is destroyed.
 * @param {() => DOMRect | undefined} [obstruction]
 */
export function createSourceHighlight(obstruction = () => undefined) {
  let text = "";
  /** @type {{node: Text, start: number, end: number}[]} */
  let positions = [];
  /** @type {Range | undefined} */
  let activeRange;
  let frame = 0;
  /** @type {{range: Range, node: HTMLSpanElement}[]} */
  let candidateBadges = [];
  const host = document.createElement("sche10le-source-highlight");
  host.style.cssText =
    "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646";
  host.setAttribute("aria-hidden", "true");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    ${themeCss}
    .shade { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; }
    .mark { position:fixed; pointer-events:none; border-radius:5px;
      background:color-mix(in srgb,var(--source-fill) 24%,transparent); outline:2px solid var(--source-border); }
    .source-marker { position:fixed; padding:2px 6px; border-radius:4px; background:var(--surface); color:var(--accent); border:1px solid var(--line); font:600 12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; box-shadow:0 2px 8px #0002; }
    .mark::after { content:""; position:absolute; inset:-2px; border-radius:inherit;
      animation:wave 1.1s ease-out 3; }
    @keyframes wave {
      0% { box-shadow:0 0 0 0 color-mix(in srgb,var(--source-pulse) 40%,transparent); background:color-mix(in srgb,var(--source-fill) 20%,transparent); }
      100% { box-shadow:0 0 0 12px transparent; background:transparent; }
    }
    @media (prefers-reduced-motion:reduce) { .mark::after { animation:none; } }
  `;
  const svgNamespace = "http://www.w3.org/2000/svg";
  const shade = document.createElementNS(svgNamespace, "svg");
  shade.setAttribute("class", "shade");
  shade.style.visibility = "hidden";
  const defs = document.createElementNS(svgNamespace, "defs");
  const mask = document.createElementNS(svgNamespace, "mask");
  mask.id = "source-cutout";
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", "0");
  mask.setAttribute("y", "0");
  const base = document.createElementNS(svgNamespace, "rect");
  base.setAttribute("width", "100%");
  base.setAttribute("height", "100%");
  base.setAttribute("fill", "white");
  const holes = document.createElementNS(svgNamespace, "g");
  holes.setAttribute("fill", "black");
  mask.append(base, holes);
  defs.append(mask);
  const dim = document.createElementNS(svgNamespace, "rect");
  dim.setAttribute("width", "100%");
  dim.setAttribute("height", "100%");
  dim.style.fill = "var(--source-shade)";
  dim.setAttribute("fill-opacity", "0.48");
  dim.setAttribute("mask", "url(#source-cutout)");
  shade.append(defs, dim);
  const marks = document.createElement("div");
  const badge = document.createElement("span");
  badge.className = "source-marker";
  const badgeLayer = document.createElement("div");
  shadow.append(style, shade, marks, badgeLayer, badge);

  function clear() {
    activeRange = undefined;
    badge.textContent = "";
    badge.hidden = true;
    cancelAnimationFrame(frame);
    shade.style.visibility = "hidden";
    if (!candidateBadges.length) host.remove();
    else schedulePaint();
    marks.replaceChildren();
    holes.replaceChildren();
  }

  function capture() {
    showMarkers([]);
    clear();
    text = "";
    positions = [];
    if (!document.body) return;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let visited = 0;
    let current;
    while (
      (current = walker.nextNode()) &&
      visited++ < 20_000 &&
      text.length < 100_000
    ) {
      const node = /** @type {Text} */ (current);
      const parent = node.parentElement;
      if (
        !parent ||
        !node.data.trim() ||
        parent.closest("script,style,noscript,textarea,select,[hidden]")
      )
        continue;
      if (
        !parent.checkVisibility({
          visibilityProperty: true,
          contentVisibilityAuto: true,
        })
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (
        ![...range.getClientRects()].some((rect) => rect.width && rect.height)
      )
        continue;
      // Keep original UTF-16 offsets even for full-width and expanded NFKC characters.
      let offset = 0;
      for (const character of node.data) {
        const normalized = compactText(character);
        text += normalized;
        for (let i = 0; i < normalized.length; i++)
          positions.push({
            node,
            start: offset,
            end: offset + character.length,
          });
        offset += character.length;
        if (text.length >= 100_000) break;
      }
    }
  }

  /** @param {Range} range @param {HTMLElement} node */
  function positionBadge(range, node) {
    const view = window.visualViewport;
    const top = view?.offsetTop ?? 0, left = view?.offsetLeft ?? 0;
    const right = left + (view?.width ?? innerWidth), bottom = top + (view?.height ?? innerHeight);
    const valid = range.startContainer.isConnected && range.endContainer.isConnected;
    const rect = valid ? [...range.getClientRects()].find(rect => rect.width && rect.height &&
      rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right) : undefined;
    node.hidden = !rect;
    if (!rect) return;
    node.style.left = `${Math.max(left + 4, Math.min(rect.left, right - node.offsetWidth - 4))}px`;
    node.style.top = `${Math.max(top + 4, rect.top - node.offsetHeight - 5)}px`;
  }

  function paint() {
    for (const {range, node} of candidateBadges) {
      positionBadge(range, node);
      if (activeRange && node.textContent === badge.textContent) node.hidden = true;
    }
    if (!activeRange) return;
    if (
      !activeRange.startContainer.isConnected ||
      !activeRange.endContainer.isConnected
    ) {
      clear();
      return;
    }
    // Inline elements can report duplicate rectangles. Join them into one mark per line.
    /** @type {DOMRect[]} */
    const rects = [];
    for (const rect of [...activeRange.getClientRects()]
      .filter((rect) => rect.width && rect.height)
      .slice(0, 80)) {
      const previous = rects.at(-1);
      if (
        previous &&
        Math.abs(previous.top - rect.top) < 4 &&
        rect.left <= previous.right + 6 &&
        rect.right >= previous.left
      ) {
        const left = Math.min(previous.left, rect.left);
        const top = Math.min(previous.top, rect.top);
        rects[rects.length - 1] = new DOMRect(
          left,
          top,
          Math.max(previous.right, rect.right) - left,
          Math.max(previous.bottom, rect.bottom) - top,
        );
      } else rects.push(rect);
    }
    while (marks.children.length > rects.length)
      marks.lastElementChild?.remove();
    shade.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
    mask.setAttribute("width", String(innerWidth));
    mask.setAttribute("height", String(innerHeight));
    // Do not dim the entire page while smooth scrolling toward an off-screen source.
    shade.style.visibility = rects.some(
      (rect) =>
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth,
    )
      ? "visible"
      : "hidden";
    const view = window.visualViewport;
    const viewTop = view?.offsetTop ?? 0;
    const viewLeft = view?.offsetLeft ?? 0;
    const viewRight = viewLeft + (view?.width ?? innerWidth);
    const viewBottom = viewTop + (view?.height ?? innerHeight);
    const visible = rects.find(rect => rect.bottom > viewTop && rect.top < viewBottom && rect.right > viewLeft && rect.left < viewRight);
    badge.hidden = !visible || !badge.textContent;
    if (visible) {
      badge.style.left = `${Math.max(viewLeft + 4, Math.min(visible.left, viewRight - badge.offsetWidth - 4))}px`;
      badge.style.top = `${Math.max(viewTop + 4, visible.top - badge.offsetHeight - 5)}px`;
    }
    while (holes.children.length > rects.length)
      holes.lastElementChild?.remove();
    rects.forEach((rect, index) => {
      // Multiple holes share one mask, so overlapping lines never darken each other.
      const hole =
        holes.children[index] ?? document.createElementNS(svgNamespace, "rect");
      const paddingX = Math.max(8, (40 - rect.width) / 2);
      const paddingY = Math.max(8, (32 - rect.height) / 2);
      hole.setAttribute("x", String(rect.left - paddingX));
      hole.setAttribute("y", String(rect.top - paddingY));
      hole.setAttribute("width", String(rect.width + paddingX * 2));
      hole.setAttribute("height", String(rect.height + paddingY * 2));
      hole.setAttribute("rx", "7");
      if (!hole.isConnected) holes.append(hole);
      const mark = /** @type {HTMLElement} */ (
        marks.children[index] ?? document.createElement("div")
      );
      mark.className = "mark";
      mark.style.cssText = `left:${rect.left - 2}px;top:${rect.top - 2}px;width:${rect.width + 4}px;height:${rect.height + 4}px`;
      if (!mark.isConnected) marks.append(mark);
    });
  }
  function schedulePaint() {
    if (!activeRange && !candidateBadges.length) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  }

  /** @param {import('./source-locator.js').SourceLocator | undefined} locator */
  function resolveRange(locator) {
    if (
      !locator ||
      typeof locator.text !== "string" ||
      !locator.text ||
      !Number.isInteger(locator.occurrence) ||
      locator.occurrence < 0 ||
      locator.occurrence > 1000
    )
      return;
    let start = -locator.text.length;
    for (let i = 0; i <= locator.occurrence; i++) {
      start = text.indexOf(locator.text, start + locator.text.length);
      if (start < 0) return;
    }
    const first = positions[start];
    const last = positions[start + locator.text.length - 1];
    if (!first?.node.isConnected || !last?.node.isConnected) return;
    const range = document.createRange();
    if (first.start > first.node.length || last.end > last.node.length) return;
    range.setStart(first.node, first.start);
    range.setEnd(last.node, last.end);
    // A dynamic page may have changed since the scan. Never highlight stale offsets.
    if (compactText(range.toString()) !== locator.text) return;
    return range;
  }

  /** @param {{locator: import('./source-locator.js').SourceLocator | undefined, marker: string}[]} entries */
  function showMarkers(entries) {
    candidateBadges = [];
    badgeLayer.replaceChildren();
    for (const entry of entries) {
      const range = resolveRange(entry.locator);
      if (!range) continue;
      const node = document.createElement("span");
      node.className = "source-marker candidate-source-marker";
      node.textContent = entry.marker;
      badgeLayer.append(node);
      candidateBadges.push({range, node});
    }
    if (candidateBadges.length) {
      if (!host.isConnected) document.documentElement.append(host);
      paint();
    } else if (!activeRange) host.remove();
  }

  /** @param {import('./source-locator.js').SourceLocator | undefined} locator @param {string} [marker] */
  function reveal(locator, marker = "") {
    clear();
    const range = resolveRange(locator);
    if (!range) return;
    activeRange = range;
    badge.textContent = marker;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // First reveal inside any nested scroll container, then place the source in the
    // unobscured viewport. No style or padding is written to the source page.
    range.startContainer.parentElement?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
    const rect = range.getBoundingClientRect();
    const blocked = obstruction();
    const viewTop = window.visualViewport?.offsetTop ?? 0;
    const viewBottom = viewTop + (window.visualViewport?.height ?? innerHeight);
    const bottom = blocked && rect.right > blocked.left && rect.left < blocked.right
      ? Math.min(viewBottom, blocked.top - 16) : viewBottom;
    window.scrollBy({ top: rect.top + rect.height / 2 - (viewTop + bottom) / 2,
      behavior: reduced ? "instant" : "smooth" });
    document.documentElement.append(host);
    paint();
  }
  window.addEventListener("scroll", schedulePaint, true);
  window.addEventListener("resize", schedulePaint);
  window.visualViewport?.addEventListener("resize", schedulePaint);
  window.visualViewport?.addEventListener("scroll", schedulePaint);
  return {
    setTheme: (/** @type {unknown} */ value) => applyTheme(host, value),
    capture,
    showMarkers,
    reveal,
    clear,
    destroy() {
      showMarkers([]);
      clear();
      text = "";
      positions = [];
      window.removeEventListener("scroll", schedulePaint, true);
      window.removeEventListener("resize", schedulePaint);
      window.visualViewport?.removeEventListener("resize", schedulePaint);
      window.visualViewport?.removeEventListener("scroll", schedulePaint);
    },
  };
}
