function publicUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol)
      ? `${url.origin}${url.pathname}`
      : null;
  } catch {
    return null;
  }
}

export function navigationErrorCode(error) {
  if (error?.name === "TimeoutError") return "TIMEOUT";
  return (error?.message ?? "").match(/\bnet::ERR_[A-Z0-9_]+\b/)?.[0] ?? "UNKNOWN";
}

// Observe only the top-level document. Never read response bodies or persist
// arbitrary error messages, headers, URL credentials, queries, or fragments.
export function observeNavigation(page, { startedAt, onEvent }) {
  const events = [];
  let truncated = false;
  let active = true;
  const record = (event) => {
    if (!active || truncated) return;
    if (events.length === 32) {
      truncated = true;
      onEvent({ type: "truncated" }, { events: [...events], truncated });
      return;
    }
    const entry = { ...event, elapsedMs: Date.now() - startedAt };
    events.push(entry);
    onEvent(entry, { events: [...events], truncated });
  };
  const isMain = (request) => {
    try {
      return request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      // Some requests have no associated frame yet. Diagnostics must not throw.
      return false;
    }
  };
  const listeners = {
    request: (request) => {
      if (isMain(request))
        record({ type: "request", url: publicUrl(request.url()) });
    },
    response: (response) => {
      if (!isMain(response.request())) return;
      const status = response.status();
      const event = { type: "response", url: publicUrl(response.url()), status };
      if (status >= 300 && status < 400 && response.headers().location)
        event.redirectTo = publicUrl(response.headers().location, response.url());
      record(event);
    },
    requestfailed: (request) => {
      if (isMain(request))
        record({
          type: "requestfailed",
          url: publicUrl(request.url()),
          errorCode: navigationErrorCode({ message: request.failure()?.errorText }),
        });
    },
    domcontentloaded: () => record({ type: "domcontentloaded" }),
    load: () => record({ type: "load" }),
  };
  for (const [name, listener] of Object.entries(listeners)) page.on(name, listener);
  return () => {
    active = false;
    for (const [name, listener] of Object.entries(listeners)) page.off(name, listener);
  };
}
