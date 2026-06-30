// jsdom tests for the page-load gating + reveal logic that replaces the old fixed
// load timer. These guard the "old cached page flashes before the panel" fix:
//  - whenPageReady resolves immediately when the doc is already complete, otherwise
//    waits for the real `load` event (so we never inject into a pre-hydration paint).
//  - isBoardContentRendered only reports ready once real board content exists.
//  - revealPanel removes the `loading` class when ready, with a bounded frame
//    fallback so the panel can never be stranded hidden.

const { JSDOM } = require('jsdom');
const { whenPageReady } = require('./.build/content/whenPageReady.js');
const { isBoardContentRendered, BOARD_CONTENT_SELECTORS } = require('./.build/content/boardContent.js');
const { revealPanel } = require('./.build/content/revealPanel.js');

let failures = 0;
function assert(cond, msg) {
    if (cond) {
        console.log(`  PASS: ${msg}`);
    } else {
        failures++;
        console.error(`  FAIL: ${msg}`);
    }
}

function makeDoc(readyState) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://waystar.atlassian.net' });
    // jsdom defaults readyState to 'complete'; override for the not-loaded case.
    Object.defineProperty(dom.window.document, 'readyState', {
        configurable: true,
        get: () => readyState,
    });
    return dom;
}

async function whenPageReadyTests() {
    console.log('whenPageReady tests');

    // 1) Already complete -> resolves without waiting for an event.
    {
        const dom = makeDoc('complete');
        let resolved = false;
        await whenPageReady(dom.window.document, dom.window).then(() => { resolved = true; });
        assert(resolved === true, 'resolves immediately when readyState is "complete"');
    }

    // 2) Not yet complete -> resolves only after the load event fires.
    {
        const dom = makeDoc('loading');
        let resolved = false;
        const p = whenPageReady(dom.window.document, dom.window).then(() => { resolved = true; });
        await new Promise(r => setTimeout(r, 10));
        assert(resolved === false, 'does not resolve before load fires');
        dom.window.dispatchEvent(new dom.window.Event('load'));
        await p;
        assert(resolved === true, 'resolves once the load event fires');
    }
}

function boardContentTests() {
    console.log('\nisBoardContentRendered tests');
    const dom = makeDoc('complete');
    const doc = dom.window.document;
    assert(isBoardContentRendered(doc) === false, 'false when no board content is present (e.g. controls bar only)');
    // Add the first known board-content hook.
    const board = doc.createElement('div');
    board.setAttribute('data-testid', 'platform-board-kit.ui.board.scroll.board-scroll');
    doc.body.appendChild(board);
    assert(isBoardContentRendered(doc) === true, 'true once a board-content testid is present');
    assert(Array.isArray(BOARD_CONTENT_SELECTORS) && BOARD_CONTENT_SELECTORS.length > 0, 'exposes a non-empty selector list');
}

async function revealPanelTests() {
    console.log('\nrevealPanel tests');
    const dom = makeDoc('complete');
    const doc = dom.window.document;

    // Deterministic rAF: run queued callbacks on demand.
    function makeRaf() {
        const queue = [];
        const raf = (cb) => { queue.push(cb); };
        const flush = (n = 1) => { for (let i = 0; i < n; i++) { const cb = queue.shift(); if (cb) cb(); } };
        return { raf, flush, size: () => queue.length };
    }

    // 1) Reveals (removes "loading") as soon as isReady() is true.
    {
        const host = doc.createElement('div');
        host.classList.add('loading');
        const { raf, flush } = makeRaf();
        let ready = false;
        revealPanel(host, { isReady: () => ready, raf, maxFrames: 100 });
        flush();
        assert(host.classList.contains('loading'), 'stays hidden while board content is not ready');
        ready = true;
        flush();
        assert(!host.classList.contains('loading'), 'reveals once board content is ready');
    }

    // 2) Bounded fallback: reveals after maxFrames even if never ready.
    {
        const host = doc.createElement('div');
        host.classList.add('loading');
        const { raf, flush } = makeRaf();
        revealPanel(host, { isReady: () => false, raf, maxFrames: 3 });
        flush(); flush();
        assert(host.classList.contains('loading'), 'still hidden before the frame budget is exhausted');
        flush();
        assert(!host.classList.contains('loading'), 'reveals via the bounded frame fallback (never stranded hidden)');
    }
}

whenPageReadyTests()
    .then(boardContentTests)
    .then(revealPanelTests)
    .then(() => {
        if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
        console.log('\nAll page-load tests passed');
    })
    .catch(err => { console.error(err); process.exit(1); });
