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
const QUICK_FILTER_LABELS = ['Quick filters', 'Custom filters'];
const HIDDEN_ATTR = 'data-smartie-qf-hidden';

const addPopupHideStyle = (): void => {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    // The react-select popup is portaled into an element whose id ends in "-popup-select"
    // (the prefix is a dynamic, per-render token). Hide the whole popup (search + list).
    // The redesigned "Custom filters" popup has no stable id, so markPopups() also tags
    // whatever popup opens with HIDDEN_ATTR, which this rule hides.
    style.textContent =
        `[id$="-popup-select"],[${HIDDEN_ATTR}]{visibility:hidden !important;}`;
    document.head.appendChild(style);
};

const removePopupHideStyle = (): void => {
    document.getElementById(HIDE_STYLE_ID)?.remove();
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(e => e.removeAttribute(HIDDEN_ATTR));
};

const POPUP_SELECTOR = '[role="option"],[role="listbox"],[role="menu"],[role="dialog"]';

// Tags the popup the button opened so the hide style covers it. Walks up from each new
// popup-ish element to its highest ancestor that does not contain the trigger button:
// the portal root when the popup is portaled, or the popup's own wrapper when inline.
// MutationObserver callbacks run before the next paint, so the popup never shows.
const markPopups = (button: HTMLElement, preexisting: Set<Element>): void => {
    const controlsId = button.getAttribute('aria-controls');
    const controlled = controlsId ? document.getElementById(controlsId) : null;
    controlled?.setAttribute(HIDDEN_ATTR, '');
    document.querySelectorAll(POPUP_SELECTOR).forEach(el => {
        if (preexisting.has(el)) return;
        let top: Element = el;
        while (
            top.parentElement &&
            top.parentElement !== document.body &&
            !top.parentElement.contains(button)
        ) {
            top = top.parentElement;
        }
        if (!top.contains(button)) top.setAttribute(HIDDEN_ATTR, '');
    });
};

export interface QuickFilterOptions {
    // true = ensure checked, false = ensure unchecked, undefined = toggle.
    select?: boolean;
    // When selecting, uncheck any other checked option whose name is in this list.
    exclusiveAmong?: string[];
}

// The redesigned "Custom filters" list is multi-select. Read each option's checked state
// so we set it explicitly instead of toggling, which drifts once a click is missed.
const checkedState = (option: Element): boolean | null => {
    for (const attr of ['aria-selected', 'aria-checked']) {
        const v = option.getAttribute(attr);
        if (v === 'true' || v === 'false') return v === 'true';
    }
    const box = option.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (box) return box.checked;
    const aria = option.querySelector('[aria-checked]');
    if (aria) return aria.getAttribute('aria-checked') === 'true';
    return null;
};

const optionName = (o: Element): string => o.textContent?.trim().toLowerCase() ?? '';

export const clickQuickFilter = (name: string, opts: QuickFilterOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
        // Match the Quick filters control by prefix, not exact text: once a quick filter
        // is active Jira appends a count badge so the label becomes e.g. "Quick filters1".
        // Exact-equality matching would fail on the 2nd interaction and never clear the
        // previously selected filter (falling back to the assignee filter instead).
        // Jira's Nov 2026 board redesign renamed the control to "Custom filters".
        const button = Array.from(document.querySelectorAll('button')).find(b => {
            const label = b.textContent?.trim() ?? '';
            return QUICK_FILTER_LABELS.some(prefix => label.startsWith(prefix));
        }) as HTMLButtonElement | undefined;
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
        // Only consider options from the popup this button opened. Other menus left on the
        // page (e.g. after a right-click) also expose role="option"; matching against them
        // made a real attendee look like a non-match, so the filter fell back to the
        // assignee avatars and stale Custom filters were never unchecked.
        const preexisting = new Set(Array.from(document.querySelectorAll(POPUP_SELECTOR)));
        const ownOptions = (): Element[] => {
            const controlsId = button.getAttribute('aria-controls');
            const popup = controlsId ? document.getElementById(controlsId) : null;
            const all = Array.from((popup ?? document).querySelectorAll('[role="option"]'));
            return popup ? all : all.filter(o => !preexisting.has(o));
        };

        const tryMatch = (): boolean => {
            const options = ownOptions();
            if (options.length === 0) return false;
            const match = options.find(o => optionName(o) === target) as HTMLElement | undefined;
            if (match) {
                applySelection(options);
                finish(true);
                return true;
            }
            // Options rendered but no match → not a quick-filter user
            finish(false);
            return true;
        };

        const applySelection = (options: Element[]): void => {
            // Without readable checked state, fall back to the original toggle behavior.
            const known = options.some(o => checkedState(o) !== null);
            if (opts.select === undefined || !known) {
                (options.find(o => optionName(o) === target) as HTMLElement).click();
                return;
            }
            const exclusive = new Set((opts.exclusiveAmong ?? []).map(n => n.toLowerCase()));
            const wanted = (o: Element): boolean | undefined => {
                const n = optionName(o);
                if (n === target) return opts.select;
                if (opts.select && exclusive.has(n)) return false;
                return undefined;
            };
            const toClick = options.filter(o => {
                const want = wanted(o);
                return want !== undefined && checkedState(o) !== want;
            }).map(optionName);
            // Re-find each option before clicking: a click can re-render the list.
            toClick.forEach(n => {
                const el = ownOptions().find(o => optionName(o) === n) as HTMLElement | undefined;
                el?.click();
            });
        };

        // If the dropdown is already open its options predate this call; accept them.
        if (button.getAttribute('aria-expanded') === 'true') {
            preexisting.clear();
            if (tryMatch()) return;
        }

        // Open the dropdown. React may render the popup synchronously inside click(),
        // so tag it right away as well as from the observer.
        button.click();
        markPopups(button, preexisting);
        observer = new MutationObserver(() => {
            markPopups(button, preexisting);
            tryMatch();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        timer = setTimeout(() => finish(false), 3000);
    });
};
