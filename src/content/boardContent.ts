// Detects whether Jira's actual board CONTENT (columns/cards) has rendered, as
// opposed to just the header controls bar.
//
// The controls bar can be present in a stale cached paint and renders before the
// cards, so anchoring the panel's reveal to real board content avoids fading in
// over a half-rendered board. These data-testids are the stable hooks Jira Cloud
// exposes for the board surface; prefer them over hashed emotion (css-*) classes.
//
// IMPORTANT: this is used only to GATE THE REVEAL (fade-in), never the injection
// itself. The reveal has a bounded animation-frame fallback, so if Jira renames
// these testids the panel still appears - it just reveals on the fallback instead
// of waiting for content. Verify/refresh this list against a live board when
// Jira ships a board redesign.
export const BOARD_CONTENT_SELECTORS = [
    '[data-testid="platform-board-kit.ui.board.scroll.board-scroll"]',
    '[data-testid="software-board.board"]',
    '[data-testid^="platform-board-kit.ui.column"]',
    '[data-testid="platform-board-kit.ui.card.card"]',
];

export function isBoardContentRendered(doc: Document = document): boolean {
    return BOARD_CONTENT_SELECTORS.some((sel) => doc.querySelector(sel) !== null);
}
