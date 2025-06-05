import React, { useEffect, useState } from "react";
import { Attendee, MessageTypes } from "../types";

type EnabledProps = {
    checked: boolean
};

type Clearedprops = {
    cleared: boolean
};

type Shuffledprops = {
    shuffled: boolean
};

const Enabledbox = (props: EnabledProps) => {
    const [checked, setChecked] = useState(props.checked);

    useEffect(() => {
        setChecked(props.checked);
    }, [props.checked]);

    const handleOnChange = () => {
        chrome.storage.local.set({ enabled: !checked });
        setChecked(!checked);
    };

    return (
        <div className="checkbox">
            <input className="checkbox__input" type="checkbox" id="enabled" name="enabled" checked={checked} onChange={handleOnChange} />
            <label className="checkbox__label" htmlFor="enabled">Enabled</label>
        </div>
    );
};

const Clearedbox = (props: Clearedprops) => {
    const [cleared, setCleared] = useState(props.cleared);

    useEffect(() => {
        setCleared(props.cleared);
    }, [props.cleared]);

    const handleOnChange = () => {
        chrome.storage.local.set({ cleared: !cleared });
        setCleared(!cleared);
    };

    return (
        <div className="clearedbox">
            <input className="checkbox__input" type="checkbox" id="cleared" name="cleared" checked={cleared} onChange={handleOnChange} />
            <label className="checkbox__label" htmlFor="cleared">Clear</label>
        </div>
    );
};

const Shuffledbox = (props: Shuffledprops) => {
    const [shuffled, setShuffled] = useState(props.shuffled);

    useEffect(() => {
        setShuffled(props.shuffled);
    }, [props.shuffled]);

    const handleOnChange = () => {
        chrome.storage.local.set({ shuffled: !shuffled });
        setShuffled(!shuffled);
    };

    return (
        <div className="shuffledbox">
            <input className="checkbox__input" type="checkbox" id="shuffled" name="shuffled" checked={shuffled} onChange={handleOnChange} />
            <label className="checkbox__label" htmlFor="shuffled">Shuffle</label>
        </div>
    );
};

const PopupApp = () => {
    const [enabled, setEnabled] = useState(false);
    const [cleared, setCleared] = useState(false);
    const [shuffled, setShuffled] = useState(false);

    useEffect(() => {
        (async () => {
            const result = await chrome.storage.local.get("enabled");
            setEnabled(!!result.enabled);
            const cleared = await chrome.storage.local.get("cleared");
            setCleared(!!cleared.cleared);
            const shuffled = await chrome.storage.local.get("shuffled");
            setShuffled(!!shuffled.shuffled);
        })();
    }, []);

    const sendMessage = async (message: MessageTypes) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, message);
        }
    };

    const handleOnShuffle = () => {
        sendMessage({ type: "SHUFFLE" });
    };

    const handleOnClear = () => {
        sendMessage({ type: "CLEAR" });
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList) {
            return;
        }
        const file = fileList.item(0);
        if (!file) {
            return;
        }
        const data = await file.text();
        let attendees = JSON.parse(data);
        if (!(attendees instanceof Array)) {
            console.log("Attendees import must be an array of valid attendees");
            return;
        }
        const isValid = attendees.every(a => a.id && a.name && a.avatarUrl);
        if (!isValid) {
            console.log("Attendees import must be an array of attendee objects with id, name, and avatarUrl");
            return;
        }
        attendees = attendees.map(a => ({
            ...a,
            satDown: false,
            hasLinger: false,
        }));
        chrome.storage.local.set({ attendees });
        sendMessage({ type: "ATTENDEES_UPDATED" });
    };

    const handleOnImport = () => {
        const input = document.querySelector('#importedAttendees') as HTMLInputElement;
        input && input.click();
    };

    const handleOnExport = async () => {
        const attendeesResult = await chrome.storage.local.get("attendees");
        if (!attendeesResult.attendees) {
            console.log("Error exporting attendees. Attendees not found.");
            return;
        }
        const attendees: Attendee[] = attendeesResult.attendees.map((a: Attendee) => ({
            id: a.id,
            name: a.name,
            avatarUrl: a.avatarUrl
        }));
        const content = JSON.stringify(attendees, null, 2);
        const blob = new Blob([content], {
            type: 'application/json'
        });
        const fileName = "attendees.json";
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    };

    return (
        <div className="container">
            <h2>Smartie Standup</h2>
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", flexDirection: "row" }}>
                        <span>On Refresh:</span></div>
                    <div style={{ display: "flex", flexDirection: "row" }}>
                        <Clearedbox cleared={cleared} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "row" }}>
                        <Shuffledbox shuffled={shuffled} />
                    </div>
                </div> 
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <Enabledbox checked={enabled} />
                </div> 
            </div>
            <div className="controls">
                <button className="button" onClick={handleOnShuffle}>Shuffle</button>
                <button className="button" onClick={handleOnClear}>Clear</button>
            </div>
            <div className="manage-attendees">
                <input type="file" name="importedAttendees" id="importedAttendees" accept=".json" onChange={handleImport} />
                <button className="button" onClick={handleOnImport}>Import</button>
                <button className="button" onClick={handleOnExport}>Export</button>
            </div>
        </div>
    );
};

export default PopupApp
