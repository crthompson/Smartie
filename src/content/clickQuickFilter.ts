/**
 * Attempts to apply a Jira "Quick filters" option matching the given name.
 *
 * Behavior:
 *  - Finds the "Quick filters" button. If absent, resolves false (caller falls back).
 *  - Opens the dropdown and looks for a `[role="option"]` whose text matches `name`
 *    (case-insensitive, trimmed).
 *  - If matched, clicks it and resolves true.
 *  - If options render but none match, resolves false and closes the dropdown.
 *  - If nothing renders within 3s, resolves false.
 *
 * The dropdown is opened/closed programmatically only as a means to select the option;
 * to avoid a visible flash of the menu, the portaled popup is hidden via injected CSS
 * for the duration of the operation. `visibility: hidden` keeps the elements clickable
 * by script while hiding them from view.
 */
const HIDE_STYLE_ID = 'smartie-qf-hide';

const addPopupHideStyle = (): void => {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    // The react-select popup is portaled into an element whose id ends in "-popup-select"
    // (the prefix is a dynamic, per-render token). Hide the whole popup (search + list).
    style.textContent = '[id$="-popup-select"]{visibility:hidden !important;}';
    document.head.appendChild(style);
};

const removePopupHideStyle = (): void => {
    document.getElementById(HIDE_STYLE_ID)?.remove();
};

export const clickQuickFilter = (name: string): Promise<boolean> => {
    return new Promise((resolve) => {
        // Match the Quick filters control by prefix, not exact text: once a quick filter
        // is active Jira appends a count badge so the label becomes e.g. "Quick filters1".
        // Exact-equality matching would fail on the 2nd interaction and never clear the
        // previously selected filter (falling back to the assignee filter instead).
        const button = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent?.trim().startsWith('Quick filters')
        ) as HTMLButtonElement | undefined;
        if (!button) {
            resolve(false);
            return;
        }
        // Hide the popup before we open it so the menu never visibly flashes.
        addPopupHideStyle();
        const target = name.toLowerCase();
        let settled = false;
        let observer: MutationObserver | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (result: boolean) => {
            if (settled) return;
            settled = true;
            if (observer) observer.disconnect();
            if (timer) clearTimeout(timer);
            // A programmatic option .click() does NOT reliably trigger react-select's own
            // close, so the menu can stay open after we apply/clear a filter. Close it
            // ourselves. On success defer briefly so the selection commits before we
            // toggle the control closed; on a no-match close immediately. Keep the popup
            // hidden until it has actually closed, then remove the hide style.
            const closeAndCleanup = () => {
                if (button.getAttribute('aria-expanded') === 'true') {
                    button.click();
                }
                // We operate this control programmatically, which leaves it keyboard-focused
                // and showing a blue focus ring. Drop focus so no highlight lingers.
                button.blur();
                // Remove the hide style after the popup has been torn down.
                setTimeout(removePopupHideStyle, 50);
            };
            if (result) {
                setTimeout(closeAndCleanup, 60);
            } else {
                closeAndCleanup();
            }
            resolve(result);
        };

        // Helper to try matching the currently-open options.
        const tryMatch = (): boolean => {
            const options = Array.from(document.querySelectorAll('[role="option"]'));
            if (options.length === 0) return false;
            const match = options.find(
                o => o.textContent?.trim().toLowerCase() === target
            ) as HTMLElement | undefined;
            if (match) {
                match.click();
                finish(true);
                return true;
            }
            // Options rendered but no match → not a quick-filter user
            finish(false);
            return true;
        };

        // If dropdown is already open (from a prior in-flight call's render), try immediately
        if (button.getAttribute('aria-expanded') === 'true' && tryMatch()) {
            return;
        }

        // Open the dropdown
        button.click();
        observer = new MutationObserver(() => {
            tryMatch();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        timer = setTimeout(() => finish(false), 3000);
    });
};
