import { SmartieConfiguration } from "../config/attendeeConfig";
import { Candidate, uniqueCandidates } from "../jira/discoveryProtocol";
export type SelectedCandidate = Candidate & { smartieName?: string };

export function mergeDiscovered(configuration: SmartieConfiguration, selected: SelectedCandidate[], teamText: string): { configuration: SmartieConfiguration; changed: boolean; added: number; updated: number } {
    const attendees = [...configuration.attendees];
    const team = teamText.trim();
    let added = 0, updated = 0;
    for (const candidate of uniqueCandidates(selected) as SelectedCandidate[]) {
        const index = attendees.findIndex(attendee => attendee.id === candidate.accountId);
        if (index >= 0) {
            const existing = attendees[index];
            const teams = typeof existing.team === "string" ? (existing.team ? [existing.team] : []) : existing.team || [];
            if (team && !teams.includes(team)) { attendees[index] = { ...existing, team: [...teams, team] }; updated++; }
        } else {
            const name = (candidate.smartieName ?? candidate.displayName).trim();
            if (!name) continue;
            attendees.push({ id: candidate.accountId, name, avatarUrl: candidate.avatarUrl, excludeFromShuffle: false, team }); added++;
        }
    }
    return { configuration: { ...configuration, attendees }, changed: added + updated > 0, added, updated };
}
