#!/usr/bin/env node
/**
 * Headless scan of the water-parcel dynamics in the Tree of Life simulation.
 *
 * The script loads `js/mesh-points.js`, `js/terrain.js` and `js/physics.js`
 * in a `vm` context (exactly like the test suite), then subclasses
 * `PhysicsEngine` to add the per-parcel speed samples and the cumulative sink
 * exit counters used by the report. The dynamics itself is the base engine's:
 * the levers are its own options,
 *
 *   - `friction`: linear damping rate k (sim s^-1);
 *   - `noise`   : Langevin velocity perturbation (m per sim s^1/2), applied
 *                 after gravity and damping, `v += sigma * sqrt(dt) * N(0, 1)`;
 *   - `inertia` : factor alpha multiplying the gravity acceleration (alpha = 1
 *                 is the base dynamics);
 *   - `evaporation`: toggles the bursting mechanism (a parcel that bursts is
 *                 reinjected at the disk edge with its sediment load kept).
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
const NOMINAL_DT = 0.04; // nominal step when step() is called without wall-clock time (sim s)

/**
 * PhysicsEngine subclass for the parameter scan. It adds only the per-parcel
 * speed samples needed for the stuck-fraction metrics and the cumulative sink
 * exit counters; the dynamics itself (gravity, damping, noise, inertia,
 * sediment exchange, walls, sink) is the base engine's, so the default
 * configuration is byte-for-byte the model.
 *
 * `evaporation` toggles the bursting mechanism. When disabled, the hazard
 * rate is zeroed: the base updateParticle still draws one random per substep
 * (the hazard check), so the RNG stream stays aligned; the burst branch is
 * never taken because -Math.expm1(0) = 0 and random() < 0 is false.
 */
class ScanEngine extends PhysicsEngine {
    constructor(grid, options = {}) {
        super(grid, options);
        this.evaporation = options.evaporation !== false;
        if (!this.evaporation) {
            this.particleHazardRate = 0;
        }
        this.stuckThreshold = options.stuckThreshold ?? 0.15;
        this._uniqueSinkExits = new Set();
        this._totalSinkExits = 0;
    }

    recordSinkExit(particle) {
        this._uniqueSinkExits.add(particle);
        this._totalSinkExits += 1;
        super.recordSinkExit(particle);
    }

    moveParticle(particle, dt) {
        // Track per-parcel speeds for the stuck-fraction metrics. This draws
        // no randoms, so the RNG stream stays aligned with the base dynamics.
        const speed = Math.hypot(particle.vx, particle.vz);
        particle._speedSum = (particle._speedSum ?? 0) + speed;
        particle._speedSamples = (particle._speedSamples ?? 0) + 1;
        particle._slowSamples = (particle._slowSamples ?? 0) + (speed < this.stuckThreshold ? 1 : 0);
        return super.moveParticle(particle, dt);
    }

    meanSpeed() {
        // Mean parcel speed over all per-parcel samples of the run.
        let sum = 0;
        let samples = 0;
        for (const particle of this.particles) {
            if (particle._speedSamples > 0) {
                sum += particle._speedSum;
                samples += particle._speedSamples;
            }
        }
        if (samples > 0) return sum / samples;
        // Fall back to a direct mean over the parcels (e.g. no samples).
        let instantaneous = 0;
        for (const particle of this.particles) instantaneous += Math.hypot(particle.vx, particle.vz);
        return this.particles.length ? instantaneous / this.particles.length : 0;
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
    const { friction = 1.1, noise = 1.4, inertia = 1.5, evaporation = true,
        stuckThreshold = 0.15, particles = DEFAULT_PARTICLES, duration = 200, seed = 2026 } = config;
    const grid = new TerrainGrid();
    const engine = new ScanEngine(grid, {
        seed, friction, noise, inertia, evaporation, stuckThreshold, particleCount: particles
    });
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
        friction, noise, inertia, evaporation, stuckThreshold,
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
 *  re-centred on the recommended full-scale configuration (friction 1.1, noise
 *  1.4, inertia 1.5); the grid can be overridden from the CLI
 *  (--frictions/--noises/--inertias, comma-separated) for a re-centred
 *  exploration around a new best. */
function buildGrid(frictions = [1.0, 1.1, 1.2], noises = [1.3, 1.4, 1.5], inertias = [1.4, 1.5, 1.6]) {
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

/** Composite score: 1 = ideal "critical" regime (flowing, not stuck, not
 *  too fast, channelising and circulating), 0 = stuck or too fast. */
function scoreOf(metrics) {
    const speed = metrics.meanSpeed ?? 0;
    const channel = metrics.channelisation ?? 0;
    const uniqueFrac = metrics.uniqueExitFraction ?? 0;
    const mostlyStuck = metrics.mostlyStuckFraction ?? 0;
    const speedScore = Math.max(0, 1 - Math.abs(speed - 1.2) / 1.2);
    const channelScore = Math.min(1, channel / 0.30);
    const circulationScore = Math.min(1, uniqueFrac / 0.90);
    return Math.max(0, 0.4 * speedScore + 0.3 * channelScore + 0.3 * circulationScore - 0.5 * mostlyStuck);
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
    lines.push('The levers: `friction` (linear damping rate k, sim s^-1), `noise` (Langevin velocity ' +
        'perturbation, m per sim s^1/2) and `inertia` (gravity acceleration factor). ' +
        '`evaporation` toggles the bursting mechanism (a parcel that bursts is reinjected at the ' +
        'disk edge with its sediment load kept). ' +
        '`score` = max(0, 0.4 * (1 - |meanSpeed - 1.2| / 1.2) + 0.3 * min(1, channelisation / 0.30) ' +
        '+ 0.3 * min(1, uniqueExitFraction / 0.90) - 0.5 * mostlyStuckFraction).');
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
        'rewards the intermediate-speed / high-channelisation compromise rather than the fastest regime, ' +
        'and additionally rewards circulation (unique sink exits) while penalising parcels stuck ' +
        'more than half the time. The evaporation mechanism (bursting + reinjection with the sediment ' +
        'load kept) is toggled separately and is not part of the score.');
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
    const frictions = args.frictions ? parseList(args.frictions) : [1.0, 1.1, 1.2];
    const noises = args.noises ? parseList(args.noises) : [1.3, 1.4, 1.5];
    const inertias = args.inertias ? parseList(args.inertias) : [1.4, 1.5, 1.6];
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
