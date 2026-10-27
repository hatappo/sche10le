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
    .guide{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:640px;max-width:calc(100vw - 32px);pointer-events:auto;padding:12px 16px;background:#f9f8f2;color:#243e32;border:1px solid #dfe4d6;border-radius:14px;box-shadow:0 8px 40px #14291c2e;font:13px/1.5 'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;animation:picker-enter 650ms cubic-bezier(.22,.61,.36,1)}
    .instruction-row{display:flex;align-items:center;gap:12px;margin-bottom:10px;min-height:42px}.instruction{flex:1;min-width:0}strong{display:block;font-size:15px;line-height:1.5}.hint{display:block;font-size:11px;color:#647267;line-height:1.5}.toolbar{display:flex;justify-content:space-between;gap:12px}.step-list,.controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;width:320px}
    button{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:7px;padding:8px 10px;background:#e8ece2;color:#254c3b;white-space:nowrap}button:focus-visible{outline:3px solid #ad7731;outline-offset:2px}button:hover:not(:disabled){filter:brightness(.94)}button:disabled{color:#92988d;background:#efeee8;cursor:default}[hidden]{display:none!important}
    .controls{grid-template-columns:repeat(2,minmax(0,1fr));width:160px}.close-button{display:inline-flex;align-items:center;justify-content:center;flex:0 0 32px;width:32px;height:32px;padding:0;background:transparent;color:#647267}.close-button:hover{background:#e8ece2;color:#254c3b}.close-button svg{width:16px;height:16px}
    .step-list button{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;padding-inline:6px;background:transparent;border-color:#dfe4d6;font-weight:400}.step-number{font-size:10px}.step-check{display:none;flex:0 0 10px;width:10px;font-size:10px;color:inherit}.step-list button.done{background:#f1f5ed;color:#788171}.step-list button.done:hover,.step-list button.done:focus-visible{color:#2c6045}.step-list button.done .step-check{display:inline}.step-list button[aria-current="step"]{background:#ffffff8c;border-color:#2c6045;color:#2c6045;font-weight:600}
    @keyframes picker-enter{from{transform:translate(-50%,12px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
    @media(max-width:560px){.toolbar{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}.step-list,.controls{width:100%}}
    @media(max-width:340px){.guide{padding-inline:12px}strong{font-size:13px}.hint{font-size:10px}button{font-size:12px;padding-inline:6px}.step-list button{padding-inline:3px}}
    @media(max-width:300px){.step-list button{font-size:11px;gap:2px;padding-inline:2px}.step-number{font-size:9px}.step-check{flex-basis:8px;width:8px;font-size:9px}}
    @media(prefers-reduced-motion:reduce){.outline{transition:none}.guide{animation:none}}

  `;
  const outline = document.createElement("div");
  outline.className = "outline";
  outline.hidden = true;
  const guide = document.createElement("div");
  guide.className = "guide";
  guide.setAttribute("role", "region");
  guide.setAttribute("aria-label", "Sche10le ページから取得");
  const label = document.createElement("strong");
  const hint = document.createElement("span");
  hint.className = "hint";
  const instruction = document.createElement("div");
  instruction.className = "instruction";
  instruction.setAttribute("role", "status");
  instruction.setAttribute("aria-atomic", "true");
  instruction.append(label, hint);
  const instructionRow = document.createElement("div");
  instructionRow.className = "instruction-row";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close-button";
  close.title = "選択モードを閉じる（Esc）";
  close.setAttribute("aria-label", "選択モードを閉じる");
  close.setAttribute("aria-keyshortcuts", "Escape");
  const closeIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  closeIcon.setAttribute("viewBox", "0 0 24 24");
  closeIcon.setAttribute("fill", "none");
  closeIcon.setAttribute("stroke", "currentColor");
  closeIcon.setAttribute("stroke-width", "1.8");
  closeIcon.setAttribute("stroke-linecap", "round");
  closeIcon.setAttribute("aria-hidden", "true");
  const closePath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  closePath.setAttribute("d", "m6 6 12 12M18 6 6 18");
  closeIcon.append(closePath);
  close.append(closeIcon);
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    notify({ type: "pause", token, step });
  });
  instructionRow.append(instruction, close);
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const actions = document.createElement("div");
  actions.className = "controls";
  const stepList = document.createElement("div");
  stepList.className = "step-list";
  const stepButtons = FIELD_LABELS.map((name, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const number = document.createElement("span");
    number.className = "step-number";
    number.textContent = String(index + 1);
    number.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "step-label";
    text.textContent = name;
    const check = document.createElement("span");
    check.className = "step-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    button.append(number, text, check);
    button.setAttribute("aria-label", `${name}を選び直す`);
    button.addEventListener("click", () =>
      notify({ type: "choose-field", fieldIndex: index, token, step }),
    );
    stepList.append(button);
    return button;
  });
  toolbar.append(stepList, actions);
  guide.append(instructionRow, toolbar);
  /** @type {Map<string, HTMLButtonElement>} */
  const controls = new Map();
  for (const [action, text] of [
    ["back", "戻る"],
    ["skip", "スキップ"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", text);
    controls.set(action, button);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      notify({ type: action, token, step });
    });
    actions.append(button);
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
      nextStep >= FIELD_LABELS.length ||
      typeof nextToken !== "string"
    ) {
      stop();
      return;
    }
    step = nextStep;
    token = nextToken;
    accepting = true;
    outline.hidden = true;
    target = null;
    label.textContent = "ページ上の文字をクリック";
    hint.textContent = `${FIELD_LABELS[step]}として取り込みます`;
    stepButtons.forEach((button, index) => {
      button.classList.toggle("done", index < step);
      button.setAttribute("aria-description", index < step ? "設定済み" : "");
      if (index === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    const back = controls.get("back");
    const skip = controls.get("skip");
    if (back) back.disabled = step === 0;
    if (skip) skip.disabled = false;
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
