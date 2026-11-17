const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ console, Math, Float64Array, Date, btoa, atob });
for (const name of ['terrain', 'physics', 'biology']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
}
const { TerrainGrid, PhysicsEngine, BiologyGrid } = vm.runInContext('({ TerrainGrid, PhysicsEngine, BiologyGrid })', context);

function totalSediment(grid, physics) {
    return grid.elevation.reduce((sum, height, i) => sum + (height - grid.bedrock[i]) * grid.vertexArea[i], 0) +
        physics.particles.reduce((sum, particle) => sum + particle.sediment, 0);
}

test('local colonies grow on wet sandy banks and microbes diffuse only through suitable habitat', () => {
    const biology = Object.create(BiologyGrid.prototype);
    biology.size = 5;
    for (const name of ['active', 'sand', 'flow', 'plants', 'inhibitor', 'microbeU', 'microbeV', 'microbeSeeds',
        'nearby', 'scratch', 'nearbyPlants', 'plantScratch', 'nextPlants', 'nextInhibitor', 'nextU', 'nextV', 'habitat']) {
        biology[name] = new Float32Array(25);
    }
    biology.active.fill(1);
    biology.sand.fill(1);
    biology.microbeU.fill(1);
    biology.flow[12] = 0.03;
    biology.sand[7] = 0;
    biology.microbeV[6] = 0.25;
    biology.microbeU[6] = 0.5;
    biology.updateColonies(0.2);
    assert.ok(biology.plants[11] > 0);
    assert.equal(biology.plants[12], 0);
    assert.equal(biology.plants[7], 0);
    assert.equal(biology.microbeV[7], 0);
    for (let i = 0; i < 10; i++) biology.updateColonies(0.2);
    assert.ok(biology.microbeU.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(biology.microbeV.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
});

test('local biology round-trips independently of the shared terrain', () => {
    const grid = new TerrainGrid();
    const biology = new BiologyGrid(grid);
    assert.ok(biology.active.reduce((sum, value) => sum + value, 0) > grid.erodibleCount);
    const i = biology.active.findIndex(value => value);
    biology.plants[i] = 0.5;
    biology.inhibitor[i] = 0.2;
    biology.microbeV[i] = 0.3;
    const saved = biology.toJSON();
    assert.equal(grid.toJSON().vegetation, undefined);
    assert.equal(grid.toJSON().microbeV, undefined);
    biology.reset();
    assert.equal(biology.fromJSON(saved), true);
    assert.ok(Math.abs(biology.plants[i] - 0.5) <= 1 / 65535);
    assert.ok(Math.abs(biology.inhibitor[i] - 0.2) <= 1 / 65535);
    assert.ok(Math.abs(biology.microbeV[i] - 0.3) <= 1 / 65535);
    biology.microbeV.fill(0);
    const extinct = biology.toJSON();
    assert.equal(biology.fromJSON(extinct), true);
    assert.ok(biology.microbeSeeds.some(value => value > 0));
    assert.ok(Math.abs(biology.plants[i] - 0.5) <= 1 / 65535);
    assert.equal(biology.fromJSON({ ...saved, size: 2 }), false);
});

test('extinct microbes recover near plants and disappear far away', () => {
    const biology = Object.create(BiologyGrid.prototype);
    biology.size = 65;
    biology.terrain = { radius: 5 };
    biology.spacing = 10 / 64;
    const count = biology.size ** 2;
    for (const name of ['active', 'sand', 'flow', 'plants', 'inhibitor', 'microbeU', 'microbeV', 'microbeSeeds',
        'nearby', 'scratch', 'nearbyPlants', 'plantScratch', 'nextPlants', 'nextInhibitor', 'nextU', 'nextV', 'habitat']) {
        biology[name] = new Float32Array(count);
    }
    for (let z = 1; z < 64; z++) {
        for (let x = 1; x < 64; x++) biology.active[z * 65 + x] = biology.sand[z * 65 + x] = 1;
    }
    biology.updateSand = () => {};
    biology.reset();
    biology.microbeV.fill(0);
    for (let z = 8; z <= 56; z++) {
        for (let x = 15; x <= 18; x++) biology.plants[z * 65 + x] = 0.2;
    }
    biology.microbeV[32 * 65 + 50] = 0.2;
    for (let step = 0; step < 200; step++) {
        biology.updateColonies(0.2);
        for (let z = 8; z <= 56; z++) {
            for (let x = 15; x <= 18; x++) biology.plants[z * 65 + x] = 0.2;
        }
    }
    let nearMax = 0, nearVisible = 0;
    for (let z = 8; z <= 56; z++) {
        for (let x = 19; x <= 26; x++) {
            const v = biology.microbeV[z * 65 + x];
            nearMax = Math.max(nearMax, v);
            if (v > 0.1) nearVisible++;
        }
    }
    assert.ok(nearMax > 0.1 && nearVisible > 0);
    assert.ok(biology.microbeV[32 * 65 + 50] < 0.001);
    biology.flow.fill(0.04);
    for (let step = 0; step < 100; step++) {
        biology.updateColonies(0.2);
        for (let z = 8; z <= 56; z++) {
            for (let x = 15; x <= 18; x++) biology.plants[z * 65 + x] = 0.2;
        }
    }
    assert.ok(biology.microbeV[32 * 65 + 19] < 0.001);
    biology.flow.fill(0);
    biology.plants.fill(0);
    biology.microbeV[32 * 65 + 19] = 0.2;
    for (let step = 0; step < 100; step++) biology.updateColonies(0.2);
    assert.ok(biology.microbeV[32 * 65 + 19] < 0.001);
});

test('crowded plant centers fade while the colony edge remains brighter', () => {
    const biology = Object.create(BiologyGrid.prototype);
    biology.size = 25;
    for (const name of ['active', 'sand', 'flow', 'plants', 'inhibitor', 'microbeU', 'microbeV', 'microbeSeeds',
        'nearby', 'scratch', 'nearbyPlants', 'plantScratch', 'nextPlants', 'nextInhibitor', 'nextU', 'nextV', 'habitat']) {
        biology[name] = new Float32Array(625);
    }
    biology.active.fill(1);
    biology.sand.fill(1);
    biology.microbeU.fill(1);
    for (let z = 0; z < biology.size; z++) {
        biology.flow[z * biology.size + 8] = 0.03;
        for (let x = 0; x < biology.size; x++) {
            if ((x - 11) ** 2 + (z - 12) ** 2 <= 4) biology.plants[z * biology.size + x] = 0.8;
        }
    }
    const center = 12 * biology.size + 11;
    for (let i = 0; i < 10; i++) biology.updateColonies(0.2);
    assert.ok(biology.inhibitor[center] > 0.1);
    assert.ok(biology.plants[center] < 0.6);
    assert.ok(biology.inhibitor[center] > biology.inhibitor[center + 3] + 0.1);
    biology.sand[center] = 0;
    const before = biology.plants[center];
    biology.updateColonies(0.2);
    assert.ok(biology.plants[center] < before);
});

test('microorganisms spread farther than plants under the same conditions', () => {
    const biology = Object.create(BiologyGrid.prototype);
    biology.size = 7;
    for (const name of ['active', 'sand', 'flow', 'plants', 'inhibitor', 'microbeU', 'microbeV', 'microbeSeeds',
        'nearby', 'scratch', 'nearbyPlants', 'plantScratch', 'nextPlants', 'nextInhibitor', 'nextU', 'nextV', 'habitat']) {
        biology[name] = new Float32Array(49);
    }
    biology.active.fill(1);
    biology.sand.fill(1);
    biology.microbeU.fill(1);
    biology.plants.fill(0.2);
    const center = 3 * biology.size + 3;
    biology.plants[center] = 0.3;
    biology.microbeV[center] = 0.1;
    biology.updateColonies(0.2);
    assert.ok(biology.plants[center + 1] > 0.2);
    assert.ok(biology.microbeV[center + 1] > biology.plants[center + 1] - 0.2);
});

test('microorganism colors appear on sand without hiding plants or high-flow ground', () => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8'), context);
    const renderer = vm.runInContext('Object.create(TerrainRenderer.prototype)', context);
    const grid = { sand: Uint8Array.from([1]), flow: new Float32Array(1),
        plants: new Float32Array(1), microbeV: Float32Array.from([0.3]) };
    const normals = { getY: () => 1, getX: () => 0 };
    const color = { setHSL: () => { color.r = 0.05; color.g = 0.05; color.b = 0.05; } };
    grid.microbeV[0] = 0.15;
    renderer.volcanicColor(grid, 0, normals, color);
    const diffuseRed = color.r;
    assert.ok(diffuseRed > 0.1);
    grid.microbeV[0] = 0.3;
    renderer.volcanicColor(grid, 0, normals, color);
    assert.ok(color.r > diffuseRed);
    assert.ok(color.r > 0.3 && color.b > 0.2);
    grid.plants[0] = 0.6;
    renderer.volcanicColor(grid, 0, normals, color);
    assert.ok(color.r < 0.1 && color.b < 0.1);
    grid.plants[0] = 0;
    grid.flow[0] = 0.04;
    renderer.volcanicColor(grid, 0, normals, color);
    assert.ok(color.r < 0.1 && color.b < 0.1);
    grid.sand[0] = 0;
    grid.plants[0] = 1;
    renderer.volcanicColor(grid, 0, normals, color);
    assert.ok(color.r < 0.1 && color.b < 0.1);
});

test('terrain sync does not merge visitor-local biology', () => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'github-sync.js'), 'utf8'), context);
    const sync = vm.runInContext('new GitHubSync()', context);
    const local = { version: '10.0', topology: 'disk', elevation: [1, 1], vegetation: [0.7, 0.1] };
    const remote = { ...local, vegetation: [0.2, 0.8] };
    const merged = sync.mergeTerrain(local, remote);
    assert.deepEqual(Array.from(merged.vegetation), [0.7, 0.1]);
    assert.deepEqual(Array.from(sync.mergeTerrain(local, { ...remote, vegetation: undefined }).vegetation),
        [0.7, 0.1]);
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
    physics.simulationTime = 10;
    const particle = {
        x: 0.1, z: grid.halfSize - 0.01, vx: 0, vz: 1, sediment: 1, travelTime: 5
    };
    physics.moveParticle(particle, 0.04);
    assert.ok(Math.hypot(particle.x, particle.z) > grid.radius - 1);
    assert.ok(particle.sediment > 0.9);
    assert.equal(particle.travelTime, 0);
    assert.ok(Math.abs(physics.getMeanTransitTime() - 5.04) < 1e-12);
    assert.ok(Math.abs(physics.getSandThroughput() - particle.sediment / 10) < 1e-12);
    physics.simulationTime = 71;
    assert.equal(physics.getSandThroughput(), 0);

    const blocked = { x: 5, z: grid.halfSize - 0.01, vx: 0, vz: 1, sediment: 0 };
    physics.moveParticle(blocked, 0.04);
    assert.ok(blocked.z < grid.halfSize && blocked.vz < 0 && blocked.x < 6);
    physics.maxSpeed = 100;
    const crossing = { x: -2, z: grid.halfSize - 0.1, vx: 50, vz: 5, sediment: 1 };
    physics.moveParticle(crossing, 0.04);
    assert.ok(Math.hypot(crossing.x, crossing.z) > grid.radius - 1);
    assert.ok(crossing.sediment > 0);

    const cargo = particle.sediment;
    physics.reinject(particle, 0.5);
    assert.equal(particle.sediment, cargo);
    assert.ok(Math.hypot(particle.x, particle.z) > grid.radius - 1);
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

test('evaporation deposits sediment locally before reinjection and survives a save', () => {
    let random = 0.5;
    const seededMath = Object.create(Math);
    seededMath.random = () => random;
    const seededContext = vm.createContext({ console, Math: seededMath, Float64Array, Date });
    for (const name of ['terrain', 'physics']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), seededContext);
    }
    const { grid, physics } = vm.runInContext(
        'const grid = new TerrainGrid(); const physics = new PhysicsEngine(grid); ({ grid, physics })',
        seededContext
    );
    const particle = physics.particles[0];
    Object.assign(particle, { x: 10, z: -5, vx: 0, vz: 0, sediment: 0.25 });
    const face = grid.sample(particle.x, particle.z).face;
    face.forEach(i => { grid.elevation[i] = grid.bedrock[i]; });
    const beforeDeposit = totalSediment(grid, physics);
    physics.updateParticle(particle, 0);
    assert.equal(particle.burstProgress, undefined);
    random = 0;
    physics.updateParticle(particle, 0.04);
    assert.equal(particle.burstProgress, 0);
    physics.updateParticle(particle, 0);
    assert.equal(particle.burstProgress, 0);
    physics.updateParticle(particle, physics.burstDuration / 2);
    assert.equal(particle.burstProgress, 0.5);
    assert.equal(particle.sediment, 0.25);
    const saved = grid.toJSON();
    assert.equal(grid.fromJSON(saved), true);
    assert.equal(physics.particles[0].burstProgress, 0.5);
    const invalid = grid.toJSON();
    invalid.particles[0].burstProgress = 1;
    assert.equal(grid.fromJSON(invalid), false);
    physics.updateParticle(physics.particles[0], physics.burstDuration / 2);
    assert.equal(physics.particles[0].burstProgress, undefined);
    assert.ok(Math.hypot(physics.particles[0].x, physics.particles[0].z) > grid.radius - 1);
    assert.equal(physics.particles[0].sediment, 0);
    assert.ok(face.some(i => grid.elevation[i] > grid.bedrock[i]));
    assert.ok(Math.abs(totalSediment(grid, physics) - beforeDeposit) < 1e-8);
});

test('evaporation on the fixed surround deposits on the underlying face', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const particle = physics.particles[0];
    Object.assign(particle, { x: 28, z: 0, vx: 0, vz: 0, sediment: 0.25, burstProgress: 0.5 });
    const before = totalSediment(grid, physics);
    const elevations = Array.from(grid.elevation);
    const face = grid.sample(particle.x, particle.z).face;
    physics.updateParticle(particle, physics.burstDuration / 2);
    assert.equal(particle.sediment, 0);
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-8);
    const changed = grid.vertices.map((point, i) => i).filter(i => grid.elevation[i] > elevations[i]);
    assert.ok(changed.length > 0);
    assert.ok(changed.every(i => face.includes(i)));
    assert.ok(changed.some(i => i >= grid.erodibleCount));
    const saved = grid.toJSON();
    assert.equal(grid.fromJSON(saved), true);
});

test('bursting particles do not collide with moving water', () => {
    const physics = new PhysicsEngine(new TerrainGrid());
    const fading = { x: 10, z: -5, vx: 0, vz: 0, sediment: 0, burstProgress: 0.5 };
    const moving = { x: 10.1, z: -5, vx: -1, vz: 0, sediment: 0 };
    physics.particles = [fading, moving];
    physics.collideParticles(0.04);
    assert.equal(moving.vx, -1);
    assert.equal(fading.vx, 0);
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
    grid.microbeU[1] = 0.71234567;
    grid.microbeV[1] = 0.375;
    const saved = grid.toJSON();
    const legacy = { ...saved, vegetation: Array.from(grid.vegetation),
        flowHistory: Array.from(grid.flowHistory), microbeU: Array.from(grid.microbeU),
        microbeV: Array.from(grid.microbeV) };
    assert.equal(saved.version, '11.0');
    for (const version of ['5.0', '6.0', '7.0', '9.0']) assert.equal(grid.fromJSON({ ...saved, version }), false);
    assert.equal(grid.fromJSON(saved), true);
    grid.initialize();
    assert.equal(grid.vegetation[1], 0);
    assert.notEqual(grid.microbeV[1], 0.375);
    assert.equal(grid.fromJSON(legacy), true);
    assert.equal(grid.vegetation[1], 0.5);
    assert.ok(Math.abs(grid.flowHistory[1] - 0.1) < 1e-6);
    assert.ok(Math.abs(grid.microbeU[1] - 0.71234567) < 1e-6);
    assert.equal(grid.microbeV[1], 0.375);
    assert.equal(grid.fromJSON({ ...saved, microbeU: undefined, microbeV: undefined }), true);
    assert.notEqual(grid.microbeV[1], 0.375);
    assert.equal(grid.fromJSON({ ...legacy, microbeV: undefined }), false);
    assert.equal(grid.fromJSON({ ...legacy, microbeV: [NaN] }), false);
    assert.equal(grid.fromJSON({ ...saved, vegetation: undefined, flowHistory: undefined }), true);
    assert.equal(grid.vegetation[1], 0);
    assert.equal(grid.fromJSON({ ...saved, vegetation: [NaN] }), false);
    saved.elevation[grid.erodibleCount] -= 0.1;
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
        const radius = Math.hypot(width, z);
        assert.ok(Math.abs(grid.bedrockHeight(width, z) -
            (grid.slope * Math.min(grid.radius, radius) +
                grid.surroundSlope * Math.max(0, radius - grid.radius))) < 1e-12);
    }
    assert.ok(grid.bedrockHeight(2, 20) < grid.slope * Math.hypot(2, 20));
});

test('raised fixed surround returns water to the disk while leaving the outlet downhill', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    for (let i = 0; i < 32; i++) {
        const angle = 2 * Math.PI * (i + 0.5) / 32;
        const x = 27 * Math.cos(angle), z = 27 * Math.sin(angle);
        if (z > 0 && Math.abs(x) < grid.sinkRadius + grid.channelFlare * z + 1) continue;
        const sample = grid.sample(x, z);
        assert.ok(sample.dx * x + sample.dz * z > 0, `not inward at angle ${angle}`);
        const particle = { x, z, vx: 0, vz: 0, sediment: 0.1 };
        for (let step = 0; step < 100; step++) physics.moveParticle(particle, 0.04);
        assert.ok(Math.hypot(particle.x, particle.z) < grid.radius, `stuck at angle ${angle}`);
    }
    const outlet = grid.sample(0, 27);
    assert.ok(outlet.dz < 0);
    const parcel = { x: 0, z: 27, vx: 0, vz: 0, sediment: 0.1 };
    for (let step = 0; step < 300; step++) {
        physics.moveParticle(parcel, 0.04);
        if (Math.hypot(parcel.x, parcel.z) < grid.radius) break;
    }
    assert.ok(Math.hypot(parcel.x, parcel.z) < grid.radius);
    assert.ok(parcel.sediment > 0);
});

test('erosion tapers at the disk edge without preventing deposition', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const inside = grid.ringVertices[grid.rings - 10][0];
    const transition = grid.ringVertices[grid.rings - 5][0];
    const edge = grid.ringVertices[grid.rings - 1][0];
    assert.equal(physics.erosionFactor(inside), 1);
    assert.ok(physics.erosionFactor(transition) > 0 && physics.erosionFactor(transition) < 1);
    assert.ok(physics.erosionFactor(edge) < 1e-12);

    physics.g = 0;
    physics.friction = 0;
    const particle = physics.particles[0];
    Object.assign(particle, { x: 23.8, z: -0.1, vx: 2, vz: 0, sediment: 0 });
    const sample = grid.sample(particle.x, particle.z);
    const heights = Array.from(grid.elevation);
    const before = totalSediment(grid, physics);
    physics.moveParticle(particle, 0.04);
    const ratios = sample.face.map((index, i) =>
        (heights[index] - grid.elevation[index]) * grid.vertexArea[index] /
        Math.max(0, sample.weights[i]) / physics.erosionFactor(index));
    assert.ok(ratios.every(ratio => Math.abs(ratio - ratios[0]) < 1e-12));
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-8);

    Object.assign(particle, { x: 23.8, z: -0.1, vx: 0, vz: 0, sediment: 0.1 });
    const depositStart = Array.from(grid.elevation);
    physics.moveParticle(particle, 0.04);
    const deposits = sample.face.map((index, i) =>
        (grid.elevation[index] - depositStart[index]) * grid.vertexArea[index] /
        Math.max(0, sample.weights[i]));
    assert.ok(deposits.every(value => value > 0 && Math.abs(value - deposits[0]) < 1e-12));
});

test('version 10 saves raise the surround without changing the sand or particles', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    grid.elevation[100] += 0.1;
    physics.particles[0].sediment = 0.2;
    const saved = grid.toJSON();
    saved.version = '10.0';
    for (let i = grid.erodibleCount; i < grid.vertices.length; i++) {
        const point = grid.vertices[i];
        saved.elevation[i] = grid.bedrockHeight(point.x, point.z, 0) + grid.initialSandDepth;
    }
    const before = totalSediment(grid, physics);
    assert.equal(grid.fromJSON(saved), true);
    assert.equal(grid.elevation[100], saved.elevation[100]);
    assert.equal(physics.particles[0].sediment, 0.2);
    assert.ok(Math.abs(totalSediment(grid, physics) - before) < 1e-8);
    assert.ok(grid.elevation.slice(grid.erodibleCount).every((height, j) =>
        height === grid.bedrock[j + grid.erodibleCount] + grid.initialSandDepth));
    saved.elevation[grid.erodibleCount] -= 0.1;
    assert.equal(grid.fromJSON(saved), false);
});

test('500- and 1000-particle saves gain new water without losing saved sediment', () => {
    const grid = new TerrainGrid();
    const physics = new PhysicsEngine(grid);
    const saved = grid.toJSON();
    saved.particles = saved.particles.slice(0, 500);
    saved.particles[0].sediment = 0.25;
    physics.particles[700].sediment = 0.75;
    const expected = saved.elevation.reduce((sum, height, i) =>
        sum + (height - grid.bedrock[i]) * grid.vertexArea[i], 0) + 0.25;
    assert.equal(grid.fromJSON(saved), true);
    assert.equal(physics.particles, grid.particles);
    assert.equal(physics.particles.length, 1500);
    assert.deepEqual({ ...physics.particles[0] }, { ...saved.particles[0] });
    assert.ok(physics.particles.slice(500).every(p =>
        p.sediment === 0 && p.vx === 0 && p.vz === 0 && grid.locate(p.x, p.z)));
    assert.ok(Math.abs(totalSediment(grid, physics) - expected) < 1e-8);
    const restored = grid.toJSON();
    assert.equal(grid.fromJSON(restored), true);
    const saved1000 = { ...restored, particles: restored.particles.slice(0, 1000) };
    assert.equal(grid.fromJSON(saved1000), true);
    assert.equal(physics.particles.length, 1500);
    assert.ok(physics.particles.slice(1000).every(p => p.sediment === 0 && p.vx === 0 && p.vz === 0));
    assert.equal(grid.fromJSON({ ...saved, particles: saved.particles.slice(0, 499) }), false);
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
