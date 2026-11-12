const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.ok(fs.existsSync(__dirname + '/.build/manage/DiscoverPanel.js'), 'Manager must expose Jira people discovery');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'chrome-extension://own/manage.html' });
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
const React = require('react');
const { act } = require('react-dom/test-utils');
const { createRoot } = require('react-dom/client');
const ManageApp = require('./.build/manage/ManageApp').default;
const data = { smartieConfiguration: { version: 1, attendees: [{ id: 'fake:old', name: 'Manual', avatarUrl: 'manual-avatar', excludeFromShuffle: true, team: ['Alpha'] }], boardMappings: { Alpha: '/keep' } } };
const writes = []; let pendingSearch, deferSearch = false, tabChanged, pendingBoard, deferBoard = false;
const newPerson = { accountId: 'fake:new', displayName: 'Fake Full Name', avatarUrl: '' };
global.chrome = {
    runtime: { id: 'own' },
    tabs: {
        onUpdated: { addListener: fn => { tabChanged = fn; }, removeListener() {} },
        onRemoved: { addListener() {}, removeListener() {} },
        query: async () => [{ id: 7, url: 'https://waystar.atlassian.net/jira/software/c/projects/FAKE/boards/42' }],
        sendMessage(id, request, callback) {
            if (request.operation === 'board' && deferBoard) pendingBoard = callback;
            else if (request.operation === 'board') callback({ ok: true, kind: 'board', board: { id: 42, name: 'Synthetic board', type: 'scrum' } });
            else if (deferSearch) pendingSearch = callback;
            else callback({ ok: true, kind: 'users', candidates: [newPerson, { accountId: 'fake:old', displayName: 'Overwrite', avatarUrl: 'https://fake.invalid/a.png' }], count: 2, ceilingReached: false });
        },
    },
    storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, structuredClone(data[key])])), set: async items => { writes.push(structuredClone(items)); Object.assign(data, structuredClone(items)); } }, onChanged: { addListener() {}, removeListener() {} } },
};
let complete = false;
process.on('beforeExit', () => { if (!complete) { console.error('Discovery UI suite did not complete'); process.exitCode = 1; } });
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));
const button = name => [...document.querySelectorAll('button')].find(element => element.textContent === name);
const input = label => document.querySelector(`[aria-label="${label}"]`);
const change = async (element, value) => act(async () => {
    const proto = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
(async () => {
    const root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(ManageApp))); await settle();
    await change(input('Name for attendee 1'), 'Unsaved manual');
    await change(input('Teams for attendee 1'), 'Alpha; Beta;');
    await change(input('Board path for mapping 1'), '/unsaved');
    deferBoard = true;
    for (const interaction of ['query', 'mode']) {
        await change(input('Discovery path'), 'people');
        await change(input('Jira board tab'), '7'); await settle();
        if (interaction === 'query') await change(input('Search Jira people'), 'Fake');
        else await change(input('Discovery path'), 'board');
        await act(async () => pendingBoard({ ok: true, kind: 'board', board: { id: 42, name: 'Synthetic board', type: 'scrum' } })); await settle();
        assert.equal(button(interaction === 'query' ? 'Search' : 'Scan board').disabled, false, `A ${interaction} edit must not discard pending board metadata`);
    }
    await change(input('Discovery path'), 'people');
    await change(input('Jira board tab'), '7'); await settle();
    const supersededBoard = pendingBoard;
    await change(input('Jira board tab'), '');
    await act(async () => supersededBoard({ ok: true, kind: 'board', board: { id: 42, name: 'Stale board', type: 'scrum' } })); await settle();
    assert.equal(button('Search').disabled, true, 'Tab context changes still invalidate pending metadata');
    assert.ok(!document.querySelector('.discovery-panel').textContent.includes('Stale board'));
    deferBoard = false;
    await change(input('Search Jira people'), '');
    await change(input('Jira board tab'), '7'); await settle();
    await change(input('Discovery path'), 'board');
    assert.equal(input('Board scope').value, 'active', 'Scrum defaults to active sprints');
    await change(input('Discovery path'), 'people');
    assert.equal(button('Search').disabled, true, 'Never send an empty user search');
    await change(input('Search Jira people'), 'Fake');
    await act(async () => button('Search').click()); await settle();
    assert.equal(input('Select Fake Full Name').checked, false, 'Candidates are not selected automatically');
    await act(async () => input('Select Fake Full Name').click());
    await act(async () => input('Select Overwrite').click());
    await change(input('Smartie Name for fake:new'), 'Filter');
    await change(input('Target team'), 'Gamma');
    await act(async () => button('Add selected to draft').click()); await settle();
    assert.equal(writes.length, 0, 'Discovery and Add leave configuration unsaved');
    assert.equal(input('Name for attendee 1').value, 'Unsaved manual');
    assert.equal(input('Avatar URL for attendee 1').value, 'manual-avatar');
    assert.equal(input('Exclude attendee 1 from shuffle').checked, true);
    assert.equal(input('Teams for attendee 1').value, 'Alpha; Beta; Gamma', 'Team union retains unsaved team edits');
    assert.equal(input('Board path for mapping 1').value, '/unsaved');
    assert.equal(input('Name for attendee 2').value, 'Filter');
    await act(async () => button('Save changes').click()); await settle();
    assert.equal(data.smartieConfiguration.attendees.length, 2); assert.equal(data.smartieConfiguration.boardMappings.Alpha, '/unsaved');
    await change(input('Teams for attendee 2'), '');
    await act(async () => input('Select Fake Full Name').click());
    await change(input('Target team'), 'Delta');
    await act(async () => button('Add selected to draft').click());
    assert.equal(input('Teams for attendee 2').value, 'Delta', 'Adding a target team to an empty editor does not insert an empty membership');
    deferSearch = true;
    await change(input('Search Jira people'), 'Other');
    await act(async () => button('Search').click()); await settle();
    await act(async () => button('Cancel discovery').click());
    await act(async () => pendingSearch({ ok: true, kind: 'users', candidates: [{ accountId: 'stale', displayName: 'Stale', avatarUrl: '' }], count: 1, ceilingReached: false }));
    assert.equal(input('Select Stale'), null, 'Cancelled responses cannot populate candidates');
    await act(async () => button('Search').click()); await settle();
    const oldCallback = pendingSearch;
    await change(input('Search Jira people'), 'Different');
    await act(async () => oldCallback({ ok: true, kind: 'users', candidates: [{ accountId: 'stale', displayName: 'Stale', avatarUrl: '' }], count: 1, ceilingReached: false }));
    assert.equal(input('Select Stale'), null, 'Superseded search responses are ignored');
    await change(input('Name for attendee 1'), 'Keep after tab navigation');
    await act(async () => tabChanged(7, { url: 'https://waystar.atlassian.net/jira/software/c/projects/FAKE/boards/43' })); await settle();
    assert.equal(input('Jira board tab').value, '', 'Selected tab board navigation resets discovery context');
    assert.equal(input('Name for attendee 1').value, 'Keep after tab navigation', 'Tab changes never discard draft edits');
    assert.equal(button('Search').disabled, true, 'Board metadata is required after tab changes');
    await act(async () => root.unmount()); complete = true;
    console.log('Discovery manager integration tests passed (draft, Save, preserved edits, cancellation, stale responses)');
})().catch(error => { console.error(error); process.exitCode = 1; });
