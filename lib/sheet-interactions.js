/** Pointer and viewport handling depends on input capabilities, not browser names.
 * The owner aborts `events.signal` when the content script is invalidated.
 * @param {{host: HTMLElement, sheet: HTMLElement, title: HTMLElement, outline: HTMLElement, events: {signal: AbortSignal}, isPicking: () => boolean, accept: (value: string) => void}} options
 */
export function createSheetInteractions({ host, sheet, title, outline, events, isPicking, accept }) {
  let lift = 0;
  /** @type {{x: number, y: number, scrollX: number, scrollY: number, moved: boolean} | null} */
  let contact = null;
  /** @param {number} value */
  function setLift(value) {
    const height = window.visualViewport?.height ?? innerHeight;
    lift = Math.max(0, Math.min(value, height - sheet.offsetHeight - 32));
    host.style.setProperty("--sheet-lift", `${lift}px`);
  }
  function viewport() {
    const view = window.visualViewport;
    host.style.setProperty("--view-height", `${view?.height ?? innerHeight}px`);
    host.style.setProperty("--view-width", `${view?.width ?? innerWidth}px`);
    host.style.setProperty("--view-left", `${view?.offsetLeft ?? 0}px`);
    host.style.setProperty("--view-bottom", `${Math.max(0, innerHeight - (view?.height ?? innerHeight) - (view?.offsetTop ?? 0))}px`);
    outline.hidden = true;
    setLift(lift);
  }
  /** @param {EventTarget | null} target */
  function pickable(target) {
    if (!(target instanceof HTMLElement) || target === document.body || target === document.documentElement ||
      target.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),iframe,script,style')) return null;
    return target.innerText?.trim() ? target : null;
  }
  /** @param {Event} event */
  const picking = (event) => isPicking() && !event.composedPath().includes(host);
  document.addEventListener("pointerdown", (event) => {
    if (!picking(event)) return;
    contact = { x: event.clientX, y: event.clientY, scrollX, scrollY, moved: !event.isPrimary || event.button !== 0 };
  }, { ...events, capture: true });
  document.addEventListener("pointermove", (event) => {
    if (!picking(event)) return;
    if (contact && Math.hypot(event.clientX - contact.x, event.clientY - contact.y) > 8) contact.moved = true;
    if (event.pointerType !== "mouse") return;
    const element = pickable(event.target);
    outline.hidden = !element;
    if (element) {
      const rect = element.getBoundingClientRect();
      Object.assign(outline.style, { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
  }, { ...events, capture: true, passive: true });
  document.addEventListener("pointercancel", () => { if (contact) contact.moved = true; }, events);
  document.addEventListener("click", (event) => {
    if (!picking(event)) return;
    const element = pickable(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail !== 0 && contact && (contact.moved || Math.abs(scrollY - contact.scrollY) > 8 || Math.abs(scrollX - contact.scrollX) > 8)) return;
    const selection = getSelection();
    const value = selection?.anchorNode && element.contains(selection.anchorNode) && selection.toString().trim()
      ? selection.toString() : element.innerText;
    accept(value);
    contact = null;
  }, { ...events, capture: true });
  window.visualViewport?.addEventListener("resize", viewport, events);
  window.visualViewport?.addEventListener("scroll", viewport, events);
  window.addEventListener("resize", viewport, events);
  window.addEventListener("scroll", () => { outline.hidden = true; }, { ...events, passive: true });
  // The heading is a vertical handle; scrolling in the content remains a native gesture.
  title.tabIndex = 0;
  title.setAttribute("role", "button");
  title.setAttribute("aria-label", "表示位置を移動");
  title.title = "ドラッグで上下に移動。矢印キーでも移動できます（Endで元の位置）";
  /** @type {{id: number, y: number, lift: number} | null} */
  let drag = null;
  title.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, y: event.clientY, lift };
    title.setPointerCapture(event.pointerId);
    sheet.classList.add("dragging");
    event.preventDefault();
  }, events);
  title.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) setLift(drag.lift + drag.y - event.clientY);
  }, events);
  const endDrag = () => { drag = null; sheet.classList.remove("dragging"); };
  title.addEventListener("pointerup", endDrag, events);
  title.addEventListener("lostpointercapture", endDrag, events);
  title.addEventListener("pointercancel", endDrag, events);
  title.addEventListener("keydown", (event) => {
    const amount = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowUp") setLift(lift + amount);
    else if (event.key === "ArrowDown") setLift(lift - amount);
    else if (event.key === "Home") setLift(innerHeight);
    else if (event.key === "End") setLift(0);
    else return;
    event.preventDefault();
  }, events);
  sheet.addEventListener("transitionend", () => setLift(lift), events);
  return {
    setLift, viewport, stopDrag: endDrag,
    clamp: () => setLift(lift),
    resetContact() { contact = null; },
  };
}
