// Fades the panel in once the board is ready, instead of letting it pop in.
//
// The host is injected with the `loading` class (opacity:0). We then wait, frame
// by frame, for `isReady()` to report that the board content has rendered, and
// remove `loading` to trigger the CSS opacity transition. A bounded `maxFrames`
// fallback guarantees the panel ALWAYS reveals even if the readiness signal never
// fires (e.g. Jira renamed a board testid), so this can never strand the panel.
//
// All timing dependencies are injectable so this is deterministic under jsdom.
export interface RevealOptions {
    isReady?: () => boolean;
    raf?: (cb: () => void) => void;
    maxFrames?: number;
}

export function revealPanel(host: HTMLElement, opts: RevealOptions = {}): void {
    const isReady = opts.isReady ?? (() => true);
    const raf =
        opts.raf ??
        ((cb: () => void) =>
            typeof requestAnimationFrame === "function"
                ? requestAnimationFrame(cb)
                : setTimeout(cb, 16));
    const maxFrames = opts.maxFrames ?? 30;

    let frames = 0;
    const tick = () => {
        frames++;
        if (isReady() || frames >= maxFrames) {
            host.classList.remove("loading");
            return;
        }
        raf(tick);
    };
    raf(tick);
}
