export type FilterTarget = { id: string; name: string };

type SessionDeps = {
    getGeneration(): number;
    /** Records the sat-down flag. Returns the current roster, or null when the generation is stale. */
    markSatDown(id: string, generation: number): Promise<FilterTarget[] | null>;
    applyFilter(target: FilterTarget, select: boolean, exclusiveNames: string[]): Promise<void>;
    delay(ms: number): Promise<void>;
    onActiveChanged(id: string): void;
};

const namesWith = (roster: FilterTarget[], extra?: FilterTarget | null) =>
    [...new Set([...roster.map(person => person.name), ...(extra ? [extra.name] : [])].filter(Boolean))];

// Attendee switches drive one shared Jira dropdown, so every filter operation runs on a single queue.
export function createStandupSession(deps: SessionDeps) {
    let queue: Promise<void> = Promise.resolve();
    let active: FilterTarget | null = null;
    let activeGeneration = -1;
    let pendingRemoval: FilterTarget | null = null;
    let lastRoster: FilterTarget[] = [];

    const isCurrent = (target: FilterTarget, generation: number) =>
        generation === deps.getGeneration() &&
        lastRoster.some(person => person.id === target.id && person.name === target.name);

    const commit = (target: FilterTarget | null, generation = -1) => {
        active = target;
        activeGeneration = target ? generation : -1;
        pendingRemoval = null;
        deps.onActiveChanged(target?.id ?? "");
    };

    const enqueue = (work: () => Promise<void>) => {
        queue = queue.then(work).catch(error => console.error(`Smartie Standup: attendee switch failed: ${error}`));
    };

    const switchTo = (person: FilterTarget) => {
        const generation = deps.getGeneration();
        enqueue(async () => {
            if (generation !== deps.getGeneration()) return;
            if (active?.id === person.id && activeGeneration === generation) return;
            const roster = await deps.markSatDown(person.id, generation);
            if (!roster || generation !== deps.getGeneration()) return;
            const current = roster.find(entry => entry.id === person.id);
            if (!current) return;
            lastRoster = roster;
            const previous = active;
            // Active from before an import: its filter is still applied, so only the new generation needs recording.
            if (previous && previous.id === current.id && previous.name === current.name) {
                commit(previous, generation);
                return;
            }
            const names = namesWith(roster, previous);
            if (previous) {
                await deps.applyFilter(previous, false, names);
                await deps.delay(150);
            }
            // The roster or generation can change while the Jira dropdown is being driven; never commit an obsolete target.
            if (!isCurrent(current, generation)) {
                commit(null);
                return;
            }
            await deps.applyFilter(current, true, namesWith(lastRoster, previous));
            await deps.delay(150);
            if (!isCurrent(current, generation)) {
                await deps.applyFilter(current, false, namesWith(lastRoster, current));
                await deps.delay(150);
                commit(null);
                return;
            }
            commit({ id: current.id, name: current.name }, generation);
        });
    };

    const rosterChanged = (roster: FilterTarget[]) => {
        lastRoster = roster;
        const stale = active;
        if (!stale || pendingRemoval === stale) return;
        if (roster.some(person => person.id === stale.id && person.name === stale.name)) return;
        pendingRemoval = stale;
        enqueue(async () => {
            if (active !== stale) return;
            await deps.applyFilter(stale, false, namesWith(lastRoster, stale));
            await deps.delay(150);
            commit(null);
        });
    };

    const reset = () => {
        active = null;
        pendingRemoval = null;
        deps.onActiveChanged("");
    };

    return { switchTo, rosterChanged, reset, activeTarget: () => active, idle: () => queue };
}
