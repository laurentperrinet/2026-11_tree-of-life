const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function harness(search = '') {
    const storage = new Map();
    const sessionStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
    };
    const location = {
        origin: 'https://laurentperrinet.github.io',
        pathname: '/2026-11_tree-of-life/',
        search,
        hash: '#view',
        href: ''
    };
    const requests = [];
    const context = vm.createContext({
        console, URL, URLSearchParams, Uint8Array, crypto: webcrypto, sessionStorage,
        document: { title: 'test' },
        window: { location, history: { replaceState: (state, title, url) => { location.cleaned = url; } } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (url === 'https://worker.example/api/auth/exchange') {
                return { ok: true, json: async () => ({ access_token: 'test-token' }) };
            }
            return { ok: true, json: async () => ({ login: 'laurentperrinet' }) };
        }
    });
    for (const file of ['local-storage.js', 'auth.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
    }
    const AuthManager = vm.runInContext('AuthManager', context);
    const config = {
        clientId: 'client',
        redirectUri: `${location.origin}${location.pathname}`,
        exchangeUrl: 'https://worker.example/api/auth/exchange'
    };
    return { auth: new AuthManager(config), storage, location, requests, config, AuthManager };
}

test('sign-in requires a Worker and creates an unpredictable stored state', () => {
    const { auth, storage, location, config, AuthManager } = harness();
    assert.throws(() => new AuthManager({ ...config, exchangeUrl: '' }).login(), /configured OAuth Worker/);
    auth.login();
    const url = new URL(location.href);
    assert.equal(url.origin, 'https://github.com');
    assert.match(url.searchParams.get('state'), /^[0-9a-f]{64}$/);
    assert.equal(url.searchParams.get('state'), storage.get('tree-of-life-oauth-state'));
});

test('callback validates state before exchange and saves the verified session', async () => {
    const good = harness('?code=abc&state=expected&keep=1');
    good.storage.set('tree-of-life-oauth-state', 'expected');
    await good.auth.initialize();
    assert.equal(good.requests.length, 2);
    assert.equal(good.requests[0].url, good.config.exchangeUrl);
    assert.equal(good.auth.getUserLogin(), 'laurentperrinet');
    assert.equal(good.storage.get('github-oauth-token'), 'test-token');
    assert.equal(good.storage.has('tree-of-life-oauth-state'), false);
    assert.equal(good.location.cleaned, '/2026-11_tree-of-life/?keep=1#view');

    const bad = harness('?code=abc&state=wrong');
    bad.storage.set('tree-of-life-oauth-state', 'expected');
    await assert.rejects(bad.auth.initialize(), /invalid OAuth state/);
    assert.equal(bad.requests.length, 0);
    assert.equal(bad.storage.has('tree-of-life-oauth-state'), false);
    assert.equal(bad.location.cleaned, '/2026-11_tree-of-life/#view');
});

test('admin view survives a verified OAuth callback without granting reset permissions', async () => {
    const h = harness('?admin');
    assert.equal(h.auth.canReset(), false);
    h.auth.login();
    const state = h.storage.get('tree-of-life-oauth-state');
    h.location.search = `?code=abc&state=${state}`;
    await h.auth.initialize();
    assert.equal(h.location.cleaned, '/2026-11_tree-of-life/?admin=#view');
    assert.equal(h.storage.has('tree-of-life-oauth-admin-view'), false);

    const bad = harness('?code=abc&state=wrong');
    bad.storage.set('tree-of-life-oauth-state', 'expected');
    bad.storage.set('tree-of-life-oauth-admin-view', '1');
    await assert.rejects(bad.auth.initialize(), /invalid OAuth state/);
    assert.equal(bad.location.cleaned, '/2026-11_tree-of-life/#view');
    assert.equal(bad.storage.has('tree-of-life-oauth-admin-view'), false);
});
