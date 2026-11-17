const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('authentication status is hidden until a user signs in', () => {
    const elements = {
        'auth-status': {
            hidden: false,
            textContent: '',
            className: '',
            classList: { remove() {} }
        },
        'auth-button': { textContent: '' },
        'reset-container': { style: {} }
    };
    const auth = {
        isAuthenticated: false,
        isConfigured: () => true,
        getUserLogin: () => 'owner'
    };
    const reset = { canReset: () => auth.isAuthenticated };
    const context = vm.createContext({ document: { getElementById: id => elements[id] } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8'), context);
    const UIManager = vm.runInContext('UIManager', context);
    const ui = new UIManager(auth, reset);

    ui.updateAuthStatus();
    assert.equal(elements['auth-status'].hidden, true);
    assert.equal(elements['auth-status'].textContent, '');
    assert.match(elements['auth-button'].textContent, /Sign in/);
    assert.equal(elements['reset-container'].style.display, 'none');

    auth.isAuthenticated = true;
    ui.updateAuthStatus();
    assert.equal(elements['auth-status'].hidden, false);
    assert.match(elements['auth-status'].textContent, /owner/);
    assert.equal(elements['reset-container'].style.display, 'block');

    auth.isAuthenticated = false;
    ui.updateAuthStatus();
    assert.equal(elements['auth-status'].hidden, true);
    assert.equal(elements['reset-container'].style.display, 'none');
});
