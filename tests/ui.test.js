const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('default camera centers the disk at the zenith and controls preserve its target', () => {
    class Vector {
        set(x, y, z) { Object.assign(this, { x, y, z }); }
    }
    class Camera {
        constructor() { this.position = new Vector(); this.up = new Vector(); }
        lookAt(x, y, z) { this.target = [x, y, z]; }
        updateProjectionMatrix() {}
    }
    class Scene { add() {} traverse() {} }
    class Light { constructor() { this.position = new Vector(); } }
    const THREE = {
        Scene, Color: class {}, PerspectiveCamera: Camera,
        WebGLRenderer: class { setPixelRatio() {} setSize() {} dispose() {} }, AmbientLight: Light, DirectionalLight: Light,
        Object3D: class {}
    };
    const windowListeners = new Map();
    const documentListeners = new Map();
    const track = (map) => ({
        addEventListener: (type, fn) => map.set(type, [...(map.get(type) ?? []), fn]),
        removeEventListener: (type, fn) => map.set(type, (map.get(type) ?? []).filter(f => f !== fn))
    });
    const window = {
        innerWidth: 1200, innerHeight: 800,
        ...track(windowListeners)
    };
    const document = track(documentListeners);
    const context = vm.createContext({ THREE, window, document });
    for (const file of ['renderer.js', 'controls.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
    }
    const { TerrainRenderer, InputControls } = vm.runInContext('({ TerrainRenderer, InputControls })', context);
    const renderer = new TerrainRenderer({});
    const camera = renderer.camera;
    const controls = new InputControls(renderer);
    assert.deepEqual([camera.position.x, camera.position.z], [0, 0]);
    assert.ok(camera.position.y > 0);
    assert.deepEqual(camera.target, [0, 0, 0]);
    assert.deepEqual([camera.up.x, camera.up.y, camera.up.z], [0, 0, -1]);

    controls.onMouseWheel({ deltaY: -1, target: renderer.canvas, preventDefault() {} });
    assert.ok(Math.abs(camera.position.x) < 1e-10 && Math.abs(camera.position.z) < 1e-10);
    assert.equal(camera.position.y, 64.5);
    assert.deepEqual(camera.target, [0, 0, 0]);
    assert.ok(camera.up.z < -0.999);

    controls.cameraRotation.x -= 0.2;
    controls.cameraRotation.y += 0.5;
    controls.updateCameraPosition();
    assert.deepEqual(camera.target, [0, 0, 0]);
    assert.ok(Math.abs(camera.position.x * camera.up.x + camera.position.y * camera.up.y +
        camera.position.z * camera.up.z) < 1e-10);

    window.innerWidth = 400;
    window.innerHeight = 800;
    renderer.onWindowResize();
    const halfWidth = 62 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    assert.ok(halfWidth > 25);

    // Both objects register their listeners, and dispose() removes them.
    assert.equal(windowListeners.get('resize').length, 1);
    assert.equal(documentListeners.get('wheel').length, 1);
    renderer.dispose();
    assert.equal(windowListeners.get('resize')?.length ?? 0, 0);
    controls.dispose();
    assert.equal(documentListeners.get('wheel')?.length ?? 0, 0);
    assert.equal(documentListeners.get('keydown')?.length ?? 0, 0);
});

test('mesh view shows the wireframe and particles without biology', () => {
    class Color {
        setRGB(r, g, b) { Object.assign(this, { r, g, b }); }
    }
    const context = vm.createContext({ THREE: { Color } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/renderer.js'), 'utf8'), context);
    const TerrainRenderer = vm.runInContext('TerrainRenderer', context);
    const renderer = Object.create(TerrainRenderer.prototype);
    const recorded = [];
    const colors = { setXYZ(i, r, g, b) { recorded.push([i, r, g, b]); } };
    const material = { color: new Color(), specular: new Color(), wireframe: false };
    renderer.terrainMesh = {
        material,
        geometry: { attributes: { color: colors, position: { array: [0, 0, 0] } }, computeVertexNormals() {} }
    };
    renderer.biologyMesh = { visible: true };
    renderer.particleMesh = { visible: true };
    const grid = {
        elevation: [0.3], bedrock: [0], initialSandDepth: 0.3, erodibleCount: 1,
        waterDepth: [0.2], velocityX: [0.3], velocityY: [0], sediment: [0.4]
    };
    renderer.displayMode = 'habitat';
    renderer.cycleDisplayMode();
    renderer.cycleDisplayMode();
    renderer.cycleDisplayMode();
    assert.equal(renderer.displayMode, 'mesh');
    renderer.updateTerrainMesh(grid, {});
    assert.equal(material.wireframe, true);
    assert.equal(renderer.biologyMesh.visible, false);
    assert.equal(renderer.particleMesh.visible, true);

    renderer.cycleDisplayMode();
    renderer.updateTerrainColors(grid);
    assert.equal(renderer.displayMode, 'sand depth');
    assert.equal(material.wireframe, false);
    assert.equal(material.color.r, 0.6);
    assert.equal(material.specular.r, 0);

    renderer.cycleDisplayMode();
    renderer.updateTerrainColors(grid);
    assert.equal(renderer.displayMode, 'flux');
    assert.equal(material.color.r, 1);
    assert.equal(material.specular.r, 17 / 255);

    renderer.cycleDisplayMode();
    recorded.length = 0;
    renderer.updateTerrainColors(grid);
    assert.equal(renderer.displayMode, 'sediment');
    assert.equal(material.color.r, 1);
    assert.equal(material.specular.r, 17 / 255);
    // Sediment flux is square-root scaled: with one vertex the normalised value
    // is t = 1, so the magenta gradient reaches its brightest end.
    const [, r, g, b] = recorded[0];
    assert.ok(r > b && b > g, `expected r > b > g, got r=${r} b=${b} g=${g}`);

    // With no water the flux is zero and the gradient sits at its dim end.
    grid.waterDepth = [0];
    grid.velocityX = [0];
    recorded.length = 0;
    renderer.updateTerrainColors(grid);
    const [, dimR, dimG, dimB] = recorded[0];
    assert.ok(dimB > dimR && dimR > dimG, `expected b > r > g, got b=${dimB} r=${dimR} g=${dimG}`);
});

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

test('status metrics update at most once per second', () => {
    const elements = {
        'contrib-count': { textContent: '' },
        'last-sync': { textContent: '' },
        'next-sync': { textContent: '' },
        'next-merge': { textContent: '' },
        'pending-contributions': { textContent: '' },
        'last-merge': { textContent: '' },
        'simulation-time': { textContent: '' },
        'mean-transit-time': { textContent: '' },
        'particle-throughput': { textContent: '' },
        'auth-status': { hidden: true, textContent: '', className: '' },
        'auth-button': { textContent: '' },
        'reset-container': { style: {} }
    };
    const auth = { isAuthenticated: false, isConfigured: () => true };
    const context = vm.createContext({ document: { getElementById: id => elements[id] } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8'), context);
    const UIManager = vm.runInContext('UIManager', context);
    const ui = new UIManager(auth, { canReset: () => false });
    let transitReads = 0;
    let fluxReads = 0;
    let secondsUntilMerge = 42;
    let lastMerge = { version: 31, contributors: 3, includesYou: true, secondsAgo: 720 };
    const collaboration = {
        activeCollaborators: 6,
        totalCollaborators: 37,
        onlineCollaborators: 3,
        pendingContributions: 1,
        getSecondsSinceSync: () => 12,
        getSecondsUntilSync: () => 288,
        getSecondsUntilMerge: () => secondsUntilMerge,
        getLastMerge: () => lastMerge
    };
    const simulationTime = { getTotal: () => 123.9 };
    const physics = {
        getMeanTransitTime: () => { transitReads++; return 12.36; },
        getParticleThroughput: () => { fluxReads++; return 0.125; }
    };

    ui.updateStatus(collaboration, physics, 0, simulationTime);
    ui.updateStatus(collaboration, physics, 500, simulationTime);
    assert.equal(transitReads, 1);
    assert.equal(fluxReads, 1);
    assert.equal(elements['mean-transit-time'].textContent, '12.4');
    assert.equal(elements['particle-throughput'].textContent, '0.13');
    assert.equal(elements['next-sync'].textContent, '288');
    assert.equal(elements['next-merge'].textContent, '42');
    assert.equal(elements['pending-contributions'].textContent, ' (1)');
    assert.equal(elements['contrib-count'].textContent, '37 (3)');
    assert.equal(elements['last-merge'].textContent, 'v31 · 3 ✓ · 12 min');
    assert.equal(elements['simulation-time'].textContent, 123);

    // An older Worker reports neither totals nor merges.
    secondsUntilMerge = null;
    lastMerge = null;
    collaboration.totalCollaborators = null;
    collaboration.onlineCollaborators = null;
    collaboration.pendingContributions = 0;
    ui.updateStatus(collaboration, physics, 1000, simulationTime);
    assert.equal(transitReads, 2);
    assert.equal(fluxReads, 2);
    assert.equal(elements['next-merge'].textContent, '--');
    assert.equal(elements['pending-contributions'].textContent, '');
    assert.equal(elements['contrib-count'].textContent, '6');
    assert.equal(elements['last-merge'].textContent, '--');

    lastMerge = { version: 32, contributors: 2, includesYou: false, secondsAgo: 7200 };
    ui.updateStatus(collaboration, physics, 2000, simulationTime);
    assert.equal(elements['last-merge'].textContent, 'v32 · 2 · 2 h');
});

test('cumulative simulation time persists across sessions and sums concurrent tabs', () => {
    const entries = new Map();
    const localStorage = {
        get length() { return entries.size; },
        key: i => [...entries.keys()][i] ?? null,
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: key => entries.delete(key)
    };
    const warnings = [];
    const context = vm.createContext({
        localStorage,
        console: { warn: message => warnings.push(message) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/local-storage.js'), 'utf8'), context);
    const Tracker = vm.runInContext('SimulationTimeTracker', context);
    const a = new Tracker();
    const b = new Tracker();
    a.add(12);
    b.add(5);
    a.save();
    b.save();
    a.add(3);
    assert.equal(a.getTotal(), 20);
    a.save();
    const reopened = new Tracker();
    reopened.add(2);
    assert.equal(reopened.getTotal(), 22);
    // An invalid stored value is skipped, not fatal.
    entries.set('tree-of-life-simulation-time-v1', 'bad');
    assert.equal(reopened.getTotal(), 2);
    assert.equal(warnings.length, 1);
});

test('legacy per-session keys are merged into the single key and removed', () => {
    const entries = new Map();
    const localStorage = {
        get length() { return entries.size; },
        key: i => [...entries.keys()][i] ?? null,
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: key => entries.delete(key)
    };
    entries.set('tree-of-life-simulation-time-v1:session-1', '10');
    entries.set('tree-of-life-simulation-time-v1:session-2', '4');
    entries.set('tree-of-life-simulation-time-v1:invalid', 'bad');
    entries.set('unrelated-key', 'ignored');
    const context = vm.createContext({
        localStorage,
        console: { warn: () => {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/local-storage.js'), 'utf8'), context);
    const Tracker = vm.runInContext('SimulationTimeTracker', context);
    const tracker = new Tracker();
    tracker.add(1);
    assert.equal(tracker.getTotal(), 15);
    assert.equal(entries.get('tree-of-life-simulation-time-v1'), '14');
    assert.equal(entries.has('tree-of-life-simulation-time-v1:session-1'), false);
    assert.equal(entries.has('tree-of-life-simulation-time-v1:session-2'), false);
    assert.equal(entries.has('tree-of-life-simulation-time-v1:invalid'), false);
    assert.equal(entries.get('unrelated-key'), 'ignored');
});

test('simulation loop accumulates and periodically saves model time', () => {
    const context = vm.createContext({
        URLSearchParams, console,
        document: { title: 'test' },
        window: { addEventListener() {} },
        performance: { now: () => 6000 },
        requestAnimationFrame() {}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/main.js'), 'utf8'), context);
    const Application = vm.runInContext('Application', context);
    let accumulated = 0;
    let saves = 0;
    const tracker = { add: dt => { accumulated += dt; }, save: () => { saves++; } };
    const app = {
        lastRenderTime: 0, lastBiologySaveTime: 0, frameCount: 0,
        physics: { step: () => 0.04 }, simulationTime: tracker,
        biology: { step() {} }, biologyStore: { save: () => true },
        renderer: { updateTerrainMesh() {}, updateParticles() {}, render() {} },
        ui: {
            updateStatus: (collaboration, physics, now, time) => assert.equal(time, tracker),
            showToast() {}
        },
        animate() {}
    };
    Application.prototype.animate.call(app);
    assert.equal(accumulated, 0.04);
    assert.equal(saves, 1);
});

test('status help opens and closes its overlay', () => {
    const handlers = {};
    let opened = false;
    const dialog = { showModal: () => { opened = true; }, close: () => { opened = false; } };
    const elements = {
        'status-help-dialog': dialog,
        'status-help-button': { addEventListener: (event, fn) => { handlers.open = fn; } },
        'status-help-close': { addEventListener: (event, fn) => { handlers.close = fn; } }
    };
    const context = vm.createContext({ document: { getElementById: id => elements[id] } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8'), context);
    const UIManager = vm.runInContext('UIManager', context);
    new UIManager({}, {}).setupEventListeners({}, {});
    handlers.open();
    assert.equal(opened, true);
    handlers.close();
    assert.equal(opened, false);
});

test('display mode is public while simulation controls remain admin-only', () => {
    const panel = { hidden: true };
    const controlsPanel = { hidden: true };
    const accessMessage = { hidden: true };
    const location = { search: '' };
    const auth = { isAuthenticated: false };
    let cycles = 0;
    let prevented = 0;
    const notices = [];
    const app = {
        auth,
        physics: { timeScale: 1 },
        ui: { showToast() {}, showDisplayMode(mode) { notices.push(mode); } },
        renderer: { cycleDisplayMode() { cycles++; }, displayMode: 'flux' }
    };
    const context = vm.createContext({
        URLSearchParams, window: { location, app },
        document: {
            getElementById: id => ({
                'help-panel': panel,
                'admin-controls': controlsPanel,
                'admin-access-message': accessMessage
            })[id]
        }
    });
    for (const file of ['ui.js', 'controls.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
    }
    const { UIManager, InputControls } = vm.runInContext('({ UIManager, InputControls })', context);
    const ui = new UIManager(auth, {});
    const controls = Object.create(InputControls.prototype);
    controls.renderer = app.renderer;
    const event = { key: 'd', preventDefault() { prevented++; } };

    ui.updateAdminPanel();
    controls.onKeyDown(event);
    assert.equal(panel.hidden, true);
    assert.equal(cycles, 1);
    assert.equal(prevented, 1);
    assert.deepEqual(notices, ['flux']);
    controls.onKeyDown({ key: 'd', target: { tagName: 'INPUT' }, preventDefault() { prevented++; } });
    controls.onKeyDown({ key: 'd', metaKey: true, preventDefault() { prevented++; } });
    controls.onKeyDown({
        key: 'd', target: { closest: () => true }, preventDefault() { prevented++; }
    });
    assert.equal(cycles, 1);
    assert.equal(prevented, 1);
    controls.onKeyDown({ key: 'ArrowUp', preventDefault() { prevented++; } });
    assert.equal(app.physics.timeScale, 1);

    location.search = '?admin';
    ui.updateAdminPanel();
    controls.onKeyDown(event);
    assert.equal(panel.hidden, false);
    assert.equal(controlsPanel.hidden, true);
    assert.equal(accessMessage.hidden, false);
    assert.equal(cycles, 2);
    controls.onKeyDown({ key: 'ArrowUp', preventDefault() { prevented++; } });
    assert.equal(app.physics.timeScale, 1);

    auth.isAuthenticated = true;
    ui.updateAdminPanel();
    controls.onKeyDown(event);
    assert.equal(controlsPanel.hidden, false);
    assert.equal(accessMessage.hidden, true);
    assert.equal(cycles, 3);
    controls.onKeyDown({ key: 'ArrowUp', preventDefault() { prevented++; } });
    assert.equal(app.physics.timeScale, 1.5);
    controls.onKeyDown({ key: '?', preventDefault() {} });
    assert.equal(panel.hidden, true);
    controls.onKeyDown({ key: '?', preventDefault() {} });
    assert.equal(panel.hidden, false);

    auth.isAuthenticated = false;
    ui.updateAdminPanel();
    controls.onKeyDown(event);
    assert.equal(controlsPanel.hidden, true);
    assert.equal(accessMessage.hidden, false);
    assert.equal(cycles, 4);
});

test('scrolling status help does not zoom the terrain', () => {
    const context = vm.createContext({ window: {}, document: {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/controls.js'), 'utf8'), context);
    const InputControls = vm.runInContext('InputControls', context);
    const controls = Object.create(InputControls.prototype);
    controls.camera = {
        position: { x: 0, y: 65, z: 0 },
        up: { set() {} },
        lookAt() {}
    };
    controls.cameraRotation = { x: 0, y: 0 };
    controls.cameraDistance = 65;
    let prevented = false;
    controls.onMouseWheel({
        deltaY: 1, target: { closest: () => true }, preventDefault() { prevented = true; }
    });
    assert.equal(prevented, false);
    assert.equal(controls.cameraDistance, 65);

    // Outside the canvas (and outside the help dialog), the wheel is left alone.
    controls.renderer = { canvas: {} };
    controls.onMouseWheel({
        deltaY: 1, target: { closest: () => null }, preventDefault() { prevented = true; }
    });
    assert.equal(prevented, false);
    assert.equal(controls.cameraDistance, 65);

    // On the canvas, the wheel zooms and is prevented.
    controls.onMouseWheel({
        deltaY: 1, target: controls.renderer.canvas, preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true);
    assert.equal(controls.cameraDistance, 65.5);
});

test('display mode notice stays visible for two seconds after the latest change', () => {
    const notice = { textContent: '', hidden: true };
    const callbacks = new Map();
    let nextTimer = 0;
    const context = vm.createContext({
        document: { getElementById: () => notice },
        setTimeout: (callback, delay) => {
            assert.equal(delay, 2000);
            callbacks.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout: id => callbacks.delete(id)
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8'), context);
    const UIManager = vm.runInContext('UIManager', context);
    const ui = new UIManager({}, {});
    ui.showDisplayMode('sand depth');
    ui.showDisplayMode('flux');
    assert.equal(notice.textContent, 'flux');
    assert.equal(notice.hidden, false);
    assert.equal(callbacks.size, 1);
    callbacks.get(2)();
    assert.equal(notice.hidden, true);
});

test('public view button uses the same display control', () => {
    let click;
    let cycles = 0;
    const button = { addEventListener: (event, handler) => { if (event === 'click') click = handler; } };
    const context = vm.createContext({
        window: { app: { controls: { cycleDisplayMode() { cycles++; } } } },
        document: { getElementById: id => id === 'display-mode-button' ? button : null }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui.js'), 'utf8'), context);
    const UIManager = vm.runInContext('UIManager', context);
    new UIManager({}, {}).setupEventListeners({}, {});
    click();
    assert.equal(cycles, 1);
});

test('reset URL cleanup retains the admin view and unrelated parameters', async () => {
    const location = { pathname: '/app/', search: '?admin&reset=1&keep=ok', hash: '#view' };
    let callback;
    let cleaned;
    let resets = 0;
    const context = vm.createContext({
        URLSearchParams,
        document: { title: 'test' },
        window: { location, addEventListener() {}, history: { replaceState: (s, t, url) => { cleaned = url; } } },
        setTimeout: fn => { callback = fn; }
    });

    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8'), context);
    const Application = vm.runInContext('Application', context);
    Application.prototype.handleUrlParams.call({
        reset: { canReset: () => true, softReset: async () => { resets++; return true; } },
        ui: { showToast() {} }
    });
    await callback();
    assert.equal(resets, 1);
    assert.equal(cleaned, '/app/?admin=&keep=ok#view');
});

test('URL resets are scheduled only after application initialization finishes', async () => {
    const context = vm.createContext({
        URLSearchParams, console,
        document: { title: 'test' },
        window: { addEventListener() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8'), context);
    const Application = vm.runInContext('Application', context);
    let finishSync, markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    let scheduled = false;
    const app = {
        ui: { showLoading() {}, updateAdminPanel() {}, updateAuthStatus() {}, showToast() {} },
        auth: { initialize: async () => {} },
        localStore: { load: () => false },
        biologyStore: { load: () => true },
        collaboration: { start: () => new Promise(resolve => {
            finishSync = resolve;
            markStarted();
        }) },
        biology: { updateSand() {} },
        renderer: { createTerrainMesh() {} },
        handleUrlParams: () => { scheduled = true; },
        animate() {}
    };
    const initializing = Application.prototype.initialize.call(app);
    await started;
    assert.equal(scheduled, false);
    finishSync();
    await initializing;
    assert.equal(scheduled, true);
});

test('full screen toggles with the F key and with clicks on the bottom bar', async () => {
    const calls = [];
    const toasts = [];
    let badgeClick;
    const badge = { addEventListener(event, handler) { if (event === 'click') badgeClick = handler; } };
    const documentElement = {
        requestFullscreen() {
            calls.push('request');
            doc.fullscreenElement = documentElement;
            return Promise.resolve();
        }
    };
    const doc = {
        fullscreenElement: null,
        documentElement,
        exitFullscreen() {
            calls.push('exit');
            doc.fullscreenElement = null;
            return Promise.resolve();
        },
        addEventListener() {},
        getElementById: id => id === 'status-badge' ? badge : null
    };
    const windowObject = {};
    const context = vm.createContext({ window: windowObject, document: doc });
    for (const file of ['controls.js', 'ui.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
    }
    const { InputControls, UIManager } = vm.runInContext('({ InputControls, UIManager })', context);
    const controls = new InputControls({ camera: { position: { x: 0, y: 64, z: 0 } } });
    windowObject.app = { controls, ui: { showToast: message => toasts.push(message) } };
    new UIManager({}, {}).setupEventListeners({}, {});

    let prevented = 0;
    const press = (event) => controls.onKeyDown({ key: 'f', target: {}, preventDefault() { prevented++; }, ...event });
    press({});
    assert.deepEqual(calls, ['request']);
    assert.equal(prevented, 1);

    press({ repeat: true });
    press({ target: { tagName: 'INPUT' } });
    press({ ctrlKey: true });
    assert.deepEqual(calls, ['request']);

    badgeClick({ target: { closest: () => ({}) } });
    assert.deepEqual(calls, ['request']);
    badgeClick({ target: { closest: () => null } });
    assert.deepEqual(calls, ['request', 'exit']);

    doc.documentElement.requestFullscreen = () => Promise.reject(new Error('refused'));
    press({});
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(toasts, ['Full screen was refused by the browser']);
});
