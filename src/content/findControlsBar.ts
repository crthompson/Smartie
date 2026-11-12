// Locates the board's filter/controls bar that the Smartie panel is injected after.
//
// Jira Cloud used to expose it as `software-board.header.controls-bar`. The
// Nov 2026 board redesign dropped that testid: the bar (search, assignee avatars,
// Filter, Custom filters, Group) has no testid of its own. We find it by walking
// up from a stable child (the board search field or the assignee fieldset) to the
// nearest ancestor that also holds the bar's "Group" / filters buttons.
export const LEGACY_CONTROLS_SELECTOR = '[data-testid="software-board.header.controls-bar"]';

const CHILD_ANCHORS = [
    '[data-testid="filter-refinement.ui.search-field-container"]',
    '[data-testid="filters.ui.filters.assignee.stateless.assignee-filter"]',
];

const BAR_BUTTON_LABELS = /^(group|custom filters|quick filters)/i;
const MAX_DEPTH = 10;

const holdsBarButtons = (el: Element): boolean =>
    Array.from(el.querySelectorAll('button')).some(b =>
        BAR_BUTTON_LABELS.test((b.textContent || '').trim())
    );

export function findControlsBar(doc: Document = document): Element | null {
    const legacy = doc.querySelector(LEGACY_CONTROLS_SELECTOR);
    if (legacy) return legacy;

    for (const sel of CHILD_ANCHORS) {
        const anchor = doc.querySelector(sel);
        let el = anchor?.parentElement ?? null;
        for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
            if (el === doc.body) break;
            if (holdsBarButtons(el)) return el;
        }
    }
    return null;
}

const BOARD_SELECTORS = [
    '[data-testid="board.content.board-wrapper"]',
    '[data-testid="platform-board-kit.ui.board.scroll.board-scroll"]',
    '[data-testid="software-board.board"]',
];

export interface PanelPlacement {
    target: Element;
    position: 'afterend' | 'afterbegin';
}

// Decides where the panel goes. The redesigned board wraps the header and board in a
// CSS grid with named areas ("header sidebar" / "content sidebar"). A sibling added to
// that grid has no area, so it is auto-placed into the empty sidebar column (far right);
// inside the header it is clipped to the 60px header row. So place the panel as the
// first child of the content-area element, directly above the board.
export function findPanelPlacement(doc: Document = document): PanelPlacement | null {
    const legacy = doc.querySelector(LEGACY_CONTROLS_SELECTOR);
    if (legacy) return { target: legacy, position: 'afterend' };

    const bar = findControlsBar(doc);
    if (!bar) return null;

    const board = BOARD_SELECTORS.map(sel => doc.querySelector(sel)).find(Boolean);
    if (board) {
        let el: Element = bar;
        while (el.parentElement && el.parentElement !== doc.body) {
            const shared = el.parentElement;
            if (shared.contains(board)) {
                const contentSide = Array.from(shared.children).find(c => c.contains(board));
                if (contentSide) return { target: contentSide, position: 'afterbegin' };
                break;
            }
            el = shared;
        }
    }
    return { target: bar, position: 'afterend' };
}

export function isPlaced(host: Element, p: PanelPlacement): boolean {
    return p.position === 'afterend'
        ? host.previousElementSibling === p.target
        : p.target.firstElementChild === host;
}

const COLUMN_SELECTORS = ['[data-testid="board.content.cell"]', ...BOARD_SELECTORS];

// Left inset (px) that lines the panel up with the board's first column, which Jira
// insets from the content-area edge. Returns null when it can't be measured sensibly
// (no board, or the board is scrolled horizontally).
export function boardInset(host: Element, doc: Document = document): number | null {
    const column = COLUMN_SELECTORS.map(sel => doc.querySelector(sel)).find(Boolean);
    if (!column) return null;
    const inset = Math.round(column.getBoundingClientRect().left - host.getBoundingClientRect().left);
    return inset >= 0 && inset <= 200 ? inset : null;
}
