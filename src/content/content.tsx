import React from "react";
import ReactDOM from "react-dom/client";
import ContentApp from "./ContentApp";
import { applyQuickFilterAppearance } from "./quickFilterAppearance";
import { whenPageReady } from "./whenPageReady";
import { isBoardContentRendered } from "./boardContent";
import { revealPanel } from "./revealPanel";
import "./content.css";

(async () => {
    // Neutralize Jira's active-state highlight on the Quick filters control (CSS only).
    applyQuickFilterAppearance();

    let root: ReactDOM.Root | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unmountIfOrphaned = () => {
        // If our previous root's DOM node was destroyed by Jira's SPA,
        // unmount it so its useEffect cleanups (listeners) run.
        if (root && !document.getElementById("jira-standup")) {
            try { root.unmount(); } catch (_) { /* noop */ }
            root = null;
        }
    };

    const inject = (controls: Element) => {
        if (document.getElementById("jira-standup")) {
            return;
        }
        unmountIfOrphaned();
        const rootElement = document.createElement("div");
        rootElement.id = "jira-standup";
        // Start hidden; revealPanel fades it in once the board content has rendered,
        // so a half-rendered board never flashes the panel.
        rootElement.classList.add("loading");
        controls.insertAdjacentElement("afterend", rootElement);
        root = ReactDOM.createRoot(rootElement);
        root.render(
            <React.StrictMode>
                <ContentApp />
            </React.StrictMode>
        );
        revealPanel(rootElement, { isReady: () => isBoardContentRendered() });
    };

    const scheduleInject = () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        // Small debounce only to coalesce bursts of SPA mutations; the page-load
        // gate (whenPageReady) is what actually prevents injecting into a stale paint.
        debounceTimer = setTimeout(() => {
            unmountIfOrphaned();
            const controlsSelector = `[data-testid="software-board.header.controls-bar"]`;
            if (!document.getElementById("jira-standup")) {
                const controls = document.querySelector(controlsSelector);
                if (controls) {
                    inject(controls);
                }
            }
        }, 100);
    };

    try {
        // Gate the first injection on the real page load instead of a fixed timer.
        await whenPageReady();

        const observer = new MutationObserver(() => {
            scheduleInject();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // The board may already be rendered by the time load fires.
        scheduleInject();

        // Pages restored from the back/forward cache do not re-run the content
        // script and skip `load`; re-validate so a stale/missing panel is fixed.
        window.addEventListener("pageshow", (e) => {
            if ((e as PageTransitionEvent).persisted) {
                unmountIfOrphaned();
                scheduleInject();
            }
        });
    } catch (e) {
        console.error(`Smartie Standup Chrome Extension: Unable to load: ${e}`)
    }
})();
