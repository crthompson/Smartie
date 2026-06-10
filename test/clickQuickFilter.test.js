// Lightweight jsdom test for the Quick Filters logic in src/content/clickQuickFilter.ts.
// No test framework: pretest compiles the TS module to CJS, this script wires up a
// jsdom DOM that mimics Jira Cloud's react-select "Quick filters" control and asserts behavior.
//
// The DOM shapes here were captured from a live Jira Cloud board (AUTH/301):
//  - Unselected control button text: "Quick filters"
//  - After a filter is applied the button text gains a count badge: "Quick filters1"
//  - Options expose role="option" with the (first) name as text content
//  - Clicking an option closes the menu (react-select auto-close)

const { JSDOM } = require('jsdom');
const { clickQuickFilter } = require('./.build/content/clickQuickFilter.js');
const { resetStandupHighlights } = require('./.build/content/resetStandupHighlights.js');
const { applyQuickFilterAppearance } = require('./.build/content/quickFilterAppearance.js');

let failures = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) {
    if (cond) {
        console.log(`  PASS: ${msg}`);
    } else {
        failures++;
        console.error(`  FAIL: ${msg}`);
    }
}

function installDom() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://waystar.atlassian.net' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.MutationObserver = dom.window.MutationObserver;
    global.HTMLButtonElement = dom.window.HTMLButtonElement;
    global.HTMLElement = dom.window.HTMLElement;
}

// Builds a Jira-like Quick Filters control. The button toggles a menu of role="option"
// elements that render asynchronously (like react-select), so the production code's
// MutationObserver path is exercised.
function setupBoard({ buttonText = 'Quick filters', optionNames = [], renderDelay = 5, includeButton = true } = {}) {
    document.body.innerHTML = '';
    const state = { clicked: [] };
    const menu = document.createElement('div');
    document.body.appendChild(menu);
    if (!includeButton) return { menu, btn: null, state };

    const btn = document.createElement('button');
    btn.textContent = buttonText;
    btn.setAttribute('aria-expanded', 'false');
    let optionEls = [];

    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        if (expanded) {
            btn.setAttribute('aria-expanded', 'false');
            optionEls.forEach(o => o.remove());
            optionEls = [];
        } else {
            btn.setAttribute('aria-expanded', 'true');
            setTimeout(() => {
                optionNames.forEach(n => {
                    const o = document.createElement('div');
                    o.setAttribute('role', 'option');
                    o.textContent = n;
                    o.addEventListener('click', () => {
                        state.clicked.push(n);
                        // react-select does NOT close the menu on a programmatic option .click()
                        // (it only auto-closes on its own synthetic mouse events). Intentionally
                        // leave aria-expanded='true' and the options in place so the test exercises
                        // clickQuickFilter's explicit close-after-select behavior.
                    });
                    menu.appendChild(o);
                    optionEls.push(o);
                });
            }, renderDelay);
        }
    });
    document.body.appendChild(btn);
    return { btn, menu, state };
}

async function run() {
    console.log('clickQuickFilter jsdom tests\n');

    // 1) Regression: selected-state button text is "Quick filters1" (count badge).
    //    This is the exact bug — exact-equality matching used to fail here.
    installDom();
    {
        console.log('Scenario 1: selected-state button ("Quick filters1") still clears/applies');
        const board = setupBoard({ buttonText: 'Quick filters1', optionNames: ['Juan', 'Chad', 'Kyle'] });
        const pending = clickQuickFilter('Chad');
        // The hide style must be injected synchronously, before the menu is ever opened.
        assert(!!document.getElementById('smartie-qf-hide'), 'injects the popup-hide style synchronously while operating');
        const result = await pending;
        assert(result === true, 'returns true when control label has a count badge');
        assert(board.state.clicked.join(',') === 'Chad', 'clicks the matching "Chad" option');
        await sleep(200);
        assert(board.btn.getAttribute('aria-expanded') === 'false', 'closes the dropdown after selecting');
        assert(!document.getElementById('smartie-qf-hide'), 'removes the popup-hide style after the operation (no leak)');
    }

    // 2) Happy path: unselected control.
    installDom();
    {
        const board = setupBoard({ buttonText: 'Quick filters', optionNames: ['Juan', 'Chad', 'Kyle'] });
        console.log('Scenario 2: unselected control matches by name');
        const result = await clickQuickFilter('kyle'); // case-insensitive
        assert(result === true, 'returns true and matches case-insensitively');
        assert(board.state.clicked.join(',') === 'Kyle', 'clicks the matching "Kyle" option');
        await sleep(150);
        assert(board.btn.getAttribute('aria-expanded') === 'false', 'closes the dropdown after selecting');
    }

    // 3) Options render but no matching name -> false (caller falls back), menu closed.
    installDom();
    {
        const { btn, state } = setupBoard({ buttonText: 'Quick filters', optionNames: ['Juan', 'Chad'] });
        console.log('Scenario 3: no matching option falls back');
        const result = await clickQuickFilter('Zoe');
        assert(result === false, 'returns false when no option matches');
        assert(btn.getAttribute('aria-expanded') === 'false', 'closes the dropdown after a non-match');
        assert(state.clicked.length === 0, 'does not click any option');
        await sleep(120);
        assert(!document.getElementById('smartie-qf-hide'), 'removes the popup-hide style after a non-match (no leak)');
    }

    // 4) No Quick filters control present at all -> false immediately.
    installDom();
    {
        setupBoard({ includeButton: false });
        console.log('Scenario 4: no Quick filters button present');
        const result = await clickQuickFilter('Chad');
        assert(result === false, 'returns false when the control is absent');
        assert(!document.getElementById('smartie-qf-hide'), 'does not inject a hide style when the control is absent');
    }

    console.log('');
    if (failures > 0) {
        console.error(`${failures} assertion(s) failed`);
        process.exit(1);
    }
    console.log('All clickQuickFilter tests passed');
}

function resetHighlightsTests() {
    console.log('\nresetStandupHighlights tests');
    // Regression for "Clear on refresh" not clearing the Smartie panel highlights:
    // every attendee must come back with satDown=false and hasLinger=false, and the
    // original array/objects must not be mutated.
    const input = [
        { id: '1', name: 'Chad', satDown: true, hasLinger: true, team: 'a' },
        { id: '2', name: 'Kyle', satDown: false, hasLinger: true, team: 'b' },
        { id: '3', name: 'Nicole', satDown: true, hasLinger: false, team: 'a' }
    ];
    const out = resetStandupHighlights(input);
    assert(out.every(a => a.satDown === false), 'all satDown flags reset to false');
    assert(out.every(a => a.hasLinger === false), 'all hasLinger flags reset to false');
    assert(out.map(a => a.id).join(',') === '1,2,3', 'order and ids preserved');
    assert(out.map(a => a.name).join(',') === 'Chad,Kyle,Nicole', 'names/other fields preserved');
    assert(input[0].satDown === true && input[0].hasLinger === true, 'does not mutate the input array');
    assert(resetStandupHighlights([]).length === 0, 'handles empty list');
}

function appearanceTests() {
    console.log('\nquickFilterAppearance tests');
    installDom();
    applyQuickFilterAppearance();
    const el = document.getElementById('smartie-qf-appearance');
    assert(!!el && el.tagName === 'STYLE', 'injects a <style> element');
    assert(/quick-filters-filter-badge/.test(el.textContent) && /display:none/.test(el.textContent), 'hides the quick filter count badge');
    assert(/background-color:transparent/.test(el.textContent), 'neutralizes the active background highlight');
    assert(/::after\{border-color:transparent/.test(el.textContent), 'neutralizes the active blue border (::after)');
    assert(/outline:none/.test(el.textContent), 'suppresses the blue focus outline');
    // idempotent: calling again must not add a second style element
    applyQuickFilterAppearance();
    assert(document.querySelectorAll('#smartie-qf-appearance').length === 1, 'is idempotent (no duplicate style)');
}

run()
    .then(resetHighlightsTests)
    .then(appearanceTests)
    .then(() => {
        if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
        console.log('\nAll tests passed');
    })
    .catch(err => { console.error(err); process.exit(1); });
