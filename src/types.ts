interface Clear {
    type: "CLEAR"
}

interface Shuffle {
    type: "SHUFFLE"
}

interface AttendeesUpdated {
    type: "ATTENDEES_UPDATED"
}

interface TeamChanged {
    type: "TEAM_CHANGED"
}

export type MessageTypes = Clear | Shuffle | AttendeesUpdated | TeamChanged;

export type Attendee = {
    id: string,
    name: string,
    avatarUrl: string,
    satDown: boolean,
    hasLinger: boolean,
    excludeFromShuffle: boolean,
    team?: string | string[]
};

/** Check if an attendee belongs to a given team */
export function isOnTeam(attendee: Attendee, team: string): boolean {
    if (!team || team.toLowerCase() === "all") return true;
    if (!attendee.team) return false;
    if (Array.isArray(attendee.team)) {
        return attendee.team.includes(team);
    }
    return attendee.team === team;
}

/** Get all unique team names from an attendee's team field */
export function getTeams(attendee: Attendee): string[] {
    if (!attendee.team) return [];
    if (Array.isArray(attendee.team)) return attendee.team;
    return [attendee.team];
}