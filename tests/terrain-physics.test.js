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

test('semi-circular bed has 8196 nondegenerate faces and a uniform radial slope', () => {
    const grid = new TerrainGrid();
    assert.equal(grid.triangles.length, 8196);
    assert.ok(grid.vertexArea.every(area => area > 0));
    grid.vertices.forEach((point, i) => {
        assert.ok(point.z <= 1e-12);
        assert.ok(Math.abs(grid.bedrock[i] - grid.slope * Math.hypot(point.x, point.z)) < 1e-12);
        assert.ok(Math.abs(grid.elevation[i] - grid.bedrock[i] - grid.initialSandDepth) < 1e-12);
    });
    const outerStart = 1 + (grid.rings - 1) * (grid.sectors + 1);
    for (let s = 0; s <= grid.sectors; s++) {
        const point = grid.vertices[outerStart + s];
        assert.ok(Math.abs(Math.hypot(point.x, point.z) - grid.radius) < 1e-12);
    }
});

test('water is injected and reflected at the polygonal arc boundary', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    for (const fraction of [0.01, 0.123, 0.25, 0.501, 0.9, 0.99]) {
        const particle = { x: 0, z: 0, vx: 0, vz: 0, sediment: 0.1 };
        physics.reinject(particle, fraction);
        const angle = Math.PI * fraction;
        const boundary = physics.arcBoundary(angle);
        assert.ok(Math.abs(Math.hypot(particle.x, particle.z) / boundary.radius - 0.999) < 1e-12);
        assert.ok(grid.sample(particle.x, particle.z));
        particle.vx = boundary.nx * 3;
        particle.vz = boundary.nz * 3;
        physics.g = 0;
        physics.friction = 0;
        physics.moveParticle(particle, 0.04);
        assert.ok(grid.sample(particle.x, particle.z));
        assert.ok(particle.vx * boundary.nx + particle.vz * boundary.nz < 0);
    }
});

test('sink recycles the parcel and its sediment; the remaining straight edge reflects it', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const particle = { x: 0.1, z: -0.1, vx: 0, vz: 0, sediment: 1 };
    physics.moveParticle(particle, 0.04);
    assert.ok(Math.hypot(particle.x, particle.z) > grid.radius * 0.98);
    assert.ok(particle.sediment > 0.9);
    const cargo = particle.sediment;
    physics.reinject(particle, 0.5);
    assert.equal(particle.sediment, cargo);
    assert.ok(Math.hypot(particle.x, particle.z) > grid.radius * 0.98);
    const blocked = { x: 5, z: -0.001, vx: 0, vz: 1, sediment: 0 };
    physics.moveParticle(blocked, 0.04);
    assert.ok(blocked.z < 0 && blocked.vz < 0 && blocked.x < 6);
    physics.g = 0;
    physics.friction = 0;
    physics.maxSpeed = 100;
    const crossing = { x: -2, z: -0.1, vx: 100, vz: 0, sediment: 1 };
    physics.moveParticle(crossing, 0.04);
    assert.ok(Math.hypot(crossing.x, crossing.z) > grid.radius * 0.98);
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
    face.forEach(i => { grid.elevation[i] = 1; });
    const before = totalSediment(grid, physics);
    physics.moveParticle(particle, 0.04);
    assert.ok(Math.hypot(particle.vx, particle.vz) < 2);
    assert.ok(particle.sediment > 0 && particle.sediment < 0.001);
    assert.ok(face.some(i => grid.elevation[i] > 1));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-10);
});

test('sand avalanches at steep mesh edges without disturbing a stable slope', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
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

test('version 5 terrain migrates to the steeper bed without losing sand or particle state', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const old = grid.toJSON();
    old.version = '5.0';
    old.elevation = grid.vertices.map((point, i) =>
        0.06 * Math.hypot(point.x, point.z) + 0.1 + (i % 5) * 0.03);
    old.particles[0].sediment = 0.2;
    const expectedSand = old.elevation.reduce((sum, height, i) =>
        sum + (height - 0.06 * Math.hypot(grid.vertices[i].x, grid.vertices[i].z)) * grid.vertexArea[i], 0);
    assert.equal(grid.fromJSON(old), true);
    assert.ok(Math.abs(totalSediment(grid, physics) - expectedSand - 0.2) < 1e-8);
    assert.equal(physics.particles[0].sediment, 0.2);
    assert.equal(grid.toJSON().version, '6.0');
    const migrated = grid.toJSON();
    assert.equal(grid.fromJSON(migrated), true);
    assert.ok(grid.elevation.every((height, i) => height === migrated.elevation[i]));
    old.elevation[1] = -1;
    assert.equal(grid.fromJSON(old), false);
    assert.ok(grid.elevation.every((height, i) => height === migrated.elevation[i]));
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
