import React, { useEffect, useRef, useState } from "react";
import { Attendee, MessageTypes, isOnTeam } from "../types";
import { AvatarUpdateMap, readRoster, updateRuntime } from "../config/configStorage";
import { loadConfiguration, getConfigurationTeams } from "../config/configStorage";
import { clickQuickFilter } from "./clickQuickFilter";
import { createStandupSession, FilterTarget } from "./standupSession";
import AttendeeAvatar from "../components/AttendeeAvatar";

const clickClearFilters = () => {
    const legacy = document.querySelector<HTMLElement>('[data-testid="filters.ui.filters.clear-button.ak-button"] button');
    const byLabel = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent?.trim() === "Clear filters" && !button.closest("#jira-standup"));
    (legacy ?? byLabel)?.click();
};

const unassignedAttendee: Attendee = {
    id: "unassigned", name: "Unassigned", avatarUrl: "", satDown: false, hasLinger: false, excludeFromShuffle: false, team: "",
};

const ContentApp = () => {
    const [hidden, setHidden] = useState(true);
    const [shuffling, setShuffling] = useState(false);
    const [attendees, setAttendees] = useState<Attendee[]>([]);
    const [activeAttendeeId, setActiveAttendeeId] = useState("");
    const [selectedTeam, setSelectedTeam] = useState("all");
    const runtimeGenerationRef = useRef(0);
    const sessionRef = useRef<ReturnType<typeof createStandupSession> | null>(null);

    const refreshFromStorage = async () => {
        const [roster, configuration, selectedResult, enabledResult, generationResult] = await Promise.all([
            readRoster(chrome.storage.local), loadConfiguration(chrome.storage.local),
            chrome.storage.local.get("selectedTeam"), chrome.storage.local.get("enabled"), chrome.storage.local.get("smartieRuntimeGeneration"),
        ]);
        const generation = typeof generationResult.smartieRuntimeGeneration === "number" ? generationResult.smartieRuntimeGeneration : 0;
        if (generation >= runtimeGenerationRef.current) runtimeGenerationRef.current = generation;
        const storedTeam = selectedResult.selectedTeam || "all";
        const team = storedTeam === "all" || getConfigurationTeams(configuration).includes(storedTeam) ? storedTeam : "all";
        if (team !== storedTeam) await chrome.storage.local.set({ selectedTeam: team });
        setSelectedTeam(team);
        setHidden(!enabledResult.enabled);
        const visible = roster.filter(attendee => isOnTeam(attendee, team));
        setAttendees(visible.length || roster.length ? visible : [unassignedAttendee]);
        sessionRef.current?.rosterChanged(roster);
        return { roster, team };
    };

    const clickAttendee = async (target: FilterTarget, select: boolean, exclusiveNames: string[]) => {
        const attendeeId = target.id;
        if (!attendeeId) return;
        if (target.name) {
            const matched = await clickQuickFilter(target.name, { select, exclusiveAmong: exclusiveNames });
            if (matched) return;
        }
        const label = document.querySelector(`label[for="assignee-${attendeeId}"]`) as HTMLElement | null;
        if (label) {
            label.click();
            return;
        }
        const showMore = document.querySelector('[data-testid="filters.ui.filters.assignee.stateless.show-more-button.assignee-filter-show-more"]') as HTMLElement | null;
        if (!showMore) return;
        showMore.click();
        const observer = new MutationObserver(() => {
            const item = document.getElementById(attendeeId) as HTMLElement | null;
            if (item) {
                observer.disconnect();
                item.click();
                showMore.click();
            } else if (document.querySelector('[role="menuitemcheckbox"]')) {
                observer.disconnect();
                showMore.click();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 3000);
    };

    if (!sessionRef.current) {
        sessionRef.current = createStandupSession({
            getGeneration: () => runtimeGenerationRef.current,
            markSatDown: async (id, generation) => {
                const applied = await updateRuntime(chrome.storage.local, { [id]: { satDown: true } }, undefined, undefined, generation);
                if (!applied) return null;
                const { roster } = await refreshFromStorage();
                return roster;
            },
            applyFilter: clickAttendee,
            delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
            onActiveChanged: setActiveAttendeeId,
        });
    }

    const onAttendeeClick = (attendee: Attendee) => sessionRef.current?.switchTo(attendee);

    const onAttendeeRightClick = async (event: React.MouseEvent, attendee: Attendee) => {
        event.preventDefault();
        const generation = runtimeGenerationRef.current;
        await updateRuntime(chrome.storage.local, { [attendee.id]: { hasLinger: !attendee.hasLinger } }, undefined, undefined, generation);
        await refreshFromStorage();
    };

    const shuffleAttendees = async () => {
        setShuffling(true);
        const generation = runtimeGenerationRef.current;
        const roster = await readRoster(chrome.storage.local);
        setTimeout(async () => {
            const movable = roster.filter(attendee => !attendee.excludeFromShuffle).slice();
            for (let index = movable.length - 1; index > 0; index--) {
                const next = Math.floor(Math.random() * (index + 1));
                [movable[index], movable[next]] = [movable[next], movable[index]];
            }
            const order = movable.concat(roster.filter(attendee => attendee.excludeFromShuffle)).map(attendee => attendee.id);
            await updateRuntime(chrome.storage.local, {}, order, undefined, generation);
            await refreshFromStorage();
            requestAnimationFrame(() => requestAnimationFrame(() => setShuffling(false)));
        }, 175);
    };

    const clear = async () => {
        const generation = runtimeGenerationRef.current;
        const roster = await readRoster(chrome.storage.local);
        const reset = Object.fromEntries(roster.map(attendee => [attendee.id, { satDown: false, hasLinger: false }]));
        await updateRuntime(chrome.storage.local, reset, undefined, undefined, generation);
        await refreshFromStorage();
        clickClearFilters();
                sessionRef.current?.reset();
    };

    const syncAvatarsFromDOM = async () => {
        const configuration = await loadConfiguration(chrome.storage.local);
        const attendeesById = new Map(configuration.attendees.map(attendee => [attendee.id, attendee]));
        const avatarMap: AvatarUpdateMap = {};
        document.querySelectorAll('label[data-testid="filters.ui.filters.assignee.stateless.avatar.assignee-filter-avatar"]').forEach(label => {
            const forValue = label.getAttribute("for");
            const image = label.querySelector("img") as HTMLImageElement | null;
            if (forValue?.startsWith("assignee-") && image?.src) {
                const id = forValue.slice("assignee-".length);
                const attendee = attendeesById.get(id);
                if (attendee) avatarMap[id] = { url: image.src, baseAvatar: attendee.avatarUrl || "" };
            }
        });
        if (Object.keys(avatarMap).length) {
            await updateRuntime(chrome.storage.local, {}, undefined, avatarMap, runtimeGenerationRef.current);
            await refreshFromStorage();
        }
    };

    useEffect(() => {
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.enabled) setHidden(!changes.enabled.newValue);
            if (changes.smartieConfiguration || changes.attendees || changes.boardMappings || changes.selectedTeam ||
                changes.smartieAttendeeRuntime || changes.smartieAttendeeOrder || changes.smartieAvatarOverrides) {
                void refreshFromStorage().catch(error => console.error("Smartie Standup: roster refresh failed", error));
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
    }, []);

    useEffect(() => {
        const listener = (message: MessageTypes) => {
            if (message.type === "CLEAR") void clear();
            else if (message.type === "SHUFFLE") void shuffleAttendees();
            else if (message.type === "TEAM_CHANGED" || message.type === "ATTENDEES_UPDATED") void refreshFromStorage();
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            const [configuration, selectedResult, enabledResult, shuffledResult, clearedResult] = await Promise.all([
                loadConfiguration(chrome.storage.local), chrome.storage.local.get("selectedTeam"),
                chrome.storage.local.get("enabled"), chrome.storage.local.get("shuffled"), chrome.storage.local.get("cleared"),
            ]);
            let initialTeam = selectedResult.selectedTeam || "all";
            let matched = false;
            for (const [team, boardPath] of Object.entries(configuration.boardMappings)) {
                if (window.location.href.includes(boardPath)) {
                    initialTeam = team;
                    matched = true;
                    break;
                }
            }
            if (!matched && initialTeam !== "all" && Object.prototype.hasOwnProperty.call(configuration.boardMappings, initialTeam)) initialTeam = "all";
            if (initialTeam !== selectedResult.selectedTeam) await chrome.storage.local.set({ selectedTeam: initialTeam });
            if (alive) await refreshFromStorage();
            if (clearedResult.cleared) {
                const roster = await readRoster(chrome.storage.local);
                await updateRuntime(chrome.storage.local, Object.fromEntries(roster.map(person => [person.id, { satDown: false, hasLinger: false }])), undefined, undefined, runtimeGenerationRef.current);
                clickClearFilters();
            }
            if (shuffledResult.shuffled) await shuffleAttendees();
                        sessionRef.current?.reset();
            setTimeout(() => { if (alive) void syncAvatarsFromDOM(); }, 2000);
        })().catch(error => console.error("Smartie Standup: initialization failed", error));
        return () => { alive = false; };
    }, []);

    const attendeeMarkup = attendees.map(attendee => (
        <li key={attendee.id} className={`${attendee.satDown ? "satDown" : ""} ${attendee.hasLinger ? "hasLinger" : ""} ${activeAttendeeId === attendee.id ? "active" : ""}`}
            onClick={() => onAttendeeClick(attendee)} onContextMenu={event => void onAttendeeRightClick(event, attendee)}>
            <AttendeeAvatar name={attendee.name} url={attendee.avatarUrl} className="avatar" />
            <span className="name">{attendee.name}</span>
        </li>
    ));

    return <div className={hidden ? "container hidden" : "container"} data-selected-team={selectedTeam}>
        <ul className={shuffling ? "group shuffling" : "group"}>{attendeeMarkup}</ul>
    </div>;
};

export default ContentApp;
