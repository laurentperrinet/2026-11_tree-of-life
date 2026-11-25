#!/usr/bin/env node
/**
 * Headless scan of the water-parcel dynamics in the Tree of Life simulation.
 *
 * The script loads `js/mesh-points.js`, `js/terrain.js` and `js/physics.js`
 * in a `vm` context (exactly like the test suite), then subclasses
 * `PhysicsEngine` with three extra levers on top of the default dynamics:
 *
 *   - `noise`   : Langevin-style velocity perturbation applied after gravity
 *                 and damping, `v += sigma * sqrt(dt) * N(0, 1)` (m per sim s).
 *   - `inertia` : factor alpha in (0, 1] multiplying the gravity acceleration,
 *                 so that alpha = 1 is the default dynamics and alpha < 1
 *                 makes the response sluggish (more inertial).
 *   - `friction`: the linear damping rate k (sim s^-1), already in the model.
 *
 * The bedrock, the mesh, the sediment exchange and the sand relaxation are
 * left untouched. The scan reports the transit time, the sink throughput, the
 * mean parcel speed and the channelisation of the water (share of the water
 * volume in the top 10% of cells by depth), so that the "critical" regimes
 * (flowing but not stuck, not too fast or straight) can be located.
 *
 * Usage:
 *   node tools/scan-flow.mjs scan    [--particles N] [--duration S] [--workers K]
 *                                    [--results FILE] [--verify-results FILE]
 *   node tools/scan-flow.mjs verify  [--top K] [--particles N] [--duration S] [--workers K]
 *                                    [--results FILE] [--verify-results FILE]
 *   node tools/scan-flow.mjs report  [--results FILE] [--verify-results FILE]
 *   node tools/scan-flow.mjs one     CONFIG_JSON   # run a single configuration
 *
 * `one` is the worker entry point; it prints a single JSON object on stdout.
 * The grid of configurations is defined in `buildGrid()` below.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// --- Load the model exactly like the test suite does. -----------------------
const context = vm.createContext({ console, Math, Float64Array, Date, btoa, atob });
for (const name of ['mesh-points', 'terrain', 'physics']) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js', `${name}.js`), 'utf8'), context);
}
const { TerrainGrid, PhysicsEngine } = vm.runInContext('({ TerrainGrid, PhysicsEngine })', context);

const DEFAULT_PARTICLES = 1500;
const DEFAULT_WATER_PER_PARTICLE = 0.02;
const NOMINAL_DT = 0.04; // nominal step when step() is called without wall-clock time (sim s)

/**
 * PhysicsEngine subclass with the scan levers. The original `moveParticle` is
 * copied verbatim, with two changes: the gravity acceleration is multiplied by
 * `inertia`, and a Langevin noise term is added after the damping. The original
 * method is preserved as the `super.moveParticle` fallback for the default
 * configuration, so that the default dynamics is byte-for-byte the model.
 */
class ScanEngine extends PhysicsEngine {
    constructor(grid, options = {}) {
        super(grid, options);
        this.noiseSigma = options.noise ?? 0;
        this.inertiaFactor = options.inertia ?? 1;
        this.evaporation = options.evaporation !== false;
        if (!this.evaporation) {
            // Toggle off the evaporation ("bursting") mechanism. The base
            // updateParticle still draws one random per substep (hazard check),
            // so the RNG stream stays aligned; the burst branch is never taken
            // because -Math.expm1(0) = 0 and random() < 0 is false.
            this.particleHazardRate = 0;
        }
        // The evaporation burst deposits the parcel's sediment load on the bed.
        // This lever keeps the burst + reinjection (rescue from local minima)
        // while skipping the deposit, to isolate the deposit's effect.
        this.depositSediment = options.depositSediment !== false;
        // Anti-stagnation kick: isotropic impulse applied to a parcel that has
        // spent stuckDelay sim s below stuckThreshold m/sim s. Default off.
        this.stuckKick = options.stuckKick ?? 0;
        this.stuckThreshold = options.stuckThreshold ?? 0.15;
        this.stuckDelay = options.stuckDelay ?? 2.0;
        this._speedSum = 0;
        this._speedSamples = 0;
        this._uniqueSinkExits = new Set();
        this._totalSinkExits = 0;
        if (options.particleCount && options.particleCount !== this.particleCount) {
            // Keep the total water volume constant when the parcel count drops.
            this.waterPerParticle = DEFAULT_WATER_PER_PARTICLE * (this.particleCount / options.particleCount);
            this.particleCount = options.particleCount;
            this.createParticles();
        }
    }

    /** Standard normal sample from the seeded RNG (Box-Muller). */
    randn() {
        let u = 0;
        while (u === 0) u = this.random();
        const v = this.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    recordSinkExit(particle) {
        this._uniqueSinkExits.add(particle);
        this._totalSinkExits += 1;
        super.recordSinkExit(particle);
    }

    /**
     * Skip the bed deposit when the lever is off. The sediment load stays
     * with the parcel (the same behaviour as the base engine's null-sample
     * case), so the burst + reinjection rescue path is unchanged.
     */
    depositEvaporatedSediment(particle) {
        if (!this.depositSediment) return;
        super.depositEvaporatedSediment(particle);
    }

    moveParticle(particle, dt) {
        if (this.noiseSigma === 0 && this.inertiaFactor === 1 && this.stuckKick === 0) {
            // Default dynamics, byte-for-byte the model. Track per-particle
            // speeds for the stuck-fraction metric; this draws no randoms.
            const speed = Math.hypot(particle.vx, particle.vz);
            particle._speedSum = (particle._speedSum ?? 0) + speed;
            particle._speedSamples = (particle._speedSamples ?? 0) + 1;
            particle._slowSamples = (particle._slowSamples ?? 0) + (speed < this.stuckThreshold ? 1 : 0);
            return super.moveParticle(particle, dt);
        }
        if (dt === 0) return;
        particle.travelTime = (Number.isFinite(particle.travelTime) ? particle.travelTime : 0) + dt;
        const grid = this.grid;
        const sample = grid.sample(particle.x, particle.z);
        if (!sample) {
            this.reinject(particle);
            return;
        }
        const previousSpeed = Math.hypot(particle.vx, particle.vz);
        const damping = Math.exp(-this.friction * dt);
        const gravity = this.inertiaFactor * this.g * dt;
        particle.vx = (particle.vx - gravity * sample.dx) * damping;
        particle.vz = (particle.vz - gravity * sample.dz) * damping;
        if (this.noiseSigma > 0) {
            const perturbation = this.noiseSigma * Math.sqrt(dt);
            particle.vx += perturbation * this.randn();
            particle.vz += perturbation * this.randn();
        }
        // Anti-stagnation kick: break a parcel out of a local minimum. The
        // kick is bounded by the maxSpeed cap below.
        if (this.stuckKick > 0) {
            const speedNow = Math.hypot(particle.vx, particle.vz);
            if (speedNow < this.stuckThreshold) {
                particle.stuckTime = (particle.stuckTime ?? 0) + dt;
                if (particle.stuckTime >= this.stuckDelay) {
                    const theta = this.random() * 2 * Math.PI;
                    particle.vx += this.stuckKick * Math.cos(theta);
                    particle.vz += this.stuckKick * Math.sin(theta);
                    particle.stuckTime = 0;
                }
            } else {
                particle.stuckTime = 0;
            }
        }
        let speed = Math.hypot(particle.vx, particle.vz);
        if (speed > this.maxSpeed) {
            particle.vx *= this.maxSpeed / speed;
            particle.vz *= this.maxSpeed / speed;
            speed = this.maxSpeed;
        }
        this._speedSum += speed;
        this._speedSamples += 1;
        particle._speedSum = (particle._speedSum ?? 0) + speed;
        particle._speedSamples = (particle._speedSamples ?? 0) + 1;
        particle._slowSamples = (particle._slowSamples ?? 0) + (speed < this.stuckThreshold ? 1 : 0);
        const capacity = this.waterPerParticle * this.transportCapacity * Math.max(0, speed - 0.1);
        const exchangeRate = speed < 0.1 ? 2 : 0.3;
        const relaxation = 1 - Math.exp(-exchangeRate * dt);
        let entrainment = capacity * relaxation;
        let settling = particle.sediment * relaxation;
        if (speed < previousSpeed && particle.sediment > 0) {
            const slowingDeposit = particle.sediment * (1 - speed / previousSpeed);
            if (entrainment - settling > -slowingDeposit) {
                entrainment = 0;
                settling = slowingDeposit;
            }
        }
        let actualExchange = 0;
        sample.face.forEach((index, i) => {
            if (index >= grid.erodibleCount) return;
            const weight = Math.max(0, sample.weights[i]);
            const previousHeight = grid.elevation[index];
            const available = (previousHeight - grid.bedrock[index]) * grid.vertexArea[index];
            const entrained = Math.min(available, weight * entrainment * this.erosionFactor(index));
            const height = Math.max(grid.bedrock[index],
                previousHeight + (weight * settling - entrained) / grid.vertexArea[index]);
            grid.elevation[index] = height;
            actualExchange += (previousHeight - height) * grid.vertexArea[index];
        });
        particle.sediment = Math.max(0, particle.sediment + actualExchange);
        let x = particle.x + particle.vx * dt;
        let z = particle.z + particle.vz * dt;
        if (z >= grid.halfSize) {
            const fraction = (grid.halfSize - particle.z) / (z - particle.z);
            const exitX = particle.x + fraction * (x - particle.x);
            if (Math.abs(exitX) < grid.sinkRadius) {
                this.recordSinkExit(particle);
                this.reinject(particle);
                return;
            }
            z = grid.halfSize - 0.000001;
            particle.vz = -Math.abs(particle.vz);
        } else if (z <= -grid.halfSize) {
            z = -grid.halfSize + 0.000001;
            particle.vz = Math.abs(particle.vz);
        }
        if (x >= grid.halfSize) {
            x = grid.halfSize - 0.000001;
            particle.vx = -Math.abs(particle.vx);
        } else if (x <= -grid.halfSize) {
            x = -grid.halfSize + 0.000001;
            particle.vx = Math.abs(particle.vx);
        }
        particle.x = x;
        particle.z = z;
    }

    meanSpeed() {
        // Sample the mean parcel speed from the run; default dynamics has no
        // samples, so fall back to a direct mean over the parcels.
        if (this._speedSamples > 0) return this._speedSum / this._speedSamples;
        let sum = 0;
        for (const particle of this.particles) sum += Math.hypot(particle.vx, particle.vz);
        return sum / this.particles.length;
    }

    channelisation() {
        const grid = this.grid;
        const entries = [];
        let total = 0;
        for (let i = 0; i < grid.vertices.length; i++) {
            const volume = grid.waterDepth[i] * grid.vertexArea[i];
            if (volume > 0) entries.push({ volume });
            total += volume;
        }
        if (total <= 0 || entries.length === 0) return 0;
        entries.sort((a, b) => b.volume - a.volume);
        const cutoff = Math.max(1, Math.floor(entries.length * 0.1));
        let top = 0;
        for (let i = 0; i < cutoff; i++) top += entries[i].volume;
        return top / total;
    }

    transitStats() {
        const transit = this.transitTimes;
        if (transit.length === 0) return { count: 0, mean: null, std: null };
        const mean = this.transitTimeTotal / transit.length;
        const variance = transit.reduce((sum, t) => sum + (t - mean) ** 2, 0) / transit.length;
        return { count: transit.length, mean, std: Math.sqrt(variance) };
    }
}

/** Total water volume in the bed, for the report (m^3). */
function bedSedimentVolume(grid) {
    let volume = 0;
    for (let i = 0; i < grid.vertices.length; i++) {
        volume += (grid.elevation[i] - grid.bedrock[i]) * grid.vertexArea[i];
    }
    return volume;
}

/** Run one configuration and return its metrics. */
function runConfig(config) {
    const { friction = 1.8, noise = 0, inertia = 1, evaporation = true, depositSediment = true,
        stuckKick = 0, stuckThreshold = 0.15, stuckDelay = 2.0,
        particles = DEFAULT_PARTICLES, duration = 200, seed = 2026 } = config;
    const grid = new TerrainGrid();
    const engine = new ScanEngine(grid, {
        seed, noise, inertia, evaporation, depositSediment, stuckKick, stuckThreshold, stuckDelay,
        particleCount: particles
    });
    engine.friction = friction;
    const steps = Math.max(1, Math.ceil(duration / NOMINAL_DT));
    for (let i = 0; i < steps; i++) engine.step();
    const transit = engine.transitStats();
    // Stuck fraction: parcels whose cumulative mean speed over the whole run
    // stayed below 0.1 m/sim s (parcels with no samples are skipped).
    let stuck = 0;
    let sampled = 0;
    let slowTimeShareSum = 0;
    let mostlyStuck = 0;
    for (const particle of engine.particles) {
        if (particle._speedSamples > 0) {
            sampled++;
            const slowShare = (particle._slowSamples ?? 0) / particle._speedSamples;
            slowTimeShareSum += slowShare;
            if (particle._speedSum / particle._speedSamples < 0.1) stuck++;
            if (slowShare > 0.5) mostlyStuck++;
        }
    }
    const stuckFraction = sampled > 0 ? stuck / sampled : 0;
    const stagnationShare = sampled > 0 ? slowTimeShareSum / sampled : 0;
    const mostlyStuckFraction = sampled > 0 ? mostlyStuck / sampled : 0;
    // Total sink exits: the true cumulative count. The base engine prunes its
    // event list to a 60 sim s window, so sandOutflowEvents.length is NOT the
    // total.
    const totalSinkExits = engine._totalSinkExits ?? 0;
    return {
        friction, noise, inertia, evaporation, depositSediment, stuckKick, stuckThreshold, stuckDelay,
        particles, duration, seed,
        meanSpeed: engine.meanSpeed(),
        transitMean: transit.mean,
        transitStd: transit.std,
        transitCount: transit.count,
        uniqueSinkExits: engine._uniqueSinkExits.size,
        uniqueExitFraction: engine._uniqueSinkExits.size / engine.particleCount,
        totalSinkExits,
        throughput: duration > 0 ? totalSinkExits / duration : 0,
        stuckFraction,
        stagnationShare,
        mostlyStuckFraction,
        channelisation: engine.channelisation(),
        bedSedimentVolume: bedSedimentVolume(grid),
        meanTransitTime: engine.getMeanTransitTime()
    };
}

/** The configuration grid: friction x noise x inertia. The default grid is
 *  re-centred on the recommended full-scale configuration (friction 1.3, noise
 *  1.6, inertia 1.1); the grid can be overridden from the CLI
 *  (--frictions/--noises/--inertias, comma-separated) for a re-centred
 *  exploration around a new best. */
function buildGrid(frictions = [1.3, 1.4, 1.5], noises = [1.5, 1.6, 1.7], inertias = [0.9, 1.0, 1.1]) {
    const grid = [];
    for (const friction of frictions) {
        for (const noise of noises) {
            for (const inertia of inertias) {
                grid.push({ friction, noise, inertia });
            }
        }
    }
    return grid;
}

/** Composite score: 1 = ideal "critical" regime, 0 = stuck or too fast. */
function scoreOf(metrics) {
    const speed = metrics.meanSpeed ?? 0;
    const channel = metrics.channelisation ?? 0;
    const speedScore = Math.max(0, 1 - Math.abs(speed - 1.2) / 1.2);
    return 0.5 * speedScore + 0.5 * channel;
}

/** Print metrics as JSON on stdout (used by the parallel workers). */
function one(configJson) {
    const config = JSON.parse(configJson);
    const metrics = runConfig(config);
    metrics.score = scoreOf(metrics);
    process.stdout.write(JSON.stringify(metrics));
}

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) args[key] = true;
            else { args[key] = next; i++; }
        } else args._.push(argv[i]);
    }
    return args;
}

function runSingle(config, log = true) {
    const metrics = runConfig(config);
    metrics.score = scoreOf(metrics);
    if (log) console.log(`  friction=${config.friction} noise=${config.noise} inertia=${config.inertia} -> ` +
        `speed=${metrics.meanSpeed.toFixed(3)} transit=${metrics.transitMean?.toFixed(1) ?? 'n/a'} ` +
        `channel=${(metrics.channelisation * 100).toFixed(1)}% score=${metrics.score.toFixed(3)}`);
    return metrics;
}

async function runParallel(configs, options) {
    const workers = options.workers ?? Math.min(8, osCpuCount());
    const results = new Array(configs.length);
    let cursor = 0;
    let completed = 0;
    const workerCount = Math.max(1, Math.min(workers, configs.length));
    console.log(`Running ${configs.length} configurations on ${workerCount} worker(s)...`);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < configs.length) {
            const index = cursor++;
            const config = configs[index];
            const metrics = await new Promise((resolve, reject) => {
                const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'one', JSON.stringify(config)], {
                    cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit']
                });
                let stdout = '';
                child.stdout.on('data', chunk => { stdout += chunk; });
                child.on('error', reject);
                child.on('close', code => {
                    if (code !== 0) reject(new Error(`worker exited with code ${code}`));
                    else resolve(JSON.parse(stdout));
                });
            });
            results[index] = metrics;
            completed++;
            console.log(`[${completed}/${configs.length}] friction=${config.friction} noise=${config.noise} ` +
                `inertia=${config.inertia} -> speed=${metrics.meanSpeed.toFixed(3)} ` +
                `transit=${metrics.transitMean?.toFixed(1) ?? 'n/a'} ` +
                `channel=${(metrics.channelisation * 100).toFixed(1)}% score=${metrics.score.toFixed(3)}`);
        }
    }));
    return results;
}

function osCpuCount() {
    return os.cpus().length || 4;
}

function atomicWriteJson(file, data) {
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

function report(resultsFile, verifyFile = path.join(here, 'flow-verify-results.json')) {
    const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const ranked = [...results].sort((a, b) => b.score - a.score);
    const best = ranked.slice(0, 10);
    const critical = results.filter(m => m.meanSpeed >= 0.6 && m.meanSpeed <= 1.8 && m.channelisation >= 0.30);
    const noStuck = results.filter(m => (m.mostlyStuckFraction ?? 0) <= 0.05)
        .sort((a, b) => (b.throughput ?? 0) - (a.throughput ?? 0));
    const lines = [];
    lines.push('# Flow dynamics scan — critical regimes');
    lines.push('');
    lines.push('Generated by `tools/scan-flow.mjs`. All configurations run with seed 2026, ' +
        `${results[0].particles} parcels, ${results[0].duration} sim s, nominal step 0.04 sim s.`);
    lines.push('');
    lines.push('The levers: `friction` (linear damping rate k), `noise` (Langevin velocity ' +
        'perturbation, m per sim s^1/2) and `inertia` (gravity acceleration factor). ' +
        '`evaporation` toggles the bursting/sediment-deposit mechanism and `stuckKick` applies ' +
        'an isotropic kick to parcels that stay below `stuckThreshold` for `stuckDelay` sim s. ' +
        '`score` = 0.5 * (1 - |meanSpeed - 1.2| / 1.2) + 0.5 * channelisation, clipped at 0.');
    lines.push('');
    lines.push('## Critical regimes (speed 0.6–1.8 m/sim s, channelisation ≥ 30%)');
    lines.push('');
    if (critical.length === 0) {
        lines.push('_None. The regimes are either too slow or not channelising enough._');
    } else {
        lines.push('| friction | noise | inertia | speed | transit (sim s) | channel | slow | mostly stuck | exits/s | score |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const m of critical.sort((a, b) => b.score - a.score)) {
            lines.push(`| ${m.friction} | ${m.noise} | ${m.inertia} | ${m.meanSpeed.toFixed(2)} | ` +
                `${m.transitMean?.toFixed(1) ?? 'n/a'} ± ${m.transitStd?.toFixed(1) ?? 'n/a'} | ` +
                `${(m.channelisation * 100).toFixed(1)}% | ${((m.stagnationShare ?? 0) * 100).toFixed(1)}% | ` +
                `${((m.mostlyStuckFraction ?? 0) * 100).toFixed(1)}% | ` +
                `${(m.throughput ?? 0).toFixed(1)} | ${m.score.toFixed(3)} |`);
        }
    }
    lines.push('');
    lines.push('## No-stagnation regimes (stuck ≤ 5%, sorted by throughput)');
    lines.push('');
    if (noStuck.length === 0) {
        lines.push('_None. Every configuration leaves at least 5% of parcels stuck._');
    } else {
        lines.push('| friction | noise | inertia | speed | transit (sim s) | channel | slow | mostly stuck | exits/s | score |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const m of noStuck) {
            lines.push(`| ${m.friction} | ${m.noise} | ${m.inertia} | ${m.meanSpeed.toFixed(2)} | ` +
                `${m.transitMean?.toFixed(1) ?? 'n/a'} ± ${m.transitStd?.toFixed(1) ?? 'n/a'} | ` +
                `${(m.channelisation * 100).toFixed(1)}% | ${((m.stagnationShare ?? 0) * 100).toFixed(1)}% | ` +
                `${((m.mostlyStuckFraction ?? 0) * 100).toFixed(1)}% | ` +
                `${(m.throughput ?? 0).toFixed(1)} | ${m.score.toFixed(3)} |`);
        }
    }
    lines.push('');
    lines.push('## Top 10 by score');
    lines.push('');
    lines.push('| rank | friction | noise | inertia | speed | transit (sim s) | channel | slow | mostly stuck | exits/s | score |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [i, m] of best.entries()) {
        lines.push(`| ${i + 1} | ${m.friction} | ${m.noise} | ${m.inertia} | ${m.meanSpeed.toFixed(2)} | ` +
            `${m.transitMean?.toFixed(1) ?? 'n/a'} ± ${m.transitStd?.toFixed(1) ?? 'n/a'} | ` +
            `${(m.channelisation * 100).toFixed(1)}% | ${((m.stagnationShare ?? 0) * 100).toFixed(1)}% | ` +
            `${((m.mostlyStuckFraction ?? 0) * 100).toFixed(1)}% | ` +
            `${(m.throughput ?? 0).toFixed(1)} | ${m.score.toFixed(3)} |`);
    }
    lines.push('');
    lines.push('## All configurations');
    lines.push('');
    lines.push('| friction | noise | inertia | speed | transit (sim s) | channel | slow | mostly stuck | exits/s | score |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const m of [...results].sort((a, b) => b.score - a.score)) {
        lines.push(`| ${m.friction} | ${m.noise} | ${m.inertia} | ${m.meanSpeed.toFixed(2)} | ` +
            `${m.transitMean?.toFixed(1) ?? 'n/a'} | ${(m.channelisation * 100).toFixed(1)}% | ` +
            `${((m.stagnationShare ?? 0) * 100).toFixed(1)}% | ${((m.mostlyStuckFraction ?? 0) * 100).toFixed(1)}% | ` +
            `${(m.throughput ?? 0).toFixed(1)} | ${m.score.toFixed(3)} |`);
    }
    lines.push('');
    // Optional verification block: full-scale runs of the top scan configs.
    if (fs.existsSync(verifyFile)) {
        const verified = JSON.parse(fs.readFileSync(verifyFile, 'utf8'));
        lines.push('## Verification at full scale (1500 parcels, 400 sim s)');
        lines.push('');
        lines.push('| friction | noise | inertia | speed | transit (sim s) | channel | slow | mostly stuck | unique exits (frac) | total exits | exits/s | score |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
        for (const m of verified) {
            lines.push(`| ${m.friction} | ${m.noise} | ${m.inertia} | ${m.meanSpeed.toFixed(2)} | ` +
                `${m.transitMean?.toFixed(1) ?? 'n/a'} ± ${m.transitStd?.toFixed(1) ?? 'n/a'} | ` +
                `${(m.channelisation * 100).toFixed(1)}% | ${((m.stagnationShare ?? 0) * 100).toFixed(1)}% | ` +
                `${((m.mostlyStuckFraction ?? 0) * 100).toFixed(1)}% | ` +
                `${m.uniqueSinkExits} (${((m.uniqueExitFraction ?? 0) * 100).toFixed(0)}%) | ${m.totalSinkExits} | ${(m.throughput ?? 0).toFixed(1)} | ${m.score.toFixed(3)} |`);
        }
        lines.push('');
    }
    // Optional default-dynamics reference at full scale.
    const defaultFile = path.join(here, 'flow-default-reference.json');
    if (fs.existsSync(defaultFile)) {
        const d = JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
        lines.push('## Default dynamics (reference, 1500 parcels, 400 sim s)');
        lines.push('');
        lines.push(`- speed: ${d.meanSpeed.toFixed(2)} m/sim s (friction=${d.friction}, noise=${d.noise}, inertia=${d.inertia})`);
        lines.push(`- transit: ${d.transitMean?.toFixed(1) ?? 'n/a'} ± ${d.transitStd?.toFixed(1) ?? 'n/a'} sim s (${d.transitCount} exits)`);
        lines.push(`- channelisation: ${(d.channelisation * 100).toFixed(1)}%`);
        lines.push(`- unique sink exits: ${d.uniqueSinkExits} (${((d.uniqueSinkExits / (d.particles ?? 1500)) * 100).toFixed(0)}% of parcels), total sink exits: ${d.totalSinkExits} (${(d.throughput ?? 0).toFixed(1)} exits/s)`);
        lines.push(`- stuck (cumulative mean < 0.1): ${((d.stuckFraction ?? 0) * 100).toFixed(1)}%`);
        lines.push(`- slow-time share: ${((d.stagnationShare ?? 0) * 100).toFixed(1)}%`);
        lines.push(`- mostly stuck (>50% of time slow): ${((d.mostlyStuckFraction ?? 0) * 100).toFixed(1)}%`);
        lines.push('');
    }
    lines.push('## Reading');
    lines.push('');
    lines.push('- "Stuck" regimes: low speed, high transit time, low channelisation.');
    lines.push('- "Too fast / straight" regimes: high speed, low transit time, low channelisation.');
    lines.push('- "Critical" regimes: intermediate speed with strong channelisation.');
    lines.push('- `slow` is the mean share of a parcel’s substeps spent below `stuckThreshold` ' +
        'm/sim s (default 0.15); `mostly stuck` is the share of parcels that spent more than half ' +
        'of their substeps slow; `stuck` is the share of parcels whose cumulative mean speed over ' +
        'the run stayed below 0.1 m/sim s. `exits/s` is the true cumulative sink exits per sim s ' +
        '(the base engine prunes its event list to a 60 sim s window, so only the cumulative count is meaningful).');
    lines.push('');
    lines.push('Note: Langevin noise disperses the flow and lowers channelisation, so the score ' +
        'rewards the intermediate-speed / high-channelisation compromise rather than the fastest regime. ' +
        'The evaporation mechanism (bursting + sediment deposit) is toggled separately and is ' +
        'not part of the score.');
    const reportFile = resultsFile.replace(/\.json$/, '-report.md');
    fs.writeFileSync(reportFile, lines.join('\n') + '\n');
    console.log(`Report written to ${reportFile}`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (command === 'one') {
    one(args._[1]);
} else if (command === 'scan') {
    const particles = Number(args.particles ?? 600);
    const duration = Number(args.duration ?? 200);
    const workers = Number(args.workers ?? 8);
    const resultsFile = args.results ?? path.join(here, 'flow-scan-results.json');
    const verifyFile = args.verifyResults ?? path.join(here, 'flow-verify-results.json');
    const parseList = value => value.split(',').map(s => Number(s.trim()));
    const frictions = args.frictions ? parseList(args.frictions) : [1.3, 1.4, 1.5];
    const noises = args.noises ? parseList(args.noises) : [1.5, 1.6, 1.7];
    const inertias = args.inertias ? parseList(args.inertias) : [0.9, 1.0, 1.1];
    const configs = buildGrid(frictions, noises, inertias).map(config => ({ ...config, particles, duration, seed: 2026 }));
    const results = await runParallel(configs, { workers });
    atomicWriteJson(resultsFile, results);
    console.log(`\nResults written to ${resultsFile}`);
    report(resultsFile, verifyFile);
} else if (command === 'verify') {
    const top = Number(args.top ?? 5);
    const particles = Number(args.particles ?? DEFAULT_PARTICLES);
    const duration = Number(args.duration ?? 400);
    const workers = Number(args.workers ?? 8);
    const resultsFile = args.results ?? path.join(here, 'flow-scan-results.json');
    const verifyFile = args.verifyResults ?? path.join(here, 'flow-verify-results.json');
    const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const best = [...results].sort((a, b) => b.score - a.score).slice(0, top);
    const configs = best.map(m => ({
        friction: m.friction, noise: m.noise, inertia: m.inertia,
        evaporation: m.evaporation ?? true,
        depositSediment: m.depositSediment ?? true,
        stuckKick: m.stuckKick ?? 0,
        particles, duration, seed: 2026
    }));
    const verified = await runParallel(configs, { workers });
    atomicWriteJson(verifyFile, verified);
    console.log(`\nVerification results written to ${verifyFile}`);
} else if (command === 'report') {
    const resultsFile = args.results ?? path.join(here, 'flow-scan-results.json');
    const verifyFile = args.verifyResults ?? path.join(here, 'flow-verify-results.json');
    report(resultsFile, verifyFile);
} else {
    console.error('Usage: scan-flow.mjs <scan|verify|report|one> [--flags]');
    process.exit(1);
}
