import React, { useEffect, useRef, useState } from "react";
import AttendeeAvatar from "../components/AttendeeAvatar";
import { ConfigurationPreview, ImportMode, mergeConfiguration, parseConfigurationImport, SmartieConfiguration } from "../config/attendeeConfig";
import { getConfigurationTeams, loadConfiguration, restorePreviousConfiguration, saveConfiguration } from "../config/configStorage";
import DiscoverPanel from "./DiscoverPanel";
import { mergeDiscovered, SelectedCandidate } from "./discoverySelection";


type MappingRow = { key: number; team: string; boardPath: string };
let nextRowKey = 1;
const newRowKey = () => nextRowKey++;
const mappingSummary = (included: boolean, mode: ImportMode): string => {
    if (mode === "merge") {
        return included
            ? "Imported board mappings override saved mappings for the same team; other saved mappings are kept."
            : "The import has no board mappings; saved mappings are kept.";
    }
    return included
        ? "Imported board mappings replace all saved mappings."
        : "The import has no board mappings; replace clears all saved mappings.";
};
const blankConfiguration = (): SmartieConfiguration => ({ version: 1, attendees: [], boardMappings: {} });
const parseTeamNames = (value: string): string[] => [...new Set(value.split(";").map(team => team.trim()).filter(Boolean))];
const getTeamNames = (team: string | string[] | undefined): string[] => !team ? [] : Array.isArray(team) ? team : [team];
const mappingsToRows = (mappings: Record<string, string>): MappingRow[] =>
    Object.entries(mappings).map(([team, boardPath]) => ({ key: newRowKey(), team, boardPath }));
const rowsToMappings = (rows: MappingRow[]): Record<string, string> => {
    const mappings: Record<string, string> = {};
    rows.forEach(row => { mappings[row.team] = row.boardPath; });
    return mappings;
};

const ManageApp = () => {
    const [saved, setSaved] = useState<SmartieConfiguration>(blankConfiguration());
    const [draft, setDraft] = useState<SmartieConfiguration>(blankConfiguration());
    const [attendeeKeys, setAttendeeKeys] = useState<number[]>([]);
    const [teamText, setTeamText] = useState<Record<number, string>>({});
    const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [importMode, setImportMode] = useState<ImportMode>("merge");
    const [preview, setPreview] = useState<ConfigurationPreview | null>(null);
    const [dirty, setDirty] = useState(false);
    const [hasBackup, setHasBackup] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [messageKind, setMessageKind] = useState<"error" | "success" | "info">("info");
    const fileRef = useRef<HTMLInputElement>(null);
    const savingRef = useRef(false);
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;

    const showDraft = (configuration: SmartieConfiguration) => {
        setDraft(configuration);
        setAttendeeKeys(configuration.attendees.map(() => newRowKey()));
        setTeamText({});
        setMappingRows(mappingsToRows(configuration.boardMappings));
    };

    const tell = (text: string, kind: "error" | "success" | "info" = "info") => {
        setMessage(text);
        setMessageKind(kind);
    };

    const loadSaved = async () => {
        const configuration = await loadConfiguration(chrome.storage.local);
        const stored = await chrome.storage.local.get("smartieConfigurationBackup");
        setSaved(configuration);
        setHasBackup(stored.smartieConfigurationBackup !== undefined);
        setLoaded(true);
        if (dirtyRef.current) return;
        showDraft(configuration);
        setPreview(null);
        setDirty(false);
        const selected = await chrome.storage.local.get("selectedTeam");
        const team = selected.selectedTeam || "all";
        if (team !== "all" && !getConfigurationTeams(configuration).includes(team)) {
            await chrome.storage.local.set({ selectedTeam: "all" });
        }
    };

    useEffect(() => {
        void loadSaved().catch(error => tell(`Could not load attendee configuration: ${String(error)}`, "error"));
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.smartieConfiguration || changes.attendees || changes.boardMappings || changes.smartieConfigurationBackup) {
                if (savingRef.current) return;
                if (dirtyRef.current) {
                    tell("Configuration changed in another Smartie tab. Your draft is still open; reload to review the saved version.", "info");
                    return;
                }
                void loadSaved().catch(error => tell(`Could not refresh attendee configuration: ${String(error)}`, "error"));
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    const updateAttendee = (index: number, patch: Partial<SmartieConfiguration["attendees"][number]>) => {
        setDraft(current => ({ ...current, attendees: current.attendees.map((attendee, row) => row === index ? { ...attendee, ...patch } : attendee) }));
        setDirty(true);
    };

    const updateMapping = (index: number, patch: Partial<MappingRow>) => {
        setMappingRows(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
        setDirty(true);
    };

    const setImportPreview = (configuration: SmartieConfiguration, info: ConfigurationPreview | null) => {
        showDraft(configuration);
        setPreview(info);
        setDirty(true);
    };

    const readImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const parsed = parseConfigurationImport(await file.text());
            if (!parsed.ok) {
                tell(parsed.errors.join(" "), "error");
                return;
            }
            const result = dirty ? validatedDraft() : await loadConfiguration(chrome.storage.local);
            if (!result) return;
            const base = result;
            const previewed = mergeConfiguration(base, parsed.configuration, parsed.mappingsIncluded, importMode);
            const { addedIds: _added, updatedIds: _updated, removedIds: _removed, mappingsIncluded: _included, ...configuration } = previewed;
            setImportPreview(configuration, previewed);
            const mappingMessage = mappingSummary(parsed.mappingsIncluded, importMode);
            tell(`Preview: ${previewed.addedIds.length} added, ${previewed.updatedIds.length} updated, ${previewed.removedIds.length} removed. ${mappingMessage}`, "info");
        } catch (error) {
            tell(`Could not preview import: ${String(error)}`, "error");
        }
    };

    const validatedDraft = (): SmartieConfiguration | null => {
        const duplicateTeam = mappingRows.find((row, index) => row.team.trim() && mappingRows.slice(0, index).some(previous => previous.team.trim() === row.team.trim()));
        if (duplicateTeam) {
            tell(`Board mapping for "${duplicateTeam.team}" appears more than once.`, "error");
            return null;
        }
        const result = parseConfigurationImport(JSON.stringify({ version: 1, attendees: draft.attendees, boardMappings: rowsToMappings(mappingRows) }));
        if (!result.ok) {
            tell(result.errors.join(" "), "error");
            return null;
        }
        return result.configuration;
    };

    const saveDraft = async () => {
        const configuration = validatedDraft();
        if (!configuration) return;
        setBusy(true);
        savingRef.current = true;
        try {
            await saveConfiguration(chrome.storage.local, configuration, !!preview);
            setSaved(configuration);
            showDraft(configuration);
            setPreview(null);
            setDirty(false);
            setHasBackup(true);
            tell(preview ? "Imported configuration saved. Standup flags were reset." : "Configuration saved.", "success");
        } catch (error) {
            tell(`Could not save configuration: ${String(error)}`, "error");
        } finally {
            savingRef.current = false;
            setBusy(false);
        }
    };

    const cancelDraft = () => {
        showDraft(saved);
        setPreview(null);
        setDirty(false);
        tell("Draft changes discarded.", "info");
    };

    const restoreBackup = async () => {
        setBusy(true);
        savingRef.current = true;
        try {
            const restored = await restorePreviousConfiguration(chrome.storage.local);
            if (!restored) {
                tell("No previous configuration is available to restore.", "info");
                return;
            }
            dirtyRef.current = false;
            await loadSaved();
            tell("Previous configuration restored.", "success");
        } catch (error) {
            tell(`Could not restore the previous configuration: ${String(error)}`, "error");
        } finally {
            savingRef.current = false;
            setBusy(false);
        }
    };

    const exportSaved = () => {
        const blob = new Blob([JSON.stringify({ version: 1, attendees: saved.attendees, boardMappings: saved.boardMappings }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "smartie-configuration.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const addAttendee = () => {
        setDraft(current => ({ ...current, attendees: [...current.attendees, { id: "", name: "", avatarUrl: "", excludeFromShuffle: false, team: "" }] }));
        setAttendeeKeys(keys => [...keys, newRowKey()]);
        setDirty(true);
    };

    const addDiscovered = (people: SelectedCandidate[], team: string): string => {
        const result = mergeDiscovered(draft, people, team);
        if (!result.changed) return "Selected people are already in the draft with these team memberships. No changes made.";
        setDraft(result.configuration);
        setAttendeeKeys(keys => [...keys, ...Array.from({ length: result.added }, newRowKey)]);
        setTeamText(previous => {
            const next = { ...previous };
            draft.attendees.forEach((attendee, index) => {
                if (attendee !== result.configuration.attendees[index] && next[attendeeKeys[index]] !== undefined) {
                    const raw = next[attendeeKeys[index]];
                    next[attendeeKeys[index]] = `${raw}${raw.trim() ? (raw.trimEnd().endsWith(";") ? " " : "; ") : ""}${team.trim()}`;
                }
            });
            return next;
        });
        dirtyRef.current = true;
        setDirty(true);
        return `${result.added} attendees added; ${result.updated} existing team memberships updated in draft. Save changes to persist them.`;
    };

    const removeAttendee = (index: number) => {
        setDraft(current => ({ ...current, attendees: current.attendees.filter((_, row) => row !== index) }));
        setAttendeeKeys(keys => keys.filter((_, row) => row !== index));
        setDirty(true);
    };

    const removeMapping = (index: number) => {
        setMappingRows(rows => rows.filter((_, row) => row !== index));
        setDirty(true);
    };

    const editTeams = (index: number, text: string) => {
        setTeamText(current => ({ ...current, [attendeeKeys[index]]: text }));
        updateAttendee(index, { team: parseTeamNames(text) });
    };

    const normalizeTeams = (index: number) => {
        setTeamText(current => {
            const next = { ...current };
            delete next[attendeeKeys[index]];
            return next;
        });
    };

    const messageClass = `status status-${messageKind}`;

    return (
        <main className="manager" aria-busy={!loaded}>
            <fieldset className="manager-editor" disabled={!loaded}>
            <header className="manager-header">
                <div><h1>Manage teams</h1><p>Manage attendees, team membership, board mappings, and portable configuration files.</p></div>
                <div className="header-actions">
                    <button type="button" className="button secondary" onClick={exportSaved}>Export saved configuration</button>
                    <button type="button" className="button secondary" disabled={!hasBackup || busy} onClick={() => void restoreBackup()}>Undo last save</button>
                </div>
            </header>
            <p className="identity-help"><strong>Jira account ID</strong> identifies the person across Jira accounts. <strong>Name</strong> is the label Smartie matches against existing Quick and Custom filters. Team names can be separated with semicolons. Avatar URLs are optional.</p>
            <div className="import-tools">
                <label htmlFor="import-mode">Import behavior</label>
                <select id="import-mode" value={importMode} onChange={event => setImportMode(event.target.value as ImportMode)} disabled={!!preview}>
                    <option value="merge">Merge by exact Jira account ID</option>
                    <option value="replace">Replace attendees and mappings</option>
                </select>
                <button type="button" className="button" onClick={() => fileRef.current?.click()} disabled={busy}>Preview JSON import</button>
                <input ref={fileRef} className="file-input" type="file" accept="application/json,.json" aria-label="Choose a Smartie configuration JSON file" onChange={event => void readImport(event)} />
                <span>Accepts an attendee array, a legacy object, or a version 1 configuration.</span>
            </div>
            {preview && <section className="import-preview" aria-label="Import preview">
                <h2>Import preview</h2>
                <p>Before table edits: {preview.addedIds.length} attendees added, {preview.updatedIds.length} updated, and {preview.removedIds.length} removed.</p>
                {preview.removedIds.length > 0 && <p className="warning">Removed Jira account IDs: {preview.removedIds.join(", ")}</p>}
                <p>{mappingSummary(preview.mappingsIncluded, importMode)}</p>
                <p>Edit the attendee and mapping tables before saving. No storage changes occur until you save this preview.</p>
            </section>}
            <DiscoverPanel attendees={draft.attendees} teams={getConfigurationTeams(draft)} disabled={busy || !loaded} onAdd={addDiscovered} />
            <section>
                <div className="section-heading"><h2>Attendees ({draft.attendees.length})</h2><button type="button" className="button secondary" onClick={addAttendee}>Add attendee</button></div>
                <div className="table-scroll"><table><thead><tr><th>Avatar</th><th>Jira account ID</th><th>Name</th><th>Teams</th><th>Exclude from shuffle</th><th>Actions</th></tr></thead>
                    <tbody>{draft.attendees.map((attendee, index) => <tr key={attendeeKeys[index]}>
                        <td><AttendeeAvatar name={attendee.name || "Attendee"} url={attendee.avatarUrl} className="manager-avatar" /></td>
                        <td><input aria-label={`Jira account ID for attendee ${index + 1}`} value={attendee.id} onChange={event => updateAttendee(index, { id: event.target.value })} /></td>
                        <td><input aria-label={`Name for attendee ${index + 1}`} value={attendee.name} onChange={event => updateAttendee(index, { name: event.target.value })} /></td>
                        <td><input aria-label={`Teams for attendee ${index + 1}`} value={teamText[attendeeKeys[index]] ?? getTeamNames(attendee.team).join("; ")} onChange={event => editTeams(index, event.target.value)} onBlur={() => normalizeTeams(index)} /></td>
                        <td><input type="checkbox" aria-label={`Exclude attendee ${index + 1} from shuffle`} checked={!!attendee.excludeFromShuffle} onChange={event => updateAttendee(index, { excludeFromShuffle: event.target.checked })} /></td>
                        <td className="row-actions"><input aria-label={`Avatar URL for attendee ${index + 1}`} placeholder="Optional avatar URL" value={attendee.avatarUrl || ""} onChange={event => updateAttendee(index, { avatarUrl: event.target.value })} /><button type="button" className="text-button" onClick={() => removeAttendee(index)}>Remove</button></td>
                    </tr>)}</tbody>
                </table></div>
            </section>
            <section>
                <div className="section-heading"><div><h2>Board mappings</h2><p>Map a team to a board path substring, for example <code>/jira/software/c/projects/ABC/boards/12</code>.</p></div>
                    <button type="button" className="button secondary" onClick={() => { setMappingRows(rows => [...rows, { key: newRowKey(), team: "", boardPath: "" }]); setDirty(true); }}>Add mapping</button></div>
                <div className="mapping-list">{mappingRows.map((row, index) => <div className="mapping-row" key={row.key}>
                    <label>Team <input value={row.team} aria-label={`Mapped team ${index + 1}`} onChange={event => updateMapping(index, { team: event.target.value })} /></label>
                    <label>Board path substring <input value={row.boardPath} aria-label={`Board path for mapping ${index + 1}`} onChange={event => updateMapping(index, { boardPath: event.target.value })} /></label>
                    <button type="button" className="text-button" onClick={() => removeMapping(index)}>Remove mapping</button>
                </div>)}</div>
            </section>
            <div className="save-bar">
                {dirty && <span>Unsaved draft changes</span>}
                <button type="button" className="button secondary" disabled={!dirty || busy} onClick={cancelDraft}>Cancel</button>
                <button type="button" className="button" disabled={!dirty || busy} onClick={() => void saveDraft()}>{preview ? "Save import" : "Save changes"}</button>
            </div>
            </fieldset>
            <div className={messageClass} role={messageKind === "error" ? "alert" : "status"} aria-live="polite">{message || (loaded ? "" : "Loading saved configuration...")}</div>
        </main>
    );
};

export default ManageApp;
