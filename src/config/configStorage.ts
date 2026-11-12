import { Attendee, getTeams } from "../types";
import { ImportMode, mergeConfiguration, parseConfigurationImport, SmartieConfiguration } from "./attendeeConfig";

export const CONFIG_KEY = "smartieConfiguration";
export const BACKUP_KEY = "smartieConfigurationBackup";
export const RUNTIME_KEY = "smartieAttendeeRuntime";
export const RUNTIME_GENERATION_KEY = "smartieRuntimeGeneration";
export const ORDER_KEY = "smartieAttendeeOrder";
export const AVATAR_OVERRIDES_KEY = "smartieAvatarOverrides";
export interface ConfigStorage { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void>; }
export type RuntimeState = { satDown: boolean; hasLinger: boolean };
export type RuntimeMap = Record<string, Partial<RuntimeState>>;
export type AvatarUpdateMap = Record<string, { url: string; baseAvatar: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const validateStoredConfiguration = (value: unknown): SmartieConfiguration => {
    const result = parseConfigurationImport(JSON.stringify(value));
    if (!result.ok) throw new Error(`Saved Smartie configuration is invalid: ${result.errors.join(" ")}`);
    return result.configuration;
};

export async function loadConfiguration(storage: ConfigStorage): Promise<SmartieConfiguration> {
    const values = await storage.get([CONFIG_KEY, "attendees", "boardMappings"]);
    if (values[CONFIG_KEY] !== undefined) return validateStoredConfiguration(values[CONFIG_KEY]);
    const result = parseConfigurationImport(JSON.stringify({
        attendees: Array.isArray(values.attendees) ? values.attendees : [],
        boardMappings: values.boardMappings === undefined ? {} : values.boardMappings,
    }));
    if (!result.ok) throw new Error(`Saved attendee data is invalid: ${result.errors.join(" ")}`);
    return result.configuration;
}

export async function readRoster(storage: ConfigStorage): Promise<Attendee[]> {
    const values = await storage.get([CONFIG_KEY, "attendees", "boardMappings", RUNTIME_KEY, ORDER_KEY, AVATAR_OVERRIDES_KEY, RUNTIME_GENERATION_KEY]);
    const configuration = values[CONFIG_KEY] === undefined ? await loadConfiguration(storage) : validateStoredConfiguration(values[CONFIG_KEY]);
    const generation = typeof values[RUNTIME_GENERATION_KEY] === "number" ? values[RUNTIME_GENERATION_KEY] as number : 0;
    const storedRuntime = isRecord(values[RUNTIME_KEY]) ? values[RUNTIME_KEY] : {};
    const runtime: RuntimeMap = isRecord(storedRuntime.states)
        ? storedRuntime.generation === generation ? storedRuntime.states as RuntimeMap : {}
        : storedRuntime as RuntimeMap;
    const avatars: Record<string, unknown> = isRecord(values[AVATAR_OVERRIDES_KEY]) ? values[AVATAR_OVERRIDES_KEY] : {};
    const legacyById = new Map<string, Record<string, unknown>>();
    const useLegacyState = values[CONFIG_KEY] === undefined && values[RUNTIME_KEY] === undefined;
    if (Array.isArray(values.attendees)) values.attendees.forEach(value => {
        if (isRecord(value) && typeof value.id === "string") legacyById.set(value.id, value);
    });
    const roster = configuration.attendees.map(attendee => {
        const legacy = legacyById.get(attendee.id);
        const state = runtime[attendee.id] || {};
        const override = avatars[attendee.id] as { url?: string; baseAvatar?: string } | string | undefined;
        const avatar = typeof override === "string" ? override : override?.baseAvatar === (attendee.avatarUrl || "") ? override.url : undefined;
        return { ...attendee, avatarUrl: avatar || attendee.avatarUrl || "",
            satDown: state.satDown ?? (useLegacyState && legacy?.satDown === true), hasLinger: state.hasLinger ?? (useLegacyState && legacy?.hasLinger === true) };
    });
    if (!Array.isArray(values[ORDER_KEY])) return roster;
    const byId = new Map(roster.map(attendee => [attendee.id, attendee]));
    const ordered = (values[ORDER_KEY] as unknown[]).filter((id): id is string => typeof id === "string" && byId.has(id)).map(id => byId.get(id)!);
    const orderedIds = new Set(ordered.map(attendee => attendee.id));
    return ordered.concat(roster.filter(attendee => !orderedIds.has(attendee.id)));
}

export async function saveConfiguration(storage: ConfigStorage, configuration: SmartieConfiguration, resetStandupState = false): Promise<void> {
    const existing = await loadConfiguration(storage);
    const values = await storage.get([CONFIG_KEY, "attendees", RUNTIME_KEY, RUNTIME_GENERATION_KEY, "selectedTeam"]);
    const next = validateStoredConfiguration(configuration);
    const writes: Record<string, unknown> = { [CONFIG_KEY]: next, [BACKUP_KEY]: existing };
    if (resetStandupState) {
        const generation = typeof values[RUNTIME_GENERATION_KEY] === "number" ? values[RUNTIME_GENERATION_KEY] as number : 0;
        writes[RUNTIME_GENERATION_KEY] = generation + 1;
        writes[RUNTIME_KEY] = { generation: generation + 1, states: {} };
        writes[ORDER_KEY] = [];
        writes[AVATAR_OVERRIDES_KEY] = {};
    } else if (values[CONFIG_KEY] === undefined && values[RUNTIME_KEY] === undefined) {
        const legacyRuntime: RuntimeMap = {};
        if (Array.isArray(values.attendees)) values.attendees.forEach(value => {
            if (isRecord(value) && typeof value.id === "string") legacyRuntime[value.id] = { satDown: value.satDown === true, hasLinger: value.hasLinger === true };
        });
        if (Object.keys(legacyRuntime).length) writes[RUNTIME_KEY] = legacyRuntime;
    }
    const selectedTeam = typeof values.selectedTeam === "string" ? values.selectedTeam : "all";
    if (selectedTeam !== "all" && !next.attendees.some(attendee => getTeams(attendee as Attendee).includes(selectedTeam))) {
        writes.selectedTeam = "all";
    }
    await storage.set(writes);
}

export async function restorePreviousConfiguration(storage: ConfigStorage): Promise<boolean> {
    const values = await storage.get([CONFIG_KEY, BACKUP_KEY, "attendees", "boardMappings"]);
    if (values[BACKUP_KEY] === undefined) return false;
    const current = values[CONFIG_KEY] === undefined ? await loadConfiguration(storage) : validateStoredConfiguration(values[CONFIG_KEY]);
    const previous = validateStoredConfiguration(values[BACKUP_KEY]);
    await storage.set({ [CONFIG_KEY]: previous, [BACKUP_KEY]: current });
    return true;
}

export async function updateRuntime(storage: ConfigStorage, changes: RuntimeMap, order?: string[], avatarChanges?: AvatarUpdateMap, expectedGeneration?: number): Promise<boolean> {
    const currentRoster = await readRoster(storage);
    const ids = new Set(currentRoster.map(attendee => attendee.id));
    const [configuration, values] = await Promise.all([
        loadConfiguration(storage), storage.get([RUNTIME_KEY, RUNTIME_GENERATION_KEY, ORDER_KEY, AVATAR_OVERRIDES_KEY]),
    ]);
    const generation = typeof values[RUNTIME_GENERATION_KEY] === "number" ? values[RUNTIME_GENERATION_KEY] as number : 0;
    if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
    const storedRuntime = isRecord(values[RUNTIME_KEY]) ? values[RUNTIME_KEY] : {};
    const runtime: RuntimeMap = isRecord(storedRuntime.states)
        ? storedRuntime.generation === generation ? { ...storedRuntime.states as RuntimeMap } : {}
        : { ...storedRuntime as RuntimeMap };
    if (values[RUNTIME_KEY] === undefined && generation === 0) currentRoster.forEach(attendee => {
        runtime[attendee.id] = { satDown: attendee.satDown, hasLinger: attendee.hasLinger };
    });
    Object.entries(changes).forEach(([id, state]) => { if (ids.has(id)) runtime[id] = { ...(runtime[id] || {}), ...state }; });
    const previousOrder = Array.isArray(values[ORDER_KEY]) ? values[ORDER_KEY] as string[] : [];
    const nextOrder = (order || previousOrder).filter(id => ids.has(id));
    const avatars: Record<string, { url: string; baseAvatar: string }> = isRecord(values[AVATAR_OVERRIDES_KEY])
        ? { ...values[AVATAR_OVERRIDES_KEY] as Record<string, { url: string; baseAvatar: string }> } : {};
    const configById = new Map(configuration.attendees.map(attendee => [attendee.id, attendee]));
    Object.entries(avatarChanges || {}).forEach(([id, update]) => {
        const attendee = configById.get(id);
        if (ids.has(id) && attendee && update.baseAvatar === (attendee.avatarUrl || "")) avatars[id] = update;
    });
    await storage.set({ [RUNTIME_KEY]: { generation, states: runtime }, [ORDER_KEY]: nextOrder, [AVATAR_OVERRIDES_KEY]: avatars });
    return true;
}

export async function importConfiguration(storage: ConfigStorage, json: string, mode: ImportMode): Promise<
    { ok: true; preview: ReturnType<typeof mergeConfiguration> } | { ok: false; errors: string[] }
> {
    const parsed = parseConfigurationImport(json);
    if (!parsed.ok) return parsed;
    const existing = await loadConfiguration(storage);
    const preview = mergeConfiguration(existing, parsed.configuration, parsed.mappingsIncluded, mode);
    const { addedIds: _added, updatedIds: _updated, removedIds: _removed, mappingsIncluded: _included, ...configuration } = preview;
    await saveConfiguration(storage, configuration, true);
    return { ok: true, preview };
}

export function getConfigurationTeams(configuration: SmartieConfiguration): string[] {
    return [...new Set(configuration.attendees.flatMap(attendee => getTeams(attendee as Attendee)))].sort((a, b) => a.localeCompare(b));
}
