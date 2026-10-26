/** URLs known to be outside the extension's supported web pages.
 * An absent URL is not proof of a restricted page: activeTab may not be granted.
 * @param {string | undefined} url
 */
export function unsupportedPage(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.hostname === "chromewebstore.google.com" ||
      (parsed.hostname === "chrome.google.com" &&
        /^\/webstore(?:\/|$)/.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

/** Keep permission denial separate from transient injection/connection failures.
 * @param {unknown} error
 * @returns {"blocked" | "unsupported" | "error"}
 */
export function accessFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /extensions gallery cannot be scripted|cannot access a (?:chrome|edge|about|devtools|chrome-extension):\/\/|cannot access (?:a )?chrome web store/i.test(
      message,
    )
  )
    return "unsupported";
  if (
    /cannot access contents of (?:the )?url|manifest must request permission|missing host permission/i.test(
      message,
    )
  )
    return "blocked";
  return "error";
}
