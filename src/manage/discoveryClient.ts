import { boardIdFromUrl, Candidate, DISCOVERY_PROTOCOL, DiscoveryRequest, DiscoveryResponse, isDiscoveryResponse, JIRA_ORIGIN, Scope } from "../jira/discoveryProtocol";
export type BoardTab = { id: number; boardId: number; url: string };
export async function listBoardTabs(api: Pick<typeof chrome, "tabs"> = chrome): Promise<BoardTab[]> {
    const tabs = await api.tabs.query({ url: `${JIRA_ORIGIN}/jira/software/*` });
    return tabs.flatMap(tab => { const boardId = boardIdFromUrl(tab.url || ""); return tab.id !== undefined && boardId ? [{ id: tab.id, boardId, url: tab.url! }] : []; });
}

export function sendDiscovery(tabId: number, request: DiscoveryRequest): Promise<DiscoveryResponse> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The Jira tab did not respond. Refresh it to load the discovery content script.")), request.operation === "users" ? 32000 : 18000);
        try {
            chrome.tabs.sendMessage(tabId, request, (response: unknown) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) { reject(new Error("Could not connect to the Jira tab. Refresh the board after updating Smartie, then refresh tabs.")); return; }
                if (!isDiscoveryResponse(response)) { reject(new Error("The Jira tab returned an invalid discovery response. Refresh it after updating Smartie.")); return; }
                resolve(response);
            });
        } catch { clearTimeout(timer); reject(new Error("Could not connect to the selected Jira tab. Refresh tabs.")); }
    });
}
export type ScanSnapshot = { candidates: Candidate[]; issueCount: number; status: "idle" | "scanning" | "partial" | "complete" | "cancelled" | "error"; error: string; canContinue: boolean };
export class BoardScan {
    private candidates = new Map<string, Candidate>();
    private seenTokens = new Set<string>();
    private token?: string;
    private generation = 0;
    private context = "";
    private count = 0;
    private status: ScanSnapshot["status"] = "idle";
    private error = "";
    private blocked = false;
    snapshot(): ScanSnapshot { return { candidates: [...this.candidates.values()], issueCount: this.count, status: this.status, error: this.error, canContinue: !this.blocked && ["partial", "cancelled", "error"].includes(this.status) }; }
    cancel(): void { this.generation++; this.status = "cancelled"; }
    async batch(send: (request: DiscoveryRequest) => Promise<DiscoveryResponse>, boardId: number, scope: Scope, progress: (snapshot: ScanSnapshot) => void = () => {}): Promise<void> {
        if (this.status === "scanning" || this.status === "complete" || this.blocked) return;
        const context = `${boardId}:${scope}`;
        if (this.context && this.context !== context) throw new Error("Start a fresh scan after changing board or scope.");
        this.context = context;
        const run = ++this.generation;
        this.status = "scanning"; this.error = ""; progress(this.snapshot());
        let batchCount = 0;
        try {
            while (batchCount < 1000) {
                const response = await send({ protocol: DISCOVERY_PROTOCOL, operation: "assignees", boardId, scope, maxResults: Math.min(100, 1000 - batchCount), ...(this.token ? { nextPageToken: this.token } : {}) });
                if (run !== this.generation) return;
                if (!response.ok) throw new Error(response.error.message);
                if (response.kind !== "assignees" || response.issueCount > Math.min(100, 1000 - batchCount)) throw new Error("Invalid board scan page.");
                response.candidates.forEach(candidate => { if (!this.candidates.has(candidate.accountId)) this.candidates.set(candidate.accountId, candidate); });
                this.count += response.issueCount; batchCount += response.issueCount;
                if (response.nextPageToken && this.seenTokens.has(response.nextPageToken)) {
                    this.blocked = true;
                    throw new Error("Jira returned a repeated page token. Scan stopped with partial results; start a fresh scan.");
                }
                this.token = response.nextPageToken;
                if (this.token) this.seenTokens.add(this.token);
                if (!this.token) { this.status = "complete"; break; }
                if (!response.issueCount) {
                    this.blocked = true;
                    throw new Error("Jira returned an empty page with more pages. Scan stopped with partial results; start a fresh scan.");
                }
                progress(this.snapshot());
            }
            if (this.status === "scanning") this.status = "partial";
        } catch (error) {
            if (run !== this.generation) return;
            this.status = "error"; this.error = error instanceof Error ? error.message : "Board scan failed. Partial results are retained.";
        }
        if (run === this.generation) progress(this.snapshot());
    }
}
