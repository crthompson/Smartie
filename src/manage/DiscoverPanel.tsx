import React, { useEffect, useRef, useState } from "react";
import AttendeeAvatar from "../components/AttendeeAvatar";
import { AttendeeConfig } from "../config/attendeeConfig";
import { Board, boardIdFromUrl, Candidate, DISCOVERY_PROTOCOL, DiscoveryRequest, Scope, uniqueCandidates } from "../jira/discoveryProtocol";
import { BoardScan, BoardTab, listBoardTabs, ScanSnapshot, sendDiscovery } from "./discoveryClient";
import { SelectedCandidate } from "./discoverySelection";

type Props = { attendees: AttendeeConfig[]; teams: string[]; disabled: boolean; onAdd: (people: SelectedCandidate[], team: string) => string };
const idle = (): ScanSnapshot => ({ candidates: [], issueCount: 0, status: "idle", error: "", canContinue: false });

export default function DiscoverPanel({ attendees, teams, disabled, onAdd }: Props) {
    const [tabs, setTabs] = useState<BoardTab[]>([]);
    const [tabId, setTabId] = useState("");
    const [board, setBoard] = useState<Board | null>(null);
    const [mode, setMode] = useState<"people" | "board">("people");
    const [scope, setScope] = useState<Scope>("active");
    const [query, setQuery] = useState("");
    const [people, setPeople] = useState<Candidate[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [names, setNames] = useState<Record<string, string>>({});
    const [team, setTeam] = useState("");
    const [scan, setScan] = useState<ScanSnapshot>(idle);
    const [busy, setBusy] = useState(false);
    const [loadingBoardContext, setLoadingBoardContext] = useState(false);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [nextStart, setNextStart] = useState<number | undefined>();
    const [searchCount, setSearchCount] = useState(0);
    const generation = useRef(0);
    const boardContextGeneration = useRef(0);
    const scanner = useRef(new BoardScan());
    const chosen = tabs.find(tab => String(tab.id) === tabId);

    const reset = () => {
        generation.current++; scanner.current.cancel(); scanner.current = new BoardScan();
        setPeople([]); setSelected(new Set()); setNames({}); setNextStart(undefined); setSearchCount(0);
        setScan(idle()); setBusy(false); setNotice(""); setError("");
    };

    const refreshTabs = async () => {
        reset(); setTabId(""); setBoard(null); setTabs([]);
        const run = ++boardContextGeneration.current;
        setLoadingBoardContext(true);
        try {
            const available = await listBoardTabs();
            if (run !== boardContextGeneration.current) return;
            setTabs(available);
            if (!available.length) setNotice("No Waystar Jira board tabs found. Open a board at https://waystar.atlassian.net/jira/software/, sign in, then refresh tabs.");
        } catch { if (run === boardContextGeneration.current) setError("Could not list Waystar board tabs. Allow Smartie access to waystar.atlassian.net, then refresh tabs."); }
        finally { if (run === boardContextGeneration.current) setLoadingBoardContext(false); }
    };

    useEffect(() => { void refreshTabs(); return () => { generation.current++; boardContextGeneration.current++; scanner.current.cancel(); }; }, []);

    useEffect(() => {
        if (!chosen) return;
        const changed = (id: number, change: chrome.tabs.TabChangeInfo) => {
            if (id === chosen.id && change.url && boardIdFromUrl(change.url) !== chosen.boardId) void refreshTabs();
        };
        const removed = (id: number) => { if (id === chosen.id) void refreshTabs(); };
        chrome.tabs?.onUpdated?.addListener(changed);
        chrome.tabs?.onRemoved?.addListener(removed);
        return () => { chrome.tabs?.onUpdated?.removeListener(changed); chrome.tabs?.onRemoved?.removeListener(removed); };
    }, [chosen?.id, chosen?.boardId]);

    const chooseTab = async (id: string) => {
        reset(); setTabId(id); setBoard(null);
        const run = ++boardContextGeneration.current;
        setLoadingBoardContext(false);
        const tab = tabs.find(tab => String(tab.id) === id);
        if (!tab) return;
        setLoadingBoardContext(true);
        try {
            const response = await sendDiscovery(tab.id, { protocol: DISCOVERY_PROTOCOL, operation: "board", boardId: tab.boardId });
            if (run !== boardContextGeneration.current) return;
            if (!response.ok) throw new Error(response.error.message);
            if (response.kind !== "board" || response.board.id !== tab.boardId) throw new Error("The selected tab returned unexpected board metadata. Refresh tabs.");
            setBoard(response.board); setScope(response.board.type === "scrum" ? "active" : "whole");
        } catch (error) { if (run === boardContextGeneration.current) setError(error instanceof Error ? error.message : "Could not read the selected Jira board."); }
        finally { if (run === boardContextGeneration.current) setLoadingBoardContext(false); }
    };

    const search = async (offset = 0) => {
        if (!chosen || !board || query.trim().length < 2 || query.length > 200) return;
        if (offset === 0) reset();
        const run = ++generation.current;
        setBusy(true); setError(""); setNotice("Searching Jira people...");
        try {
            const response = await sendDiscovery(chosen.id, { protocol: DISCOVERY_PROTOCOL, operation: "users", boardId: chosen.boardId, query: query.trim(), startAt: offset, maxResults: Math.min(50, 1000 - offset) });
            if (run !== generation.current) return;
            if (!response.ok) throw new Error(response.error.message);
            if (response.kind !== "users") throw new Error("The selected tab returned unexpected search results.");
            setPeople(previous => uniqueCandidates([...previous, ...response.candidates]));
            setSearchCount(offset + response.count); setNextStart(response.nextStartAt);
            setNotice(response.ceilingReached ? "Jira limits user search to the first 1,000 results. Refine your search to find other people." : response.emptyNotice || (response.nextStartAt !== undefined ? "Search page loaded. Load more to continue." : "Search completed. Jira searches only the first 1,000 users; refine the name if someone is missing."));
        } catch (error) { if (run === generation.current) { setError(error instanceof Error ? error.message : "People search failed."); setNotice("Search failed. Any earlier pages are partial results."); } }
        finally { if (run === generation.current) setBusy(false); }
    };

    const scanBoard = async (fresh: boolean) => {
        if (!chosen || !board) return;
        if (fresh) reset();
        const run = ++generation.current;
        const activeScanner = scanner.current;
        setBusy(true); setError(""); setNotice("");
        const send = (request: DiscoveryRequest) => sendDiscovery(chosen.id, request);
        await activeScanner.batch(send, chosen.boardId, scope, progress => {
            if (run !== generation.current) return;
            setScan(progress); setPeople(progress.candidates); setError(progress.error);
        });
        if (run === generation.current) setBusy(false);
    };

    const cancel = () => {
        generation.current++; scanner.current.cancel(); setBusy(false);
        if (mode === "board") setScan(scanner.current.snapshot());
        setNotice("Discovery cancelled. Displayed people are partial results; no draft changes were discarded.");
    };

    const addSelected = () => {
        const chosenPeople = people.filter(person => selected.has(person.accountId)).map(person => ({ ...person, smartieName: names[person.accountId] ?? person.displayName }));
        setNotice(onAdd(chosenPeople, team)); setSelected(new Set());
    };
    const invalidName = people.some(person => selected.has(person.accountId) && !attendees.some(attendee => attendee.id === person.accountId) && !(names[person.accountId] ?? person.displayName).trim());
    const scanMessage = scan.status === "complete" ? "Board scan completed." : scan.status === "partial" ? "Batch finished. Partial results; continue to scan up to 1,000 more issues." : scan.status === "cancelled" ? "Board scan cancelled. Partial results." : scan.status === "error" ? "Board scan failed. Partial results; start a fresh scan to retry." : scan.status === "scanning" ? "Scanning board issues..." : "";

    return <details className="discovery-panel" open>
        <summary>Find people in Jira</summary>
        <p>Use one open, signed-in Waystar Jira board tab for both discovery paths. Refresh the Jira tab after updating Smartie. Discovery works even when the standup panel is disabled.</p>
        <div className="discovery-tools">
            <label>Jira board tab <select aria-label="Jira board tab" value={tabId} onChange={event => void chooseTab(event.target.value)} disabled={disabled}>
                <option value="">Choose an open board tab</option>
                {tabs.map(tab => <option key={tab.id} value={tab.id}>Board {tab.boardId} - tab {tab.id}</option>)}
            </select></label>
            <button type="button" className="button secondary" onClick={() => void refreshTabs()} disabled={disabled}>Refresh tabs</button>
        </div>
        {board && <p><strong>{board.name}</strong> (board {board.id}, {board.type})</p>}
        {loadingBoardContext && <p role="status">Loading Jira board context...</p>}
        <div className="discovery-tools">
            <label>Discovery path <select aria-label="Discovery path" value={mode} onChange={event => { reset(); setMode(event.target.value as "people" | "board"); }} disabled={disabled}>
                <option value="people">Search people by name</option><option value="board">Board assignees</option>
            </select></label>
            {mode === "people" ? <>
                <label>Name <input aria-label="Search Jira people" value={query} maxLength={200} onChange={event => { reset(); setQuery(event.target.value); }} disabled={disabled} /></label>
                <button type="button" className="button" disabled={disabled || busy || !board || query.trim().length < 2} onClick={() => void search()}>Search</button>
                {nextStart !== undefined && <button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void search(nextStart)}>Load more</button>}
            </> : <>
                <label>Board scope <select aria-label="Board scope" value={scope} onChange={event => { reset(); setScope(event.target.value as Scope); }} disabled={disabled || !board}>
                    {(!board || board.type === "scrum") && <option value="active">Active sprints only (Scrum default)</option>}
                    <option value="whole">Whole board (all matching issues, including backlog)</option>
                </select></label>
                <button type="button" className="button" disabled={disabled || busy || !board} onClick={() => void scanBoard(true)}>Scan board</button>
                {scan.canContinue && <button type="button" className="button secondary" disabled={disabled || busy} onClick={() => void scanBoard(false)}>Continue scan</button>}
            </>}
            {busy && <button type="button" className="button secondary" onClick={cancel}>Cancel discovery</button>}
        </div>
        <p>{mode === "people" ? "Enter at least two characters. Search loads 50 results per page. Jira limits user search to the first 1,000 results." : "Each click scans at most 1,000 issues, in pages of at most 100. Only assignees are read; issue summaries, descriptions, and comments are not requested."}</p>
        {board?.type === "kanban" && mode === "board" && <p>Kanban has no sprint scope. Discovery scans the whole board.</p>}
        <p role="status" aria-live="polite">{mode === "board" ? `${scan.issueCount} issues scanned; ${people.length} unique people. ${scanMessage}` : `${searchCount} search results read; ${people.length} unique people.`} {notice}</p>
        {error && <p role="alert" className="status-error">{error}</p>}
        {people.length > 0 && <>
            <p>No people are selected by default. For people not in your draft, edit <strong>Smartie Name</strong> to match the desired Quick or Custom filter label. Jira full names are not shortened automatically. Existing attendee names, avatars, and shuffle settings are preserved.</p>
            <div className="discovery-tools">
                <label>Target team (optional) <input aria-label="Target team" list="discovery-teams" value={team} onChange={event => setTeam(event.target.value)} disabled={disabled} /></label>
                <datalist id="discovery-teams">{teams.map(team => <option value={team} key={team} />)}</datalist>
                <button type="button" className="button" disabled={disabled || selected.size === 0 || invalidName} onClick={addSelected}>Add selected to draft</button>
                <span>{selected.size} selected. Save changes to persist additions.</span>
            </div>
            <div className="discovery-candidates">{people.map(person => {
                const exists = attendees.some(attendee => attendee.id === person.accountId);
                return <div className="discovery-person" key={person.accountId}>
                    <input type="checkbox" aria-label={`Select ${person.displayName}`} checked={selected.has(person.accountId)} disabled={disabled} onChange={event => { const checked = event.target.checked; setSelected(previous => { const next = new Set(previous); if (checked) next.add(person.accountId); else next.delete(person.accountId); return next; }); }} />
                    <AttendeeAvatar name={person.displayName} url={person.avatarUrl} className="manager-avatar" />
                    <div><strong>{person.displayName}</strong><div className="discovery-account">{person.accountId}</div></div>
                    {exists ? <span>Already in draft; only target team can be added.</span> : <label>Smartie Name <input aria-label={`Smartie Name for ${person.accountId}`} value={names[person.accountId] ?? person.displayName} disabled={disabled} onChange={event => setNames(previous => ({ ...previous, [person.accountId]: event.target.value }))} /></label>}
                </div>;
            })}</div>
        </>}
    </details>;
}
