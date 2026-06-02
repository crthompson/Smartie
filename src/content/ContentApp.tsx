import React, { useEffect, useState } from "react";
import { Attendee, MessageTypes, isOnTeam, getTeams } from "../types";

const syncAvatarsFromDOM = async () => {
    const attendeesResult = await chrome.storage.local.get("attendees");
    const storedAttendees: Attendee[] = attendeesResult.attendees;
    if (!storedAttendees || storedAttendees.length === 0) return;

    let updated = false;
    const avatarMap = new Map<string, string>();

    // Scrape visible filter bar avatars
    document.querySelectorAll('label[data-testid="filters.ui.filters.assignee.stateless.avatar.assignee-filter-avatar"]').forEach(label => {
        const forAttr = label.getAttribute('for');
        if (forAttr && forAttr.startsWith('assignee-')) {
            const accountId = forAttr.replace('assignee-', '');
            const img = label.querySelector('img') as HTMLImageElement;
            if (img && img.src) {
                avatarMap.set(accountId, img.src);
            }
        }
    });

    // Update stored attendees with fresh avatar URLs
    const updatedAttendees = storedAttendees.map(a => {
        const freshUrl = avatarMap.get(a.id);
        if (freshUrl && freshUrl !== a.avatarUrl) {
            updated = true;
            return { ...a, avatarUrl: freshUrl };
        }
        return a;
    });

    if (updated) {
        await chrome.storage.local.set({ attendees: updatedAttendees });
    }
};

const ContentApp = () => {
    const [hidden, setHidden] = useState(true);
    const [shuffling, setShuffling] = useState<boolean>(false);
    const [attendees, setAttendees] = useState<Attendee[]>([]);
    const [activeAttendeeId, setActiveAttendeeId] = useState<string>('');
    const [selectedTeam, setSelectedTeam] = useState<string>("none");

    const clickAttendee = (attendeeId: string) => {
        if (!attendeeId) return;
        const label = document.querySelector(`label[for="assignee-${attendeeId}"]`) as HTMLElement;
        if (label) {
            label.click();
        } else {
            const showMore = document.querySelector('[data-testid="filters.ui.filters.assignee.stateless.show-more-button.assignee-filter-show-more"]') as HTMLElement;
            if (showMore) {
                showMore.click();
                const observer = new MutationObserver(() => {
                    const item = document.getElementById(attendeeId) as HTMLElement;
                    if (item) {
                        observer.disconnect();
                        item.click();
                        showMore.click();
                    } else if (document.querySelector('[role="menuitemcheckbox"]')) {
                        // Dropdown rendered but attendee not in it — close menu
                        observer.disconnect();
                        showMore.click();
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => observer.disconnect(), 3000);
            }
        }
    };

    const onAttendeeClick = (attendee: Attendee) => {
        const newAttendeeId = attendee.id;
        if (activeAttendeeId === newAttendeeId) {
            return;
        }

        const temp = attendees.map(a => {
            if (a.id === newAttendeeId) {
                a.satDown = true;
            }
            return a;
        });

        storeAttendees(temp);
        clickAttendee(activeAttendeeId);
        clickAttendee(newAttendeeId);
        setActiveAttendeeId(newAttendeeId);
    };

    const onAttendeeRightClick = (e: React.MouseEvent, attendee: Attendee) => {
        e.preventDefault();
        const temp = attendees.map(a => {
            if (a.id === attendee.id) {
                a.hasLinger = !a.hasLinger;
            }
            return a;
        });

        storeAttendees(temp);
    };

    const shuffleAttendees = async (_ignored?: Attendee[]) => {
        setShuffling(true);
        // Always operate on the FULL list from storage, never the filtered in-memory view
        const full = await chrome.storage.local.get("attendees");
        const fullList: Attendee[] = full.attendees || [];
        setTimeout(async () => {
            const temp = fullList.filter(a => !a.excludeFromShuffle).slice();
            for (let i = temp.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [temp[i], temp[j]] = [temp[j], temp[i]];
            }
            await storeAttendees(temp.concat(fullList.filter(a => a.excludeFromShuffle)));
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setShuffling(false);
                });
            });
        }, 175);
    };

    const storeAttendees = async (fullAttendees: Attendee[]) => {
        const selectedTeam = await chrome.storage.local.get("selectedTeam");
        const teamValue = selectedTeam.selectedTeam || "all";
        const filteredAttendees = fullAttendees
            ?.filter((a: Attendee) => isOnTeam(a, teamValue)) || [];
        setAttendees(filteredAttendees);
        await chrome.storage.local.set({ attendees: fullAttendees });
    };

    const clear = async (_ignored?: Attendee[]) => {
        // Always operate on the FULL list from storage
        const full = await chrome.storage.local.get("attendees");
        const fullList: Attendee[] = full.attendees || [];
        const temp = fullList.map(a => ({
            ...a,
            satDown: false,
            hasLinger: false
        }));
        
        await storeAttendees(temp);        
        document.querySelector<HTMLElement>('[data-testid="filters.ui.filters.clear-button.ak-button"] button')?.click();
        setActiveAttendeeId('');
    };

    const attendeesMarkup = attendees.map(a => {
        const hasSatDown = a.satDown ? "satDown" : "";
        const hasLinger = a.hasLinger ? "hasLinger" : "";

        return (
            <li key={a.id} className={`${hasSatDown} ${hasLinger}`} onClick={() => onAttendeeClick(a)} onContextMenu={(e) => onAttendeeRightClick(e, a)}>
                <img src={a.avatarUrl} className="avatar" />
                <span className="name">{a.name}</span>
            </li>
        );
    });

    useEffect(() => {
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
            if (changes.enabled) {
                setHidden(!changes.enabled.newValue);
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => {
            chrome.storage.onChanged.removeListener(listener);
        };
    }, []);

    useEffect(() => {
        const listener = async (message: MessageTypes) => {
            const attendeesResult = await chrome.storage.local.get("attendees");
            switch (message.type) {
                case "CLEAR":
                    await clear();
                    break;
                case "SHUFFLE":
                    await shuffleAttendees();
                    break;
                case "ATTENDEES_UPDATED":
                    setAttendees(attendeesResult.attendees || []);
                    break;
                case "TEAM_CHANGED":
                    const selectedTeam = await chrome.storage.local.get("selectedTeam");
                    const teamVal = selectedTeam.selectedTeam || "all";
                    setSelectedTeam(teamVal);
                    const filteredByTeam = attendeesResult.attendees
                        ?.filter((a: Attendee) => isOnTeam(a, teamVal)) || [];
                    setAttendees(filteredByTeam);
                    break;
                default:
                    break;
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => {
            chrome.runtime.onMessage.removeListener(listener);
        };
    }, []);

    useEffect(() => {
        (async () => {
            const enabledResult = await chrome.storage.local.get("enabled");
            const shuffledResult = await chrome.storage.local.get("shuffled");
            const clearedResult = await chrome.storage.local.get("cleared");
            const selectedTeamResult = await chrome.storage.local.get("selectedTeam");
            const boardMappingsResult = await chrome.storage.local.get("boardMappings");

            // Auto-select team based on current board URL
            let initTeam = selectedTeamResult.selectedTeam || "all";
            const currentUrl = window.location.href;
            if (boardMappingsResult.boardMappings) {
                let matched = false;
                for (const [team, boardPath] of Object.entries(boardMappingsResult.boardMappings)) {
                    if (currentUrl.includes(boardPath as string)) {
                        initTeam = team;
                        await chrome.storage.local.set({ selectedTeam: team });
                        matched = true;
                        break;
                    }
                }
                // If we previously auto-selected a team but this board doesn't map,
                // reset to "all" so a stale selectedTeam doesn't silently filter everyone out.
                if (!matched && initTeam !== "all" && initTeam in boardMappingsResult.boardMappings) {
                    initTeam = "all";
                    await chrome.storage.local.set({ selectedTeam: "all" });
                }
            }
             
            setHidden(!enabledResult.enabled);

            const attendeesResult = await chrome.storage.local.get("attendees");
            let storageAttendees = attendeesResult.attendees;
            if (!storageAttendees) {
                // Load bundled defaults
                try {
                    const defaultsUrl = chrome.runtime.getURL("defaults.json");
                    const resp = await fetch(defaultsUrl);
                    const defaults = await resp.json();
                    storageAttendees = defaults.attendees || [];
                    await chrome.storage.local.set({ attendees: storageAttendees });
                    // Persist teams so the popup dropdown has options on first install
                    const seededTeams: string[] = [...new Set(
                        (storageAttendees as Attendee[])
                            .flatMap((a: Attendee) => getTeams(a))
                            .filter((t: string) => t !== "")
                    )];
                    await chrome.storage.local.set({ teams: seededTeams });
                    if (defaults.boardMappings) {
                        await chrome.storage.local.set({ boardMappings: defaults.boardMappings });
                        // Re-check board mapping with loaded data
                        for (const [team, boardPath] of Object.entries(defaults.boardMappings)) {
                            if (currentUrl.includes(boardPath as string)) {
                                initTeam = team;
                                await chrome.storage.local.set({ selectedTeam: team });
                                break;
                            }
                        }
                    }
                    // Render the seeded list immediately so the panel isn't blank
                    const seededFiltered = (storageAttendees as Attendee[])
                        .filter((a: Attendee) => isOnTeam(a, initTeam));
                    setAttendees(seededFiltered);
                } catch (e) {
                    storageAttendees = [{
                        id: "unassigned",
                        name: "Unassigned",
                        avatarUrl: "https://via.placeholder.com/48x48",
                        satDown: false,
                        hasLinger: false,
                        excludeFromShuffle: false,
                        team: ""
                    }];
                    await storeAttendees(storageAttendees);
                }
            } else {
                const filteredAttendees = attendeesResult.attendees
                    ?.filter((a: Attendee) => isOnTeam(a, initTeam)) || [];
                setAttendees(filteredAttendees);   
                setTimeout(async () => {
                    let temp = storageAttendees.map((a: Attendee): Attendee => ({
                            ...a,
                            satDown: clearedResult.cleared ? false : a.satDown,
                            hasLinger: false
                        }));
                    if (shuffledResult.shuffled) {
                        await shuffleAttendees();
                    }
                    if (clearedResult.cleared) {
                        setTimeout(() => {
                            document.querySelector<HTMLElement>('[data-testid="filters.ui.filters.clear-button.ak-button"] button')?.click();
                        }, 100);
                    }
                    setAttendees(filteredAttendees);   
                    setActiveAttendeeId('');
                }, 175);
            }

            // Sync avatars from the board DOM after a delay to let Jira render
            setTimeout(async () => {
                await syncAvatarsFromDOM();
                const refreshed = await chrome.storage.local.get("attendees");
                if (refreshed.attendees) {
                    const filteredRefreshed = refreshed.attendees
                        ?.filter((a: Attendee) => isOnTeam(a, initTeam)) || [];
                    setAttendees(filteredRefreshed);
                }
            }, 2000);
        })();
    }, []);
    
    return (
        <div className={hidden ? "container hidden" : "container"}>
            <ul className={shuffling ? "group shuffling" : "group"}>{attendeesMarkup}</ul>
        </div>
    );
};

export default ContentApp
