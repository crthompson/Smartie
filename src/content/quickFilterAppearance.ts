/**
 * Neutralizes the visual "highlight" Jira applies to the Quick filters control when a
 * quick filter is active, so an applied attendee filter doesn't make the control look
 * selected (blue background, blue text, blue border) or show a count badge.
 *
 * This is a non-destructive, CSS-only override (no DOM mutation). It is keyed off stable
 * data-testid hooks rather than Jira's hashed emotion class names:
 *   - `filters.common.ui.list.quick-filters-filter`        identifies the trigger button
 *   - `filters.common.ui.list.quick-filters-filter-badge`  is the count badge ("1")
 *
 * The selected border is drawn via the button's `::after` pseudo-element, so its
 * border-color is forced transparent. The focus ring (a blue `outline` the button gets
 * because we operate it programmatically) is suppressed so it doesn't linger or flicker.
 * The badge is hidden with `display:none`; this does not affect clickQuickFilter's button
 * lookup because `textContent` still includes the (hidden) count.
 */
const APPEARANCE_STYLE_ID = 'smartie-qf-appearance';

export const applyQuickFilterAppearance = (): void => {
    if (document.getElementById(APPEARANCE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = APPEARANCE_STYLE_ID;
    style.textContent =
        '[data-testid="software-filters.ui.list-filter-container"] ' +
        'button:has([data-testid="filters.common.ui.list.quick-filters-filter"]){' +
        'background-color:transparent !important;color:#292a2e !important;outline:none !important;}' +
        '[data-testid="software-filters.ui.list-filter-container"] ' +
        'button:has([data-testid="filters.common.ui.list.quick-filters-filter"])::after{' +
        'border-color:transparent !important;}' +
        '[data-testid="filters.common.ui.list.quick-filters-filter-badge"]{display:none !important;}';
    document.head.appendChild(style);
};
