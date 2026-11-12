import { Board, boundedText, Candidate, DISCOVERY_PROTOCOL, DiscoveryResponse, failure, isDiscoveryRequest, JIRA_ORIGIN, boardIdFromUrl, record, sanitizeCandidate, uniqueCandidates } from "../jira/discoveryProtocol";

type FetchPage = (input: string, init?: RequestInit) => Promise<Response>;
class DiscoveryError extends Error {
    constructor(public code: string, message: string) { super(message); }
}

async function fetchPage(url: URL, fetcher: FetchPage, readBody = true): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetcher(url.href, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal, redirect: "error" });
        if (response.status === 401) throw new DiscoveryError("signed-out", "Not signed in. Sign in to Waystar Jira and refresh the board tab.");
        if (response.status === 403) throw new DiscoveryError("forbidden", "Jira denied access. Check your board or Browse users permission.");
        if (response.status === 429) {
            const retry = response.headers.get("Retry-After");
            const delay = retry && /^\d{1,6}$/.test(retry) ? Number(retry) : retry && retry.length <= 50 ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) : NaN;
            const seconds = Number.isFinite(delay) ? ` Retry after ${delay} seconds.` : " Wait before trying again.";
            throw new DiscoveryError("rate-limit", `Jira rate limit reached.${seconds}`);
        }
        if (!response.ok) throw new DiscoveryError("http", `Jira request failed (HTTP ${response.status}).`);
        if (response.redirected || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new DiscoveryError("signed-out", "Jira returned a sign-in page or non-JSON response. Sign in and refresh the board tab.");
        if (!readBody) return undefined;
        try { return await response.json(); } catch {
            if (controller.signal.aborted) throw new DiscoveryError("timeout", "Jira request timed out after 15 seconds. Try again.");
            throw new DiscoveryError("malformed", "Jira returned invalid JSON.");
        }
    } catch (error) {
        if (error instanceof DiscoveryError) throw error;
        if (controller.signal.aborted) throw new DiscoveryError("timeout", "Jira request timed out after 15 seconds. Try again.");
        throw new DiscoveryError("network", "Could not reach Jira. Check the selected tab, sign-in, and connection.");
    } finally { clearTimeout(timer); }
}

export async function executeDiscovery(message: unknown, locationUrl: string, fetcher: FetchPage = fetch): Promise<DiscoveryResponse> {
    if (!isDiscoveryRequest(message) || boardIdFromUrl(locationUrl) !== message.boardId) return failure("invalid", "Invalid discovery request or the selected tab changed boards. Refresh tabs.");
    try {
        if (message.operation === "board") {
            const data = await fetchPage(new URL(`/rest/agile/1.0/board/${message.boardId}`, JIRA_ORIGIN), fetcher);
            if (!record(data) || data.id !== message.boardId || !boundedText(data.name, 500) || !["scrum", "kanban"].includes(data.type as string)) throw new DiscoveryError("malformed", "Jira returned invalid board metadata.");
            return { ok: true, kind: "board", board: { id: message.boardId, name: data.name, type: data.type as Board["type"] } };
        }
        if (message.operation === "users") {
            const url = new URL("/rest/api/3/user/search", JIRA_ORIGIN);
            url.search = new URLSearchParams({ query: message.query.trim(), startAt: String(message.startAt), maxResults: String(message.maxResults) }).toString();
            const data = await fetchPage(url, fetcher);
            if (!Array.isArray(data) || data.length > message.maxResults) throw new DiscoveryError("malformed", "Jira returned an invalid people search page.");
            const candidates = data.map(sanitizeCandidate);
            if (candidates.some(candidate => !candidate)) throw new DiscoveryError("malformed", "Jira returned a person without an account ID or display name.");
            if (!data.length) await fetchPage(new URL("/rest/api/3/myself", JIRA_ORIGIN), fetcher, false);
            const next = message.startAt + data.length;
            const ceilingReached = next >= 1000;
            return { ok: true, kind: "users", candidates: uniqueCandidates(candidates as Candidate[]), count: data.length, ceilingReached,
                ...(data.length === message.maxResults && !ceilingReached ? { nextStartAt: next } : {}),
                ...(!data.length ? { emptyNotice: "No matches. Jira can also return no results without Browse users permission; check access or refine your search." } : {}) };
        }
        const url = new URL(`/rest/software/1.0/board/${message.boardId}/issue`, JIRA_ORIGIN);
        url.search = new URLSearchParams({ maxResults: String(message.maxResults), fields: "assignee", jql: message.scope === "active" ? "sprint in openSprints() AND assignee IS NOT EMPTY" : "assignee IS NOT EMPTY",
            ...(message.nextPageToken ? { nextPageToken: message.nextPageToken } : {}) }).toString();
        const data = await fetchPage(url, fetcher);
        if (!record(data) || !Array.isArray(data.issues) || data.issues.length > message.maxResults || (data.nextPageToken !== undefined && !boundedText(data.nextPageToken, 4096))) throw new DiscoveryError("malformed", "Jira returned an invalid board issue page.");
        const candidates: Candidate[] = [];
        for (const issue of data.issues) {
            if (!record(issue) || !record(issue.fields) || !("assignee" in issue.fields)) throw new DiscoveryError("malformed", "Jira returned an issue without the requested assignee field.");
            if (issue.fields.assignee === null) continue;
            const candidate = sanitizeCandidate(issue.fields.assignee);
            if (!candidate) throw new DiscoveryError("malformed", "Jira returned an invalid assignee.");
            candidates.push(candidate);
        }
        return { ok: true, kind: "assignees", candidates: uniqueCandidates(candidates), issueCount: data.issues.length,
            ...(data.nextPageToken === undefined ? {} : { nextPageToken: data.nextPageToken }) };
    } catch (error) {
        return error instanceof DiscoveryError ? failure(error.code, error.message) : failure("malformed", "Could not read Jira discovery results.");
    }
}

export function registerJiraDiscovery(api: Pick<typeof chrome, "runtime"> = chrome, locationUrl: string | (() => string) = () => location.href, fetcher: FetchPage = fetch): void {
    api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
        if (!record(message) || message.protocol !== DISCOVERY_PROTOCOL || sender.id !== api.runtime.id) return;
        try {
            const url = new URL(sender.url || "");
            if (url.protocol !== "chrome-extension:" || url.hostname !== api.runtime.id || url.pathname !== "/manage.html") return;
        } catch { return; }
        const currentLocation = () => typeof locationUrl === "function" ? locationUrl() : locationUrl;
        void executeDiscovery(message, currentLocation(), fetcher).then(response => {
            if (isDiscoveryRequest(message) && boardIdFromUrl(currentLocation()) !== message.boardId) {
                sendResponse(failure("invalid", "The selected Jira tab changed boards during discovery. Refresh tabs."));
            } else sendResponse(response);
        });
        return true;
    });
}
