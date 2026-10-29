/** @param {string} text @param {() => void} action @param {string} [className] */
export function button(text, action, className = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = text;
  node.addEventListener("click", action);
  return node;
}
/** @param {string} label @param {string} path @param {() => void} action */
export function iconButton(label, path, action) {
  const node = button("", action, "icon-button");
  node.title = label;
  node.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(svg.namespaceURI, "path");
  shape.setAttribute("d", path);
  svg.append(shape); node.append(svg);
  return node;
}
/** @param {string[][]} options @param {string} value */
export function select(options, value) {
  const node = document.createElement("select");
  for (const [id, label] of options) {
    const option = document.createElement("option");
    option.value = id; option.textContent = label; node.append(option);
  }
  node.value = value;
  return node;
}
