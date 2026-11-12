const assert = require('node:assert/strict');
const { isOnTeam } = require('./.build/types.js');
const {
    parseConfigurationImport,
    mergeConfiguration,
    serializeConfiguration,
} = require('./.build/config/attendeeConfig.js');
const {
    CONFIG_KEY,
    BACKUP_KEY,
    RUNTIME_KEY,
    RUNTIME_GENERATION_KEY,
    importConfiguration,
    loadConfiguration,
    readRoster,
    restorePreviousConfiguration,
    saveConfiguration,
    updateRuntime,
} = require('./.build/config/configStorage.js');

const attendee = (id, name, team = 'Alpha', extra = {}) => ({
    id,
    name,
    avatarUrl: '',
    excludeFromShuffle: false,
    team,
    ...extra,
});
const config = (attendees, boardMappings = {}) => ({ version: 1, attendees, boardMappings });

class MemoryStorage {
    constructor(data = {}) { this.data = structuredClone(data); this.writes = 0; }
    async get(keys) {
        return Object.fromEntries(keys.filter(key => key in this.data).map(key => [key, structuredClone(this.data[key])]));
    }
    async set(items) {
        this.writes++;
        Object.assign(this.data, structuredClone(items));
    }
}

async function run() {
    let result = parseConfigurationImport(JSON.stringify([attendee('1', 'Alice')]));
    assert.equal(result.ok, true, 'accepts the legacy attendee array');
    assert.deepEqual(result.configuration.boardMappings, {});
    result = parseConfigurationImport(JSON.stringify({ attendees: [attendee('1', 'Alice')], boardMappings: { Alpha: '/jira/software/c/projects/A/boards/1' } }));
    assert.equal(result.ok, true, 'accepts the legacy object with mappings');
    result = parseConfigurationImport(JSON.stringify(config([attendee('1', 'Alice')])));
    assert.equal(result.ok, true, 'accepts the versioned envelope');

    assert.equal(parseConfigurationImport(JSON.stringify({ version: 2, attendees: [] })).ok, false, 'rejects unsupported versions');
    assert.equal(parseConfigurationImport(JSON.stringify([attendee('1', 'Alice'), attendee('1', 'Duplicate')])).ok, false, 'rejects duplicate exact Jira account IDs');
    assert.equal(parseConfigurationImport(JSON.stringify([{ id: '1', name: 'Alice', team: 5 }])).ok, false, 'rejects malformed optional fields');
    assert.equal(parseConfigurationImport(JSON.stringify([{ id: '1', name: 'Alice', unsupported: 'value' }])).ok, false, 'rejects unsupported attendee fields');
    assert.equal(parseConfigurationImport(JSON.stringify({ version: 1, attendees: [] })).ok, false, 'requires mappings in versioned envelopes');
    assert.equal(parseConfigurationImport(JSON.stringify({ attendees: [attendee('1', 'Alice')], boardMappings: { Alpha: '' } })).ok, false, 'rejects invalid mappings');
    assert.equal(parseConfigurationImport(JSON.stringify({ attendees: [], boardMappings: { Alpha: '/a', ' Alpha ': '/b' } })).ok, false, 'rejects duplicate normalized mapping names');

    const existing = config([attendee('1', 'Old name'), attendee('2', 'Keep')], { Alpha: '/board/alpha', Beta: '/board/beta' });
    const incoming = config([attendee('1', 'Updated'), attendee('3', 'Added')]);
    const merged = mergeConfiguration(existing, incoming, false, 'merge');
    assert.deepEqual(merged.attendees.map(a => a.id), ['1', '2', '3'], 'merge updates matching IDs and retains existing-only attendees');
    assert.equal(merged.attendees[0].name, 'Updated');
    assert.deepEqual(merged.boardMappings, existing.boardMappings, 'merge retains mappings when the file omits them');
    assert.deepEqual(merged.removedIds, [], 'merge reports no removed IDs');
    const replaced = mergeConfiguration(existing, incoming, false, 'replace');
    assert.deepEqual(replaced.attendees.map(a => a.id), ['1', '3'], 'replace drops existing-only attendees');
    assert.deepEqual(replaced.removedIds, ['2']);
    assert.deepEqual(replaced.boardMappings, {}, 'replace clears omitted mappings');
    const mapped = mergeConfiguration(existing, config([attendee('4', 'New')], { Gamma: '/board/gamma' }), true, 'replace');
    assert.deepEqual(mapped.boardMappings, { Gamma: '/board/gamma' }, 'replace imports drop unrelated mappings');
    const mergedMappings = mergeConfiguration(existing, config([], { Alpha: '/board/new-alpha', Gamma: '/board/gamma' }), true, 'merge');
    assert.deepEqual(mergedMappings.boardMappings, { Alpha: '/board/new-alpha', Beta: '/board/beta', Gamma: '/board/gamma' }, 'merge imports override same-team mappings and keep the rest');

    const serialized = serializeConfiguration(config([attendee('1', 'Alice', ['Alpha', 'Beta'], { satDown: true, hasLinger: true })], { Alpha: '/board/alpha' }));
    const portable = JSON.parse(serialized);
    assert.deepEqual(Object.keys(portable).sort(), ['attendees', 'boardMappings', 'version']);
    assert.equal('satDown' in portable.attendees[0], false, 'exports omit transient standup flags');
    assert.deepEqual(parseConfigurationImport(serialized).configuration.boardMappings, { Alpha: '/board/alpha' }, 'export round-trip retains mappings');

    const initial = new MemoryStorage({ attendees: [{ ...attendee('1', 'Legacy'), satDown: true, hasLinger: true }] });
    const imported = await importConfiguration(initial, JSON.stringify(config([attendee('2', 'New')])), 'merge');
    assert.equal(imported.ok, true);
    assert.deepEqual((await loadConfiguration(initial)).attendees.map(a => a.id), ['1', '2']);
    assert.equal(initial.data[CONFIG_KEY].attendees[0].id, '1', 'writes the canonical manager-owned configuration');
    assert.equal(initial.data[BACKUP_KEY].attendees[0].id, '1', 'backs up the previous configuration before save');
    assert.deepEqual(initial.data[RUNTIME_KEY].states, {}, 'imports intentionally reset standup flags');
    assert.equal((await readRoster(initial)).find(person => person.id === '1').satDown, false, 'legacy highlight flags stay reset after import');
    assert.equal(initial.data[RUNTIME_GENERATION_KEY], 1, 'imports advance the runtime generation fence');

    const beforeInvalid = structuredClone(initial.data);
    const writesBeforeInvalid = initial.writes;
    const invalid = await importConfiguration(initial, JSON.stringify([{ id: 'bad', name: '', team: [] }]), 'replace');
    assert.equal(invalid.ok, false, 'returns validation errors for invalid imports');
    assert.deepEqual(initial.data, beforeInvalid, 'rejected import leaves all saved values unchanged');
    assert.equal(initial.writes, writesBeforeInvalid, 'rejected import performs no storage write');

    await saveConfiguration(initial, config([attendee('2', 'Manager edit'), attendee('3', 'Added by manager')], { Delta: '/board/delta' }));
    await updateRuntime(initial, { '1': { satDown: true, hasLinger: true } }, ['2', '1'], { '1': { url: 'https://avatar.test/1.png', baseAvatar: '' } });
    const roster = await readRoster(initial);
    assert.deepEqual(roster.map(a => a.id), ['2', '3'], 'board runtime writes never resurrect an attendee removed by manager save');
    assert.equal(roster[0].name, 'Manager edit', 'board runtime writes cannot revert manager-owned names');
    assert.equal(roster[0].team, 'Alpha', 'board runtime writes cannot revert manager-owned team membership');
    assert.deepEqual((await loadConfiguration(initial)).boardMappings, { Delta: '/board/delta' }, 'board runtime writes cannot revert mappings');
    assert.equal(roster[0].satDown, false, 'new manager records start with neutral transient flags');

    class RacingStorage extends MemoryStorage {
        async set(items) {
            if (this.raceNextRuntimeWrite && RUNTIME_KEY in items) {
                this.raceNextRuntimeWrite = false;
                await saveConfiguration(this, config([attendee('race', 'Manager value')]), true);
            }
            await super.set(items);
        }
    }
    const racingStorage = new RacingStorage({
        [CONFIG_KEY]: config([attendee('race', 'Old value')]),
        [RUNTIME_KEY]: { generation: 0, states: { race: { satDown: false, hasLinger: false } } },
        [RUNTIME_GENERATION_KEY]: 0,
    });
    racingStorage.raceNextRuntimeWrite = true;
    await updateRuntime(racingStorage, { race: { satDown: true } });
    const afterStaleWrite = await readRoster(racingStorage);
    assert.equal(afterStaleWrite[0].name, 'Manager value', 'a racing stale board write cannot overwrite manager-owned fields');
    assert.equal(afterStaleWrite[0].satDown, false, 'generation fencing rejects stale runtime state after an import reset');

    const preservedFlagsStorage = new MemoryStorage({
        [CONFIG_KEY]: config([attendee('same', 'Before edit')]),
        [RUNTIME_KEY]: { generation: 0, states: { same: { satDown: true, hasLinger: true } } },
        [RUNTIME_GENERATION_KEY]: 0,
    });
    await saveConfiguration(preservedFlagsStorage, config([attendee('same', 'After edit')]));
    const preservedFlags = (await readRoster(preservedFlagsStorage))[0];
    assert.equal(preservedFlags.satDown, true, 'ordinary manager edits preserve existing standup flags');
    assert.equal(preservedFlags.hasLinger, true, 'ordinary manager edits preserve linger flags');

    const avatarStorage = new MemoryStorage({ [CONFIG_KEY]: config([attendee('av', 'Avatar', 'Alpha', { avatarUrl: 'https://avatar.test/original.png' })]) });
    await updateRuntime(avatarStorage, {}, undefined, { av: { url: 'https://avatar.test/synced.png', baseAvatar: 'https://avatar.test/original.png' } });
    assert.equal((await readRoster(avatarStorage))[0].avatarUrl, 'https://avatar.test/synced.png', 'board avatar sync is a separate display override');
    await saveConfiguration(avatarStorage, config([attendee('av', 'Avatar', 'Alpha', { avatarUrl: 'https://avatar.test/manager.png' })]));
    await updateRuntime(avatarStorage, {}, undefined, { av: { url: 'https://avatar.test/stale.png', baseAvatar: 'https://avatar.test/original.png' } });
    assert.equal((await readRoster(avatarStorage))[0].avatarUrl, 'https://avatar.test/manager.png', 'stale avatar sync cannot override a manager avatar edit');

    const currentTeamStorage = new MemoryStorage({ [CONFIG_KEY]: config([attendee('team-1', 'One', 'Alpha')]) });
    await saveConfiguration(currentTeamStorage, config([attendee('team-1', 'One', ['Alpha', 'Beta']), attendee('team-2', 'Two', 'Beta')]));
    const refreshedTeamRoster = (await readRoster(currentTeamStorage)).filter(person => isOnTeam(person, 'Beta'));
    assert.deepEqual(refreshedTeamRoster.map(person => person.id), ['team-1', 'team-2'], 'refreshed configuration applies current multi-team filtering');

    const selectedTeamStorage = new MemoryStorage({ [CONFIG_KEY]: config([attendee('x', 'X', 'Alpha'), attendee('y', 'Y', 'Beta')]), selectedTeam: 'Beta' });
    await saveConfiguration(selectedTeamStorage, config([attendee('x', 'X', 'Alpha')]));
    assert.equal(selectedTeamStorage.data.selectedTeam, 'all', 'removing the selected team restores the all-teams view');

    await restorePreviousConfiguration(initial);
    assert.deepEqual((await loadConfiguration(initial)).attendees.map(a => a.id), ['1', '2'], 'Undo restores the one-level previous configuration');

    const newerRuntimeStorage = new MemoryStorage({
        attendees: [{ ...attendee('old', 'Legacy'), satDown: true, hasLinger: true }],
        [RUNTIME_KEY]: { generation: 0, states: { old: { satDown: false, hasLinger: false } } },
    });
    await saveConfiguration(newerRuntimeStorage, config([attendee('old', 'Legacy edited')]));
    const afterFirstSave = (await readRoster(newerRuntimeStorage))[0];
    assert.equal(afterFirstSave.satDown, false, 'first manager save keeps newer board state instead of legacy flags');
    assert.equal(afterFirstSave.hasLinger, false, 'first manager save keeps newer linger state instead of legacy flags');

    const fencedStorage = new MemoryStorage({
        [CONFIG_KEY]: config([attendee('f', 'Fenced')]),
        [RUNTIME_KEY]: { generation: 2, states: {} },
        [RUNTIME_GENERATION_KEY]: 2,
    });
    const staleApplied = await updateRuntime(fencedStorage, { f: { satDown: true } }, undefined, undefined, 1);
    assert.equal(staleApplied, false, 'runtime updates from an older generation are rejected');
    assert.equal((await readRoster(fencedStorage))[0].satDown, false, 'rejected stale update leaves runtime state unchanged');
    const legacyRoster = await readRoster(new MemoryStorage({ attendees: [{ ...attendee('legacy', 'Legacy user'), satDown: true }] }));
    assert.equal(legacyRoster[0].satDown, true, 'legacy records keep their standup state during read-only upgrade');
    console.log('Manage configuration tests passed');
}

run().catch(error => { console.error(error); process.exit(1); });
