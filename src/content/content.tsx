import React from "react";
import ReactDOM from "react-dom/client";
import ContentApp from "./ContentApp";
import "./content.css";

(async () => {
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
        controls.insertAdjacentElement("afterend", rootElement);
        root = ReactDOM.createRoot(rootElement);
        root.render(
            <React.StrictMode>
                <ContentApp />
            </React.StrictMode>
        );
    };

    const scheduleInject = () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            unmountIfOrphaned();
            const controlsSelector = `[data-testid="software-board.header.controls-bar"]`;
            if (!document.getElementById("jira-standup")) {
                const controls = document.querySelector(controlsSelector);
                if (controls) {
                    inject(controls);
                }
            }
        }, 500);
    };

    try {
        const observer = new MutationObserver(() => {
            scheduleInject();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Initial check in case the board is already rendered
        scheduleInject();
    } catch (e) {
        console.error(`Smartie Standup Chrome Extension: Unable to load: ${e}`)
    }
})();
