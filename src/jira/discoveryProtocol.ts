export const DISCOVERY_PROTOCOL = "smartie-jira-discovery-v1";
export const JIRA_ORIGIN = "https://waystar.atlassian.net";
export type Candidate = { accountId: string; displayName: string; avatarUrl: string };
export type Board = { id: number; name: string; type: "scrum" | "kanban" };
export type Scope = "active" | "whole";
export type DiscoveryRequest = { protocol: typeof DISCOVERY_PROTOCOL; boardId: number } & (
    { operation: "board" } |
    { operation: "users"; query: string; startAt: number; maxResults: number } |
    { operation: "assignees"; scope: Scope; maxResults: number; nextPageToken?: string });
export type DiscoveryResponse =
    | { ok: true; kind: "board"; board: Board }
    | { ok: true; kind: "users"; candidates: Candidate[]; count: number; nextStartAt?: number; ceilingReached: boolean; emptyNotice?: string }
    | { ok: true; kind: "assignees"; candidates: Candidate[]; issueCount: number; nextPageToken?: string }
    | { ok: false; error: { code: string; message: string } };
export const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const boundedText = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export function boardIdFromUrl(value: string): number | null {
    try {
        const url = new URL(value);
        if (url.origin !== JIRA_ORIGIN || !url.pathname.startsWith("/jira/software/")) return null;
        const match = url.pathname.match(/\/boards\/([1-9]\d*)(?:\/|$)/);
        const id = match ? Number(match[1]) : 0;
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch { return null; }
}

export function isDiscoveryRequest(value: unknown): value is DiscoveryRequest {
    if (!record(value) || value.protocol !== DISCOVERY_PROTOCOL || !integer(value.boardId, 1, Number.MAX_SAFE_INTEGER)) return false;
    let keys = ["protocol", "boardId", "operation"];
    if (value.operation === "users") {
        keys = [...keys, "query", "startAt", "maxResults"];
        if (!boundedText(value.query, 200) || value.query.trim().length < 2 || !integer(value.startAt, 0, 999) || !integer(value.maxResults, 1, 50) || value.startAt + value.maxResults > 1000) return false;
    } else if (value.operation === "assignees") {
        keys = [...keys, "scope", "maxResults", "nextPageToken"];
        if (!["active", "whole"].includes(value.scope as string) || !integer(value.maxResults, 1, 100) || (value.nextPageToken !== undefined && !boundedText(value.nextPageToken, 4096))) return false;
    } else if (value.operation !== "board") return false;
    return Object.keys(value).every(key => keys.includes(key));
}

export function sanitizeCandidate(value: unknown): Candidate | null {
    if (!record(value) || !boundedText(value.accountId, 256) || !value.accountId.trim() || !boundedText(value.displayName, 500) || !value.displayName.trim()) return null;
    let avatarUrl = "";
    const avatar = record(value.avatarUrls) ? value.avatarUrls["48x48"] : value.avatarUrl;
    if (boundedText(avatar, 2048)) {
        try { const url = new URL(avatar); if (url.protocol === "https:" && !url.username && !url.password) avatarUrl = url.href; } catch { /* Invalid avatars use initials. */ }
    }
    return { accountId: value.accountId, displayName: value.displayName, avatarUrl };
}

export function uniqueCandidates(candidates: Candidate[]): Candidate[] {
    return [...new Map(candidates.map(candidate => [candidate.accountId, candidate])).values()];
}

export function isDiscoveryResponse(value: unknown): value is DiscoveryResponse {
    if (!record(value)) return false;
    if (value.ok === false) return record(value.error) && boundedText(value.error.code, 50) && boundedText(value.error.message, 500);
    if (value.ok !== true) return false;
    if (value.kind === "board") return record(value.board) && integer(value.board.id, 1, Number.MAX_SAFE_INTEGER) && boundedText(value.board.name, 500) && ["scrum", "kanban"].includes(value.board.type as string);
    if (!Array.isArray(value.candidates) || value.candidates.length > 100 || !value.candidates.every(candidate => record(candidate) && sanitizeCandidate(candidate) !== null && typeof candidate.avatarUrl === "string")) return false;
    if (value.kind === "users") return integer(value.count, 0, 50) && typeof value.ceilingReached === "boolean" && (value.nextStartAt === undefined || integer(value.nextStartAt, 1, 999)) && (value.emptyNotice === undefined || boundedText(value.emptyNotice, 500));
    return value.kind === "assignees" && integer(value.issueCount, 0, 100) && (value.nextPageToken === undefined || boundedText(value.nextPageToken, 4096));
}

export const failure = (code: string, message: string): DiscoveryResponse => ({ ok: false, error: { code, message } });
