const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'chrome-extension://smartie/manage.html' });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;

const data = {};
let releaseInitialLoad;
const initialLoad = new Promise(resolve => { releaseInitialLoad = resolve; });
let firstGet = true;
const listeners = new Set();
global.chrome = {
    storage: {
        local: {
            async get(keys) {
                if (firstGet) { firstGet = false; await initialLoad; }
                const list = Array.isArray(keys) ? keys : [keys];
                return Object.fromEntries(list.filter(key => key in data).map(key => [key, structuredClone(data[key])]));
            },
            async set(items) { Object.assign(data, structuredClone(items)); },
        },
        onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
    },
};

const React = require('react');
const { act } = require('react-dom/test-utils');
const { createRoot } = require('react-dom/client');
const ManageApp = require('./.build/manage/ManageApp.js').default;
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));
const buttonNamed = name => [...document.querySelectorAll('button')].find(button => button.textContent === name);
const typeInto = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
        input.focus();
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
};

(async () => {
    const root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(ManageApp)));
    assert.equal(buttonNamed('Add attendee').matches(':disabled'), true, 'editing waits for the saved configuration to load');
    releaseInitialLoad();
    await settle();
    await act(async () => buttonNamed('Add attendee').click());
    await settle();
    assert.ok(document.querySelector('[aria-label="Jira account ID for attendee 1"]'), 'adding an attendee keeps the new draft row');
    const idInput = document.querySelector('[aria-label="Jira account ID for attendee 1"]');
    await typeInto(idInput, 'acc');
    assert.equal(document.activeElement, idInput, 'typing an account ID keeps the same focused input');
    const teamsInput = document.querySelector('[aria-label="Teams for attendee 1"]');
    await typeInto(teamsInput, 'Alpha;');
    assert.equal(teamsInput.value, 'Alpha;', 'team text keeps a trailing separator while typing');
    await typeInto(teamsInput, 'Alpha; Team B');
    assert.equal(teamsInput.value, 'Alpha; Team B', 'team text keeps spaces in multiword names');
    await act(async () => buttonNamed('Add mapping').click());
    await settle();
    const mappedTeam = document.querySelector('[aria-label="Mapped team 1"]');
    assert.ok(mappedTeam, 'adding a mapping keeps the new draft row');
    await typeInto(mappedTeam, 'Alpha');
    assert.equal(document.activeElement, mappedTeam, 'typing a mapping team keeps the same focused input');
    await act(async () => root.unmount());
    console.log('Manage UI tests passed');
})().catch(error => { console.error(error); process.exit(1); });
