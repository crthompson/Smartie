// Resolves once the page has fully loaded.
//
// The content script runs at document_idle, but on a hard reload Jira Cloud may
// briefly paint a cached snapshot of the PREVIOUS board (disk cache / bfcache)
// before its SPA hydrates the new one. Gating the first injection on the real
// `load` event (readyState === "complete") skips that pre-hydration paint, which
// is the main source of the "old page flashes, then the panel appears" effect.
// Decoupling from a fixed timer means it adapts to fast and slow machines alike.
export function whenPageReady(
    doc: Document = document,
    win: Window = window
): Promise<void> {
    return new Promise<void>((resolve) => {
        if (doc.readyState === "complete") {
            resolve();
            return;
        }
        win.addEventListener("load", () => resolve(), { once: true });
    });
}
