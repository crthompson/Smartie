import React, { useEffect, useState } from "react";
import { MessageTypes } from "../types";
import { getConfigurationTeams, loadConfiguration } from "../config/configStorage";

type CheckboxProps = { checked: boolean; id: string; label: string; onChange: () => void };
const Checkbox = ({ checked, id, label, onChange }: CheckboxProps) => (
    <div className="checkbox">
        <input className="checkbox__input" type="checkbox" id={id} checked={checked} onChange={onChange} />
        <label className="checkbox__label" htmlFor={id}>{label}</label>
    </div>
);

const PopupApp = () => {
    const [enabled, setEnabled] = useState(false);
    const [cleared, setCleared] = useState(false);
    const [shuffled, setShuffled] = useState(false);
    const [selectedTeam, setSelectedTeam] = useState("all");
    const [teams, setTeams] = useState<string[]>([]);

    const refresh = async () => {
        const [enabledValue, clearedValue, shuffledValue, selected, configuration] = await Promise.all([
            chrome.storage.local.get("enabled"), chrome.storage.local.get("cleared"),
            chrome.storage.local.get("shuffled"), chrome.storage.local.get("selectedTeam"),
            loadConfiguration(chrome.storage.local),
        ]);
        setEnabled(!!enabledValue.enabled);
        setCleared(!!clearedValue.cleared);
        setShuffled(!!shuffledValue.shuffled);
        const availableTeams = getConfigurationTeams(configuration);
        setTeams(availableTeams);
        const selection = selected.selectedTeam || "all";
        const validSelection = selection === "all" || availableTeams.includes(selection) ? selection : "all";
        setSelectedTeam(validSelection);
        if (selection !== validSelection) await chrome.storage.local.set({ selectedTeam: validSelection });
    };

    useEffect(() => {
        void refresh().catch(error => console.error("Smartie popup could not load settings", error));
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.smartieConfiguration || changes.attendees || changes.selectedTeam || changes.enabled || changes.cleared || changes.shuffled) {
                void refresh().catch(error => console.error("Smartie popup could not refresh settings", error));
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    const sendMessage = async (message: MessageTypes) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, message);
    };

    const changeBoolean = async (key: string, value: boolean, update: (next: boolean) => void) => {
        await chrome.storage.local.set({ [key]: value });
        update(value);
    };

    const handleTeamChange = async (team: string) => {
        await chrome.storage.local.set({ selectedTeam: team });
        setSelectedTeam(team);
        await sendMessage({ type: "TEAM_CHANGED" });
    };

    const openManager = async () => {
        await chrome.runtime.openOptionsPage();
    };

    return (
        <div className="container">
            <h2>Smartie Standup</h2>
            <div className="settings-row">
                <div>
                    <span>On Refresh:</span>
                    <Checkbox id="cleared" checked={cleared} label="Clear" onChange={() => void changeBoolean("cleared", !cleared, setCleared)} />
                    <Checkbox id="shuffled" checked={shuffled} label="Shuffle" onChange={() => void changeBoolean("shuffled", !shuffled, setShuffled)} />
                </div>
                <Checkbox id="enabled" checked={enabled} label="Enabled" onChange={() => void changeBoolean("enabled", !enabled, setEnabled)} />
            </div>
            {teams.length > 0 && <div className="select-team">
                <label htmlFor="team">Select Team: </label>
                <select id="team" name="team" value={selectedTeam} onChange={event => void handleTeamChange(event.target.value)}>
                    {["all", ...teams].map(team => <option key={team} value={team}>{team === "all" ? "All" : team}</option>)}
                </select>
            </div>}
            <div className="controls">
                <button className="button" onClick={() => void sendMessage({ type: "SHUFFLE" })}>Shuffle</button>
                <button className="button" onClick={() => void sendMessage({ type: "CLEAR" })}>Clear</button>
            </div>
            <div className="manage-attendees">
                <button className="button manager-button" onClick={() => void openManager()}>Manage teams</button>
            </div>
            <span className="version">v{chrome.runtime.getManifest().version}</span>
        </div>
    );
};

export default PopupApp;
