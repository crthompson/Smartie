const assert = require('node:assert/strict');
const { createStandupSession } = require('./.build/content/standupSession.js');

const person = (id, name) => ({ id, name });

async function run() {
    let generation = 1;
    let roster = [person('a', 'Ada'), person('b', 'Bo')];
    const calls = [];
    let releaseFirst;
    const firstWrite = new Promise(resolve => { releaseFirst = resolve; });
    let writes = 0;
    const session = createStandupSession({
        getGeneration: () => generation,
        markSatDown: async (id, expected) => {
            writes++;
            if (writes === 1) await firstWrite;
            calls.push(`mark:${id}@${expected}`);
            return expected === generation ? roster : null;
        },
        applyFilter: async (target, select, names) => { calls.push(`${select ? 'select' : 'deselect'}:${target.name}:${names.join('|')}`); },
        delay: async () => {},
        onActiveChanged: () => {},
    });

    session.switchTo(person('a', 'Ada'));
    session.switchTo(person('b', 'Bo'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 1, 'the first click is mid-write when the import lands');
    generation = 2;
    releaseFirst();
    await session.idle();
    assert.deepEqual(calls, ['mark:a@1'], 'pre-import clicks keep their enqueue generation, apply no filter, and cancel queued work');
    assert.equal(session.activeTarget(), null, 'a cancelled pre-import click does not become active');

    calls.length = 0;
    session.switchTo(person('a', 'Ada'));
    await session.idle();
    assert.equal(session.activeTarget().name, 'Ada');
    roster = [person('b', 'Bo')];
    session.rosterChanged(roster);
    await session.idle();
    assert.ok(calls.includes('deselect:Ada:Bo|Ada'), 'removing the active attendee clears their applied filter by retained name');
    assert.equal(session.activeTarget(), null, 'active identity is discarded only after its filter is cleared');

    calls.length = 0;
    session.switchTo(person('b', 'Bo'));
    await session.idle();
    session.rosterChanged([person('b', 'Bob')]);
    await session.idle();
    assert.ok(calls.includes('deselect:Bo:Bob|Bo'), 'renaming the active attendee clears the filter applied under the old name');
    const inflightCalls = [];
    let releaseDelay;
    let holdNextDelay = false;
    const inflight = createStandupSession({
        getGeneration: () => 1,
        markSatDown: async () => [person('a', 'Ada'), person('b', 'Bo')],
        applyFilter: async (target, select, names) => { inflightCalls.push(`${select ? 'select' : 'deselect'}:${target.name}:${names.join('|')}`); if (select) holdNextDelay = true; },
        delay: () => {
            if (!holdNextDelay) return Promise.resolve();
            holdNextDelay = false;
            return new Promise(resolve => { releaseDelay = resolve; });
        },
        onActiveChanged: () => {},
    });
    inflight.switchTo(person('a', 'Ada'));
    while (!releaseDelay) await new Promise(resolve => setImmediate(resolve));
    inflight.rosterChanged([person('b', 'Bo')]);
    releaseDelay();
    await inflight.idle();
    assert.deepEqual(inflightCalls, ['select:Ada:Ada|Bo', 'deselect:Ada:Bo|Ada'], 'deleting the attendee mid-selection clears the filter just applied');
    assert.equal(inflight.activeTarget(), null, 'a target deleted mid-selection never becomes active');

    releaseDelay = undefined;
    inflightCalls.length = 0;
    inflight.switchTo(person('b', 'Bo'));
    while (!releaseDelay) await new Promise(resolve => setImmediate(resolve));
    inflight.rosterChanged([person('b', 'Bob')]);
    releaseDelay();
    await inflight.idle();
    assert.ok(inflightCalls.includes('deselect:Bo:Bob|Bo'), 'renaming the attendee mid-selection clears the filter applied under the old name');
    assert.equal(inflight.activeTarget(), null, 'a target renamed mid-selection is not committed under its obsolete name');

    let importGeneration = 1;
    const importCalls = [];
    let releaseImportDelay;
    let holdImportDelay = false;
    let importDelayHeld = false;
    const importSession = createStandupSession({
        getGeneration: () => importGeneration,
        markSatDown: async (id, expected) => { importCalls.push(`mark:${id}@${expected}`); return expected === importGeneration ? [person('a', 'Ada')] : null; },
        applyFilter: async (target, select) => { importCalls.push(`${select ? 'select' : 'deselect'}:${target.name}`); if (select && !importDelayHeld) { holdImportDelay = true; importDelayHeld = true; } },
        delay: () => {
            if (!holdImportDelay) return Promise.resolve();
            holdImportDelay = false;
            return new Promise(resolve => { releaseImportDelay = resolve; });
        },
        onActiveChanged: () => {},
    });
    importSession.switchTo(person('a', 'Ada'));
    while (!releaseImportDelay) await new Promise(resolve => setImmediate(resolve));
    importGeneration = 2;
    importSession.rosterChanged([person('a', 'Ada')]);
    releaseImportDelay();
    await importSession.idle();
    assert.deepEqual(importCalls, ['mark:a@1', 'select:Ada', 'deselect:Ada'], 'a same-ID import during the filter wait cancels the stale selection and clears its filter');
    assert.equal(importSession.activeTarget(), null, 'a stale-generation selection never commits as active');

    importCalls.length = 0;
    importSession.switchTo(person('a', 'Ada'));
    await importSession.idle();
    assert.deepEqual(importCalls, ['mark:a@2', 'select:Ada'], 'clicking the same attendee after the import marks and selects them');
    assert.equal(importSession.activeTarget().id, 'a');

    importCalls.length = 0;
    importGeneration = 3;
    importSession.switchTo(person('a', 'Ada'));
    await importSession.idle();
    assert.ok(importCalls.includes('mark:a@3'), 'an attendee active before an import is marked sat down again when clicked after it');

    console.log('Standup session tests passed');
}

let finished = false;
process.on('exit', code => { if (code === 0 && !finished) { console.error('Standup session tests did not finish'); process.exitCode = 1; } });
run().then(() => { finished = true; }).catch(error => { console.error(error); process.exit(1); });
