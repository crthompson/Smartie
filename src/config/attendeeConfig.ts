import { Attendee } from "../types";

export type AttendeeConfig = Pick<Attendee, "id" | "name" | "avatarUrl" | "excludeFromShuffle" | "team">;
export type SmartieConfiguration = { version: 1; attendees: AttendeeConfig[]; boardMappings: Record<string, string> };
export type ImportMode = "merge" | "replace";
export type ImportResult =
    | { ok: true; configuration: SmartieConfiguration; mappingsIncluded: boolean }
    | { ok: false; errors: string[] };
export type ConfigurationPreview = SmartieConfiguration & {
    addedIds: string[]; updatedIds: string[]; removedIds: string[]; mappingsIncluded: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const validateAttendees = (value: unknown, errors: string[]): AttendeeConfig[] => {
    if (!Array.isArray(value)) {
        errors.push("Attendees must be an array.");
        return [];
    }
    const attendees: AttendeeConfig[] = [];
    const ids = new Set<string>();
    value.forEach((item, index) => {
        const label = `Attendee ${index + 1}`;
        if (!isRecord(item)) { errors.push(`${label} must be an object.`); return; }
        const allowedFields = ["id", "name", "avatarUrl", "excludeFromShuffle", "team", "satDown", "hasLinger"];
        const unknownFields = Object.keys(item).filter(field => !allowedFields.includes(field));
        if (unknownFields.length) { errors.push(`${label} contains unsupported field(s): ${unknownFields.join(", ")}.`); return; }
        if (typeof item.satDown !== "undefined" && typeof item.satDown !== "boolean") { errors.push(`${label} sat-down state must be true or false.`); return; }
        if (typeof item.hasLinger !== "undefined" && typeof item.hasLinger !== "boolean") { errors.push(`${label} linger state must be true or false.`); return; }
        if (typeof item.id !== "string" || !item.id.trim()) { errors.push(`${label} needs a Jira account ID.`); return; }
        const id = item.id.trim();
        if (ids.has(id)) { errors.push(`${label} duplicates Jira account ID "${id}".`); return; }
        if (typeof item.name !== "string" || !item.name.trim()) { errors.push(`${label} needs a name.`); return; }
        if (item.avatarUrl !== undefined && typeof item.avatarUrl !== "string") { errors.push(`${label} avatar URL must be text when supplied.`); return; }
        if (item.excludeFromShuffle !== undefined && typeof item.excludeFromShuffle !== "boolean") { errors.push(`${label} exclude-from-shuffle value must be true or false.`); return; }
        let team: string | string[] | undefined;
        if (typeof item.team === "string") team = item.team.trim();
        else if (Array.isArray(item.team)) {
            if (!item.team.every(name => typeof name === "string" && !!name.trim())) { errors.push(`${label} team memberships must be non-empty text values.`); return; }
            team = [...new Set((item.team as string[]).map(name => name.trim()))];
        } else if (item.team !== undefined) { errors.push(`${label} team membership must be text or an array of text values.`); return; }
        ids.add(id);
        attendees.push({ id, name: item.name.trim(), avatarUrl: (item.avatarUrl as string | undefined)?.trim() || "",
            excludeFromShuffle: item.excludeFromShuffle === true, ...(team === undefined ? {} : { team }) });
    });
    return attendees;
};

const validateMappings = (value: unknown, errors: string[]): Record<string, string> => {
    if (!isRecord(value)) { errors.push("Board mappings must be an object of team names and board paths."); return {}; }
    const mappings: Record<string, string> = {};
    Object.entries(value).forEach(([team, boardPath]) => {
        if (!team.trim() || typeof boardPath !== "string" || !boardPath.trim()) {
            errors.push(`Board mapping for "${team}" needs a team name and board path.`); return;
        }
        const normalizedTeam = team.trim();
        if (Object.prototype.hasOwnProperty.call(mappings, normalizedTeam)) {
            errors.push(`Board mapping for "${normalizedTeam}" appears more than once.`);
            return;
        }
        mappings[normalizedTeam] = boardPath.trim();
    });
    return mappings;
};

export function parseConfigurationImport(json: string): ImportResult {
    let parsed: unknown;
    try { parsed = JSON.parse(json); }
    catch (error) { return { ok: false, errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`] }; }
    const errors: string[] = [];
    let attendeesValue: unknown;
    let mappingsValue: unknown = {};
    let mappingsIncluded = false;
    if (Array.isArray(parsed)) attendeesValue = parsed;
    else if (isRecord(parsed)) {
        const unknownFields = Object.keys(parsed).filter(field => !["version", "attendees", "boardMappings"].includes(field));
        if (unknownFields.length) errors.push(`Configuration contains unsupported field(s): ${unknownFields.join(", ")}.`);
        if ("version" in parsed && parsed.version !== 1) errors.push(`Unsupported configuration version: ${String(parsed.version)}.`);
        if (parsed.version === 1 && !Object.prototype.hasOwnProperty.call(parsed, "boardMappings")) errors.push("Version 1 configuration must contain board mappings.");
        if (!Array.isArray(parsed.attendees)) errors.push("Configuration must contain an attendees array.");
        attendeesValue = parsed.attendees;
        mappingsIncluded = Object.prototype.hasOwnProperty.call(parsed, "boardMappings");
        if (mappingsIncluded) mappingsValue = parsed.boardMappings;
    } else return { ok: false, errors: ["Import must be an attendee array or a configuration object."] };
    const attendees = validateAttendees(attendeesValue, errors);
    const boardMappings = validateMappings(mappingsValue, errors);
    if (errors.length) return { ok: false, errors };
    return { ok: true, configuration: { version: 1, attendees, boardMappings }, mappingsIncluded };
}

export function mergeConfiguration(existing: SmartieConfiguration, incoming: SmartieConfiguration,
    mappingsIncluded: boolean, mode: ImportMode): ConfigurationPreview {
    const existingById = new Map(existing.attendees.map(attendee => [attendee.id, attendee]));
    const incomingIds = new Set(incoming.attendees.map(attendee => attendee.id));
    const incomingById = new Map(incoming.attendees.map(attendee => [attendee.id, attendee]));
    const attendees = mode === "replace" ? incoming.attendees.map(attendee => ({ ...attendee })) : [
        ...existing.attendees.map(attendee => ({ ...(incomingById.get(attendee.id) || attendee) })),
        ...incoming.attendees.filter(attendee => !existingById.has(attendee.id)).map(attendee => ({ ...attendee })),
    ];
    const addedIds = incoming.attendees.filter(attendee => !existingById.has(attendee.id)).map(attendee => attendee.id);
    const updatedIds = incoming.attendees.filter(attendee => existingById.has(attendee.id)).map(attendee => attendee.id);
    const removedIds = mode === "replace" ? existing.attendees.filter(attendee => !incomingIds.has(attendee.id)).map(attendee => attendee.id) : [];
    const boardMappings = mode === "merge" ? { ...existing.boardMappings, ...incoming.boardMappings } : { ...incoming.boardMappings };
    return { version: 1, attendees, boardMappings, addedIds, updatedIds, removedIds, mappingsIncluded };
}

export function serializeConfiguration(configuration: SmartieConfiguration): string {
    return JSON.stringify({
        version: 1,
        attendees: configuration.attendees.map(({ id, name, avatarUrl, excludeFromShuffle, team }) => ({
            id, name, avatarUrl: avatarUrl || "", excludeFromShuffle: !!excludeFromShuffle, ...(team === undefined ? {} : { team }),
        })),
        boardMappings: { ...configuration.boardMappings },
    }, null, 2);
}
