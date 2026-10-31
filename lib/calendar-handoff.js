/** Only our generated Google Calendar handoff may open a new tab.
 * @param {unknown} value
 */
export function isCalendarHandoff(value) {
  if (typeof value !== "string" || value.length > 120_000) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://calendar.google.com" &&
      !url.username && !url.password &&
      ["/calendar/render", "/calendar/r/eventedit"].includes(url.pathname) &&
      url.searchParams.get("action") === "TEMPLATE";
  } catch { return false; }
}
