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
    team?: string
};