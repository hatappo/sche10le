/** Pointer and viewport handling depends on input capabilities, not browser names.
 * The owner aborts `events.signal` when the content script is invalidated.
 * @param {{host: HTMLElement, sheet: HTMLElement, title: HTMLElement, outline: HTMLElement, events: {signal: AbortSignal}, selectionButton: HTMLButtonElement, onSelection: (value: string) => void, isPicking: () => boolean, accept: (value: string) => void}} options
 */
export function createSheetInteractions({ host, sheet, title, outline, events, selectionButton, onSelection, isPicking, accept }) {
  let lift = 0;
  /** @type {{x: number, y: number, scrollX: number, scrollY: number, moved: boolean, pointerType: string, cancelled: boolean} | null} */
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
  // Keep the browser's native handles/menu. Selection changes only offer a confirmation;
  // they never advance a field while the user is still adjusting the range.
  let pendingSelection = "";
  let confirmingSelection = "";
  const excluded = 'input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),iframe,script,style';
  function selectedText() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    if (!(start instanceof HTMLElement) || !(end instanceof HTMLElement) ||
      !document.body.contains(start) || !document.body.contains(end) ||
      start.closest(excluded) || end.closest(excluded)) return "";
    const common = range.commonAncestorContainer;
    if (common instanceof Element && [...common.querySelectorAll(excluded)].some(node => range.intersectsNode(node))) return "";
    return selection.toString().trim();
  }
  function updateSelection() {
    if (confirmingSelection) return;
    const value = isPicking() ? selectedText() : "";
    if (pendingSelection === value) return;
    pendingSelection = value;
    onSelection(value);
  }
  function clearSelection() {
    // Leave unrelated selections (e.g. in a form or settings) alone.
    if (selectedText()) getSelection()?.removeAllRanges();
    pendingSelection = confirmingSelection = "";
    contact = null;
    onSelection("");
  }
  document.addEventListener("selectionchange", updateSelection, events);
  selectionButton.addEventListener("pointerdown", () => {
    // Retain the value if native focus clears the range before click. Cancelling
    // pointerdown suppresses the synthesized touch click in WebKit.
    confirmingSelection = selectedText();
  }, events);
  document.addEventListener("pointerup", (event) => {
    if (confirmingSelection && !event.composedPath().includes(host)) {
      confirmingSelection = "";
      updateSelection();
    }
  }, events);
  selectionButton.addEventListener("pointercancel", () => {
    confirmingSelection = "";
    updateSelection();
  }, events);
  selectionButton.addEventListener("click", () => {
    const value = confirmingSelection || selectedText();
    clearSelection();
    if (isPicking() && value) accept(value);
  }, events);
  /** @param {Event} event */
  const picking = (event) => isPicking() && !event.composedPath().includes(host);
  document.addEventListener("pointerdown", (event) => {
    if (!picking(event)) return;
    contact = { x: event.clientX, y: event.clientY, scrollX, scrollY, moved: !event.isPrimary || event.button !== 0, pointerType: event.pointerType, cancelled: !event.isPrimary || event.button !== 0 };
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
  document.addEventListener("pointercancel", () => { if (contact) contact.cancelled = true; }, events);
  document.addEventListener("click", (event) => {
    if (!picking(event)) return;
    if (event.target instanceof Element && event.target.closest(excluded)) return;
    const value = selectedText();
    const element = pickable(event.target);
    if (!element && !value) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Mouse drags commit on release/click, including ranges crossing element boundaries.
    // Touch ranges require explicit confirmation; scrolling/cancelled gestures never pick.
    if (value) {
      if (contact?.pointerType === "mouse" && contact.moved && !contact.cancelled) {
        clearSelection();
        accept(value);
      } else updateSelection();
      return;
    }
    if (event.detail !== 0 && contact && (contact.moved || contact.cancelled || Math.abs(scrollY - contact.scrollY) > 8 || Math.abs(scrollX - contact.scrollX) > 8)) return;
    if (element) accept(element.innerText);
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
    setLift, viewport, clearSelection, stopDrag: endDrag,
    clamp: () => setLift(lift),
    resetContact() { contact = null; },
  };
}
