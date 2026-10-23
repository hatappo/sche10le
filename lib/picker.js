import { FIELD_LABELS } from "./draft.js";

/** The picker lives in a closed shadow root so page CSS cannot change its controls.
 * @param {(message: object) => void} notify
 */
export function createPicker(notify) {
  const host = document.createElement("sche10le-picker");
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box} :host{color-scheme:light}
    .outline{position:fixed;pointer-events:none;border:2px solid #275e49;background:#2d6d4914;border-radius:5px;box-shadow:0 0 0 3px #fff8;transition:top 70ms,left 70ms,width 70ms,height 70ms}
    .guide{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 32px);pointer-events:auto;display:flex;align-items:center;gap:12px;padding:12px 16px;background:#f9f8f2;color:#243e32;border:1px solid #d5dbcc;border-radius:14px;box-shadow:0 8px 40px #14291c2e;font:13px/1.5 'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;flex-wrap:wrap}
    strong{font-size:15px} .number{color:#647267;font:12px monospace} button{font:inherit;cursor:pointer;border:0;border-radius:7px;padding:8px 10px;background:#e8ece2;color:#254c3b;white-space:nowrap} button.primary{background:#285b43;color:white} button:focus-visible{outline:3px solid #ad7731;outline-offset:2px} button:hover{filter:brightness(.94)} button:disabled{opacity:.4;cursor:default} [hidden]{display:none!important}
    .step-list{display:flex;gap:4px;padding-right:12px;border-right:1px solid #d5dbcc}.step-list button{background:transparent;border:1px solid transparent}.step-list button[aria-current="step"]{background:#285b43;color:white;box-shadow:0 0 0 3px #285b4315;font-weight:700}.step-list button.done{border-color:#b8cbb1}.guide.complete strong{color:#285b43;font-size:13px}
    @media(prefers-reduced-motion:reduce){.outline{transition:none}}
  `;
  const outline = document.createElement("div");
  outline.className = "outline";
  outline.hidden = true;
  const guide = document.createElement("div");
  guide.className = "guide";
  guide.setAttribute("role", "region");
  guide.setAttribute("aria-label", "Sche10le ページから取得");
  const progress = document.createElement("span");
  progress.className = "number";
  const label = document.createElement("strong");
  label.setAttribute("aria-live", "polite");
  const stepList = document.createElement("div");
  stepList.className = "step-list";
  const stepButtons = FIELD_LABELS.map((name, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${index + 1} ${name}`;
    button.setAttribute("aria-label", `${name}を選び直す`);
    button.addEventListener("click", () =>
      notify({ type: "choose-field", fieldIndex: index, token, step }),
    );
    stepList.append(button);
    return button;
  });
  guide.append(stepList, progress, label);
  /** @type {Map<string, HTMLButtonElement>} */
  const controls = new Map();
  for (const [action, text] of [
    ["back", "戻る"],
    ["skip", "スキップ"],
    ["open", "Googleカレンダーで開く"],
    ["pause", "中断"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", text);
    controls.set(action, button);
    if (action === "open") button.className = "primary";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      notify({ type: action, token, step });
    });
    guide.append(button);
  }
  shadow.append(style, outline, guide);
  let step = 0;
  let token = "";
  let running = false;
  let accepting = false;
  let frame = 0;
  /** @type {HTMLElement | null} */
  let target = null;

  /** @param {EventTarget | null} element */
  function candidate(element) {
    if (
      !(element instanceof HTMLElement) ||
      element === host ||
      element === document.body ||
      element === document.documentElement
    )
      return null;
    if (
      element.closest(
        'input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),script,style,iframe',
      )
    )
      return null;
    return element.innerText?.trim() ? element : null;
  }

  function draw() {
    frame = 0;
    if (!target || !target.isConnected) {
      outline.hidden = true;
      return;
    }
    const rect = target.getBoundingClientRect();
    outline.hidden = false;
    Object.assign(outline.style, {
      top: `${rect.top - 3}px`,
      left: `${rect.left - 3}px`,
      width: `${rect.width + 6}px`,
      height: `${rect.height + 6}px`,
    });
  }

  /** @param {MouseEvent} event */
  function move(event) {
    if (!accepting) return;
    target = candidate(event.target);
    if (!frame) frame = requestAnimationFrame(draw);
  }

  /** @param {HTMLElement} element */
  function pick(element) {
    const selected = window.getSelection();
    const text =
      selected?.anchorNode &&
      element.contains(selected.anchorNode) &&
      selected.toString().trim()
        ? selected.toString()
        : element.innerText;
    // Keep the guide mounted while awaiting the next step, without accepting twice.
    accepting = false;
    target = null;
    outline.hidden = true;
    notify({ type: "picked", step, token, text: text.trim().slice(0, 4000) });
  }

  /** @param {MouseEvent} event */
  function click(event) {
    if (!accepting || event.composedPath().includes(host)) return;
    const element = candidate(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pick(element);
  }

  /** @param {KeyboardEvent} event */
  function key(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      stop();
      notify({ type: "pause", token, step });
    } else if (
      accepting &&
      event.key === "Enter" &&
      !event.composedPath().includes(host)
    ) {
      const element = candidate(document.activeElement);
      if (element) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pick(element);
      }
    }
  }

  function stop() {
    running = false;
    accepting = false;
    cancelAnimationFrame(frame);
    frame = 0;
    target = null;
    host.remove();
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", draw, true);
    window.removeEventListener("resize", draw);
  }

  /** @param {number} nextStep @param {string} nextToken */
  function start(nextStep, nextToken) {
    if (
      !Number.isInteger(nextStep) ||
      nextStep < 0 ||
      nextStep > 3 ||
      typeof nextToken !== "string"
    ) {
      stop();
      return;
    }
    step = nextStep;
    token = nextToken;
    accepting = step < 3;
    outline.hidden = true;
    target = null;
    guide.classList.toggle("complete", !accepting);
    progress.textContent = accepting ? `${step + 1} / 3` : "✓";
    label.textContent = accepting
      ? `${FIELD_LABELS[step]}をクリック`
      : "取得完了・項目を押して選び直せます";
    stepButtons.forEach((button, index) => {
      button.classList.toggle("done", index < step);
      if (index === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    const back = controls.get("back");
    const skip = controls.get("skip");
    const pause = controls.get("pause");
    if (back) back.disabled = step === 0;
    if (skip) skip.hidden = !accepting;
    if (pause) {
      pause.textContent = accepting ? "中断" : "閉じる";
      pause.setAttribute("aria-label", pause.textContent);
    }
    if (running) return;
    running = true;
    document.documentElement.append(host);
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", draw, true);
    window.addEventListener("resize", draw);
  }

  return { start, stop, destroy: stop };
}
