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
    class Scene { add() {} }
    class Light { constructor() { this.position = new Vector(); } }
    const THREE = {
        Scene, Color: class {}, PerspectiveCamera: Camera,
        WebGLRenderer: class { setSize() {} }, AmbientLight: Light, DirectionalLight: Light,
        Object3D: class {}
    };
    const window = { innerWidth: 1200, innerHeight: 800, addEventListener() {} };
    const context = vm.createContext({ THREE, window, document: { addEventListener() {} } });
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

    controls.onMouseWheel({ deltaY: -1, preventDefault() {} });
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
});

test('mesh view shows the wireframe and particles without biology', () => {
    class Color {
        setRGB(r, g, b) { Object.assign(this, { r, g, b }); }
    }
    const context = vm.createContext({ THREE: { Color } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/renderer.js'), 'utf8'), context);
    const TerrainRenderer = vm.runInContext('TerrainRenderer', context);
    const renderer = Object.create(TerrainRenderer.prototype);
    const colors = { setXYZ() {} };
    const material = { color: new Color(), specular: new Color(), wireframe: false };
    renderer.terrainMesh = {
        material,
        geometry: { attributes: { color: colors, position: { array: [0, 0, 0] } }, computeVertexNormals() {} }
    };
    renderer.biologyMesh = { visible: true };
    renderer.particleMesh = { visible: true };
    const grid = {
        elevation: [0.3], bedrock: [0], initialSandDepth: 0.3, erodibleCount: 1,
        waterDepth: [0], velocityX: [0], velocityY: [0], sediment: [0]
    };
    renderer.displayMode = 'elevation';
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
    const collaboration = { activeCollaborators: 6, getSecondsSinceSync: () => 12 };
    const physics = {
        getMeanTransitTime: () => { transitReads++; return 12.36; },
        getParticleThroughput: () => { fluxReads++; return 0.125; }
    };

    ui.updateStatus(collaboration, physics, 0);
    ui.updateStatus(collaboration, physics, 500);
    assert.equal(transitReads, 1);
    assert.equal(fluxReads, 1);
    assert.equal(elements['mean-transit-time'].textContent, '12.4');
    assert.equal(elements['particle-throughput'].textContent, '0.13');

    ui.updateStatus(collaboration, physics, 1000);
    assert.equal(transitReads, 2);
    assert.equal(fluxReads, 2);
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
