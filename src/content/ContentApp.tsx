import React, { useEffect, useState } from "react";
import { Attendee, MessageTypes } from "../types";

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

    const shuffleAttendees = (attendeesToShuffle: Attendee[]) => {
        setShuffling(true);
        setTimeout(() => {
            const temp = attendeesToShuffle.filter(a => !a.excludeFromShuffle).slice();
            for (let i = temp.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [temp[i], temp[j]] = [temp[j], temp[i]];
            }
            storeAttendees(temp.concat(attendeesToShuffle.filter(a => a.excludeFromShuffle)));
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setShuffling(false);
                });
            });
        }, 175);
    };

    const storeAttendees = async (attendeesToStore: Attendee[]) => {
        const selectedTeam = await chrome.storage.local.get("selectedTeam");
        const teamValue = selectedTeam.selectedTeam || "all";
        const filteredAttendees = attendeesToStore
            ?.filter((a: Attendee) => a.team === teamValue 
                                    || teamValue.toLowerCase() === "all") || [];
        setAttendees(filteredAttendees);
        await chrome.storage.local.set({ attendees: attendeesToStore });
    };

    const clear = async (attendeesToClear: Attendee[]) => {
        const temp = attendeesToClear.map(a => ({
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
                    await clear(attendees);
                    break;
                case "SHUFFLE":
                    shuffleAttendees(attendees);
                    break;
                case "ATTENDEES_UPDATED":
                    setAttendees(attendeesResult.attendees || []);
                    break;
                case "TEAM_CHANGED":
                    const selectedTeam = await chrome.storage.local.get("selectedTeam");
                    const teamVal = selectedTeam.selectedTeam || "all";
                    setSelectedTeam(teamVal);
                    const filteredByTeam = attendeesResult.attendees
                        ?.filter((a: Attendee) => a.team === teamVal 
                                                || teamVal.toLowerCase() === "all") || [];
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
    }, [attendees]);

    useEffect(() => {
        (async () => {
            const enabledResult = await chrome.storage.local.get("enabled");
            const shuffledResult = await chrome.storage.local.get("shuffled");
            const clearedResult = await chrome.storage.local.get("cleared");
            const selectedTeamResult = await chrome.storage.local.get("selectedTeam");
            const initTeam = selectedTeamResult.selectedTeam || "all";
             
            setHidden(!enabledResult.enabled);

            const attendeesResult = await chrome.storage.local.get("attendees");
            let storageAttendees = attendeesResult.attendees;
            if (!storageAttendees) {
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
            } else {
                const filteredAttendees = attendeesResult.attendees
                    ?.filter((a: Attendee) => a.team === initTeam
                                            || initTeam.toLowerCase() === "all") || [];
                setAttendees(filteredAttendees);   
                setTimeout(async () => {
                    let temp = storageAttendees.map((a: Attendee): Attendee => ({
                            ...a,
                            satDown: clearedResult.cleared ? false : a.satDown,
                            hasLinger: false
                        }));
                    if (shuffledResult.shuffled) {
                        shuffleAttendees(temp);
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
        })();
    }, []);
    
    return (
        <div className={hidden ? "container hidden" : "container"}>
            <ul className={shuffling ? "group shuffling" : "group"}>{attendeesMarkup}</ul>
        </div>
    );
};

export default ContentApp
