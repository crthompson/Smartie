import { Attendee } from "../types";

/**
 * Returns a copy of the attendee list with standup highlights cleared:
 * everyone is marked as not sat-down and with no lingering flag.
 *
 * Used by the "Clear on refresh" option so highlights don't survive a page reload.
 */
export const resetStandupHighlights = (attendees: Attendee[]): Attendee[] =>
    attendees.map(a => ({
        ...a,
        satDown: false,
        hasLinger: false
    }));
