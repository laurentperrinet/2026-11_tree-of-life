const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ console, Math, Float64Array, Date });
for (const name of ['terrain', 'physics']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
}
const { TerrainGrid, PhysicsEngine } = vm.runInContext('({ TerrainGrid, PhysicsEngine })', context);

function totalSediment(grid, physics) {
    return grid.elevation.reduce((sum, height, i) => sum + (height - grid.bedrock[i]) * grid.vertexArea[i], 0) +
        physics.particles.reduce((sum, particle) => sum + particle.sediment, 0);
}

test('vegetation grows on sandy banks, not in the flow, and stays rooted when water leaves', () => {
    const grid = {
        elevation: Float64Array.from([1, 1, 1, 0, 1, 1, 1]),
        bedrock: new Float64Array(7),
        waterDepth: Float64Array.from([1, 0, 0, 0, 0, 0, 0]),
        velocityX: Float64Array.from([1, 0, 0, 0, 0, 0, 0]),
        velocityY: new Float64Array(7),
        flowHistory: new Float32Array(7),
        vegetation: new Float32Array(7),
        mushroomSites: [],
        mushrooms: new Float32Array(0),
        erodibleCount: 6,
        edges: Array.from({ length: 5 }, (_, i) => ({ a: i, b: i + 1, length: 0.25 }))
    };
    const physics = Object.create(PhysicsEngine.prototype);
    physics.grid = grid;
    physics.nearbyFlow = new Float32Array(7);
    physics.flowScratch = new Float32Array(7);
    physics.flowEdgeWeights = Float32Array.from(grid.edges, edge => Math.exp(-edge.length / 0.6));
    physics.vegetationElapsed = 0;
    for (let i = 0; i < 200; i++) physics.updateVegetation(0.1);
    assert.equal(grid.vegetation[0], 0);
    assert.ok(grid.vegetation[1] > 0.3);
    assert.equal(grid.vegetation[3], 0);
    assert.equal(grid.vegetation[5], 0);
    assert.equal(grid.vegetation[6], 0);
    const rooted = Array.from(grid.vegetation);
    grid.waterDepth.fill(0);
    for (let i = 0; i < 200; i++) physics.updateVegetation(0.1);
    assert.ok(grid.vegetation.every((value, i) => value >= rooted[i]));
    const paused = Array.from(grid.vegetation);
    physics.updateVegetation(0);
    assert.deepEqual(Array.from(grid.vegetation), paused);
});

test('mushrooms grow on sandy, low-flow sites beside plants and remain rooted', () => {
    const grid = {
        mushroomSites: [0, 1, 2, 3, 4],
        mushrooms: new Float32Array(5),
        elevation: Float64Array.from([1, 1, 1, 0, 1, 1, 1]),
        bedrock: new Float64Array(7),
        vegetation: Float32Array.from([0.1, 0.1, 0.1, 0.1, 0.8, 0.3, 0]),
        flowHistory: Float32Array.from([0.001, 0.03, 0.001, 0.001, 0.001, 0, 0])
    };
    const physics = Object.create(PhysicsEngine.prototype);
    physics.grid = grid;
    physics.mushroomNeighbors = [[5], [5], [6], [5], [5]];
    const nearby = Float32Array.from([0.01, 0.04, 0.01, 0.01, 0.01, 0, 0]);
    physics.updateMushrooms(20, nearby);
    assert.ok(grid.mushrooms[0] > 0.5);
    assert.deepEqual(Array.from(grid.mushrooms.slice(1)), [0, 0, 0, 0]);
    const grown = grid.mushrooms[0];
    grid.flowHistory[0] = 0.1;
    physics.updateMushrooms(20, nearby);
    assert.equal(grid.mushrooms[0], grown);
});

test('mushroom meshes follow their terrain vertices and are hidden in diagnostic views', () => {
    class Color {
        constructor(value = 0) { this.value = value; }
        copy(other) { this.value = other.value; return this; }
        lerp(other, t) { this.value += (other.value - this.value) * t; return this; }
    }
    const rendererContext = vm.createContext({ THREE: { Color }, Math });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8'), rendererContext);
    const renderer = vm.runInContext('Object.create(TerrainRenderer.prototype)', rendererContext);
    const mesh = () => ({
        matrices: [], colors: [], instanceMatrix: {},
        setMatrixAt(i, matrix) { this.matrices[i] = matrix; },
        setColorAt(i, color) { this.colors[i] = color.value; this.instanceColor = {}; }
    });
    renderer.mushroomCaps = mesh();
    renderer.mushroomStems = mesh();
    renderer.dummy = {
        position: { set(x, y, z) { Object.assign(this, { x, y, z }); } },
        scale: { set(x, y, z) { Object.assign(this, { x, y, z }); } },
        updateMatrix() { this.matrix = { position: { ...this.position }, scale: { ...this.scale } }; }
    };
    renderer.displayMode = 'elevation';
    const grid = {
        mushroomSites: [0, 1, 2], mushrooms: [0, 0.5, 0.5],
        vertices: [{ x: 0, z: 0 }, { x: 2, z: 3 }, { x: 4, z: 5 }],
        elevation: [0, 7, 9]
    };
    renderer.updateMushrooms(grid);
    assert.equal(renderer.mushroomCaps.count, 2);
    assert.equal(renderer.mushroomStems.count, 2);
    const stem = renderer.mushroomStems.matrices[0];
    assert.equal(stem.position.x, 2);
    assert.ok(Math.abs(stem.position.y - stem.scale.y / 2 - 7) < 1e-10);
    assert.notEqual(renderer.mushroomCaps.colors[0], renderer.mushroomCaps.colors[1]);
    grid.elevation[1] = 8;
    renderer.updateMushrooms(grid);
    assert.ok(renderer.mushroomStems.matrices[0].position.y > stem.position.y);
    renderer.displayMode = 'flux';
    renderer.updateMushrooms(grid);
    assert.equal(renderer.mushroomCaps.visible, false);
    assert.equal(renderer.mushroomStems.visible, false);
});

test('terrain sync keeps established vegetation from either contributor', () => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'github-sync.js'), 'utf8'), context);
    const sync = vm.runInContext('new GitHubSync()', context);
    const local = { version: '10.0', topology: 'disk', elevation: [1, 1], vegetation: [0.7, 0.1],
        mushrooms: [0.6, 0.1] };
    const remote = { ...local, vegetation: [0.2, 0.8], mushrooms: [0.2, 0.9] };
    const merged = sync.mergeTerrain(local, remote);
    assert.deepEqual(Array.from(merged.vegetation), [0.7, 0.8]);
    assert.deepEqual(Array.from(merged.mushrooms), [0.6, 0.9]);
    assert.deepEqual(Array.from(sync.mergeTerrain(local, { ...remote, vegetation: undefined }).vegetation),
        [0.7, 0.1]);
    assert.equal(sync.mergeTerrain(local, { ...remote, vegetation: [2, 0] }), local);
    assert.equal(sync.mergeTerrain(local, { ...remote, mushrooms: [-1, 0] }), local);
});

test('polar mesh covers a full disk and its square surround', () => {
    const grid = new TerrainGrid();
    assert.ok(grid.vertices.length > 4096);
    assert.ok(grid.triangles.length > 8192);
    assert.ok(grid.vertexArea.every(area => area > 0));
    let area = 0;
    for (const face of grid.triangles) {
        const [a, b, c] = face.map(i => grid.vertices[i]);
        const signedArea = ((b.z - a.z) * (c.x - a.x) -
            (b.x - a.x) * (c.z - a.z)) / 2;
        assert.ok(signedArea > 0);
        area += signedArea;
    }
    assert.ok(Math.abs(area - 4 * grid.halfSize ** 2) < 1e-8);
    assert.ok(new Set(grid.ringVertices.map(ring => ring.length)).size > 1);
    assert.ok(grid.ringAngles[4][1] !== 2 * Math.PI / grid.ringVertices[4].length);
    grid.vertices.forEach((point, i) => {
        assert.ok(Math.abs(grid.bedrock[i] - grid.bedrockHeight(point.x, point.z)) < 1e-12);
        assert.ok(Math.abs(grid.elevation[i] - grid.bedrock[i] - grid.initialSandDepth) < 1e-12);
    });
    const outerRing = grid.ringVertices[grid.rings - 1];
    for (let s = 0; s < grid.sectors; s++) {
        const point = grid.vertices[outerRing[s]];
        assert.ok(Math.abs(Math.hypot(point.x, point.z) - grid.radius) < 1e-12);
    }
    for (let x = -29; x <= 29; x += 2) {
        for (let z = -29; z <= 29; z += 2) {
            assert.ok(grid.sample(x, z), `missing mesh at ${x},${z}`);
        }
    }
});

test('water is reinjected inside the erodible disk around the entire boundary', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    for (let n = 0; n < 128; n++) {
        const fraction = (n + 0.5) / 128;
        const particle = { x: 0, z: 0, vx: 0, vz: 0, sediment: 0.1 };
        physics.reinject(particle, fraction);
        const angle = 2 * Math.PI * fraction;
        const boundary = physics.arcBoundary(angle);
        assert.ok(Math.abs(Math.hypot(particle.x, particle.z) -
            (boundary.radius - 3 * grid.radius / grid.rings)) < 1e-12);
        assert.ok(grid.sample(particle.x, particle.z).face.every(i => i < grid.erodibleCount));
    }
    const particle = { x: 0, z: 0, vx: 0, vz: 0, sediment: 0 };
    physics.reinject(particle, 0.25);
    const before = Math.hypot(particle.x, particle.z);
    physics.moveParticle(particle, 0.04);
    assert.ok(Math.hypot(particle.x, particle.z) < before);
});

test('sink at the bottom of the square recycles sediment; other edges reflect', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    physics.g = 0;
    physics.friction = 0;
    const particle = { x: 0.1, z: grid.halfSize - 0.01, vx: 0, vz: 1, sediment: 1 };
    physics.moveParticle(particle, 0.04);
    assert.ok(Math.hypot(particle.x, particle.z) > grid.radius - 1);
    assert.ok(particle.sediment > 0.9);
    const cargo = particle.sediment;
    physics.reinject(particle, 0.5);
    assert.equal(particle.sediment, cargo);
    assert.ok(Math.hypot(particle.x, particle.z) > grid.radius - 1);
    const blocked = { x: 5, z: grid.halfSize - 0.01, vx: 0, vz: 1, sediment: 0 };
    physics.moveParticle(blocked, 0.04);
    assert.ok(blocked.z < grid.halfSize && blocked.vz < 0 && blocked.x < 6);
    physics.maxSpeed = 100;
    const crossing = { x: -2, z: grid.halfSize - 0.1, vx: 50, vz: 5, sediment: 1 };
    physics.moveParticle(crossing, 0.04);
    assert.ok(Math.hypot(crossing.x, crossing.z) > grid.radius - 1);
    assert.ok(crossing.sediment > 0);
});

test('collisions exchange momentum and push overlapping water parcels apart', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const a = { x: 10, z: -5, vx: 1, vz: 0, sediment: 0.1 };
    const b = { x: 10.1, z: -5, vx: -1, vz: 0, sediment: 0.2 };
    physics.particles = [a, b];
    physics.collideParticles(0.04);
    assert.ok(a.vx < 1 && b.vx > -1);
    assert.ok(Math.abs(a.vx + b.vx) < 1e-12);
    assert.ok(b.vx - a.vx > 0);
    assert.equal(a.sediment, 0.1);
    assert.equal(b.sediment, 0.2);
});

test('stationary water gradually deposits its sediment in a hollow', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    physics.g = 0;
    const particle = physics.particles[0];
    Object.assign(particle, { x: 10, z: -5, vx: 0, vz: 0, sediment: 0.1 });
    const face = grid.sample(particle.x, particle.z).face;
    face.forEach(i => { grid.elevation[i] = grid.bedrock[i]; });
    const before = totalSediment(grid, physics);
    for (let i = 0; i < 100; i++) physics.moveParticle(particle, 0.04);
    assert.ok(particle.sediment < 0.0001);
    assert.ok(face.some(i => grid.elevation[i] > grid.bedrock[i]));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-10);
});

test('erosion stops at bedrock, but sediment can be deposited on it', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const particle = physics.particles[0];
    particle.x = 10;
    particle.z = -5;
    particle.vx = 2;
    particle.vz = 0;
    particle.sediment = 0;
    const face = grid.sample(particle.x, particle.z).face;
    face.forEach(i => { grid.elevation[i] = grid.bedrock[i]; });
    grid.elevation[face[0]] += 1e-10;
    const available = (grid.elevation[face[0]] - grid.bedrock[face[0]]) * grid.vertexArea[face[0]];
    physics.moveParticle(particle, 0.04);
    assert.ok(face.every(i => grid.elevation[i] === grid.bedrock[i]));
    assert.ok(Math.abs(particle.sediment - available) < 1e-15);

    particle.x = 10;
    particle.z = -5;
    particle.vx = 0;
    particle.vz = 0;
    particle.sediment = 1;
    const before = totalSediment(grid, physics);
    physics.moveParticle(particle, 0.04);
    assert.ok(face.some(i => grid.elevation[i] > grid.bedrock[i]));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-10);
});

test('a loaded particle deposits sand when it slows, even below transport capacity', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const particle = physics.particles[0];
    Object.assign(particle, { x: 10, z: -5, vx: 2, vz: 0, sediment: 0.001 });
    const face = grid.sample(particle.x, particle.z).face;
    const level = Math.max(...face.map(i => grid.bedrock[i])) + 0.3;
    face.forEach(i => { grid.elevation[i] = level; });
    const before = totalSediment(grid, physics);
    physics.moveParticle(particle, 0.04);
    assert.ok(Math.hypot(particle.vx, particle.vz) < 2);
    assert.ok(particle.sediment > 0 && particle.sediment < 0.001);
    assert.ok(face.some(i => grid.elevation[i] > level));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-10);
});

test('sand avalanches at steep mesh edges without disturbing a stable slope', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const flatHeight = Math.max(...grid.bedrock) + 0.3;
    grid.elevation.fill(flatHeight);
    const initial = Array.from(grid.elevation);
    physics.relaxSand(0.04);
    assert.ok(grid.elevation.every((height, i) => height === initial[i]));

    grid.elevation[1] += 3;
    const before = totalSediment(grid, physics);
    const peak = grid.elevation[1];
    for (let i = 0; i < 20; i++) physics.relaxSand(0.04);
    assert.ok(grid.elevation[1] < peak - 2);
    assert.ok(grid.edges.every(edge =>
        Math.abs(grid.elevation[edge.a] - grid.elevation[edge.b]) / edge.length <
            physics.sandReposeSlope + 0.01));
    assert.ok(grid.elevation.every((height, i) => height >= grid.bedrock[i]));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-8);
});

test('saves from the previous planar bed are rejected, current ones round-trip', () => {
    const grid = new TerrainGrid();
    grid.vegetation[1] = 0.5;
    grid.flowHistory[1] = 0.1;
    grid.mushrooms[0] = 0.75;
    const saved = grid.toJSON();
    assert.equal(saved.version, '10.0');
    for (const version of ['5.0', '6.0', '7.0', '9.0']) assert.equal(grid.fromJSON({ ...saved, version }), false);
    assert.equal(grid.fromJSON(saved), true);
    grid.initialize();
    assert.equal(grid.vegetation[1], 0);
    assert.equal(grid.mushrooms[0], 0);
    assert.equal(grid.fromJSON(saved), true);
    assert.equal(grid.vegetation[1], 0.5);
    assert.equal(grid.mushrooms[0], 0.75);
    assert.ok(Math.abs(grid.flowHistory[1] - 0.1) < 1e-6);
    assert.equal(grid.fromJSON({ ...saved, vegetation: undefined, flowHistory: undefined, mushrooms: undefined }), true);
    assert.equal(grid.vegetation[1], 0);
    assert.equal(grid.mushrooms[0], 0);
    assert.equal(grid.fromJSON({ ...saved, vegetation: [NaN] }), false);
    assert.equal(grid.fromJSON({ ...saved, mushrooms: [2] }), false);
    saved.elevation[grid.erodibleCount] += 1;
    assert.equal(grid.fromJSON(saved), false);
});

test('inverted cone drains through a flared channel towards the bottom sink', () => {
    const grid = new TerrainGrid();
    for (const z of [-20, -10, -5]) {
        assert.ok(Math.abs(grid.bedrockHeight(0, z) - grid.slope * Math.abs(z)) < 1e-12);
    }
    for (const z of [1, 5, 15, 25, 30]) {
        assert.ok(Math.abs(grid.bedrockHeight(0, z) + grid.slope * z) < 1e-12);
        const width = grid.sinkRadius + grid.channelFlare * z;
        assert.ok(Math.abs(grid.bedrockHeight(width, z) -
            grid.slope * Math.min(grid.radius, Math.hypot(width, z))) < 1e-12);
    }
    assert.ok(grid.bedrockHeight(2, 20) < grid.slope * Math.hypot(2, 20));
});

test('fixed surround never gains or loses sediment', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const before = Array.from(grid.elevation.slice(grid.erodibleCount));
    const particle = { x: 0, z: 28, vx: 0, vz: 0, sediment: 1 };
    for (let i = 0; i < 10; i++) physics.moveParticle(particle, 0.04);
    physics.relaxSand(0.04);
    assert.deepEqual(Array.from(grid.elevation.slice(grid.erodibleCount)), before);
    assert.equal(particle.sediment, 1);
});

test('particle flow produces localized erosion on the initially uniform slope', () => {
    let seed = 123456789;
    const seededMath = Object.create(Math);
    seededMath.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const seededContext = vm.createContext({ console, Math: seededMath, Float64Array, Date });
    for (const name of ['terrain', 'physics']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), seededContext);
    }
    const { grid, physics } = vm.runInContext(
        'const grid = new TerrainGrid(); const physics = new PhysicsEngine(grid); ({ grid, physics })',
        seededContext
    );
    const before = totalSediment(grid, physics);
    for (let i = 0; i < 4000; i++) physics.step();
    let eroded = 0;
    let littleChanged = 0;
    grid.vertices.forEach((point, i) => {
        const radius = Math.hypot(point.x, point.z);
        if (radius < 8 || radius > 22) return;
        const depth = grid.bedrock[i] + grid.initialSandDepth - grid.elevation[i];
        if (depth > 0.01) eroded++;
        if (depth < 0.005) littleChanged++;
    });
    assert.ok(eroded > 200 && littleChanged > 200);
    assert.ok(grid.elevation.every((height, i) => Number.isFinite(height) && height >= grid.bedrock[i]));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-8);
});

test('closed cycle conserves sediment and survives a save and reload', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const initial = totalSediment(grid, physics);
    let recycled = 0;
    const reinject = physics.reinject.bind(physics);
    physics.reinject = (...args) => { recycled++; reinject(...args); };
    for (let i = 0; i < 1800; i++) physics.step();
    assert.ok(recycled > 0);
    assert.ok(Math.abs(totalSediment(grid, physics) - initial) < 1e-8);
    assert.ok(grid.elevation.every((height, i) => height >= grid.bedrock[i]));
    assert.ok(physics.particles.every(p => grid.locate(p.x, p.z) && p.sediment >= 0));
    const saved = JSON.parse(JSON.stringify(grid.toJSON()));
    const restoredGrid = new TerrainGrid();
    const restoredPhysics = new PhysicsEngine(restoredGrid);
    assert.equal(restoredGrid.fromJSON(saved), true);
    assert.ok(Math.abs(totalSediment(restoredGrid, restoredPhysics) - totalSediment(grid, physics)) < 1e-8);
    assert.equal(restoredPhysics.particles[0].x, physics.particles[0].x);
    assert.equal(restoredGrid.fromJSON({ ...saved, topology: 'old' }), false);
    assert.equal(restoredGrid.fromJSON({ ...saved, version: '4.0' }), false);
    saved.elevation[0] = restoredGrid.bedrock[0] - 1;
    assert.equal(restoredGrid.fromJSON(saved), false);
});
