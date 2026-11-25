/**
 * Lagrangian water parcels on a piecewise-linear triangular bed.
 * Sediment exchanged with the bed is conserved as a volume.
 */
const TRANSIT_SAMPLE_LIMIT = 100;
const SAND_THROUGHPUT_WINDOW_SECONDS = 60;

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * Args:
 *   seed: 32-bit integer seed.
 *
 * Returns:
 *   A function returning a float in [0, 1).
 */
function createSeededRandom(seed) {
    let state = seed >>> 0;
    return function random() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class PhysicsEngine {
    constructor(grid, options = {}) {
        this.grid = grid;
        // Nominal step (sim s), used when step() is called without wall-clock time,
        // as in the tests.
        this.dt = 0.04;
        // Simulated seconds per wall-clock second at timeScale 1. Tying the step to
        // real time makes the simulation advance equally fast on every device,
        // instead of in proportion to its frame rate. A frame costs about 24 ms per
        // substep plus about 0.6 s of colony update per simulated second (Apple M3
        // Ultra), so 0.5 lets such a machine keep up with one substep per frame.
        this.simulationRate = 0.5;
        // Longest wall-clock interval (s) credited to one frame. It bounds the cost
        // of a frame (here 0.05 sim s, 2 substeps, close to the former fixed step):
        // a device too slow to keep up, or a tab back from the background, falls
        // behind real time instead of taking ever longer, ever slower frames.
        this.maxFrameSeconds = 0.1;
        this.g = 9.81;
        this.friction = 1.8;
        this.timeScale = 1;
        this.particleCount = 1500;
        this.waterPerParticle = 0.02;
        this.transportCapacity = 6;
        this.erosionBorderWidth = 2;
        this.particleRadius = 0.105;
        this.maxSpeed = 3;
        this.particleHazardRate = 1 / 90;
        this.burstDuration = 0.8;
        this.simulationTime = 0;
        this.transitTimes = [];
        this.transitTimeTotal = 0;
        this.sandOutflowEvents = [];
        this.sandOutflowHead = 0;
        this.sandReposeSlope = Math.tan(34 * Math.PI / 180);
        this.particles = [];
        // Seeded RNG: the simulation is reproducible for a given seed, which keeps
        // parameter scans comparable. Injected via options.random by the tests.
        this.seed = options.seed ?? 2026;
        this.random = options.random ?? createSeededRandom(this.seed);
        this.createParticles();
    }

    createParticles() {
        this.particles = Array.from({ length: this.particleCount }, (_, i) => {
            const particle = { x: 0, z: 0, vx: 0, vz: 0, sediment: 0 };
            this.reinject(particle, (i + this.random()) / this.particleCount);
            const radiusFraction = 0.1 + 0.9 * this.random();
            particle.x *= radiusFraction;
            particle.z *= radiusFraction;
            return particle;
        });
        this.grid.particles = this.particles;
    }

    reinject(particle, fraction = this.random()) {
        const angle = 2 * Math.PI * fraction;
        // Three mesh spacings inside the disk edge, which is the circle of
        // radius R (the mesh itself has no circular boundary).
        const radius = this.grid.radius - 3 * this.grid.spacing;
        particle.x = radius * Math.cos(angle);
        particle.z = -radius * Math.sin(angle);
        particle.vx = 0;
        particle.vz = 0;
        particle.travelTime = 0;
        delete particle.burstProgress;
    }

    erosionFactor(index) {
        const point = this.grid.vertices[index];
        const distance = this.grid.radius - Math.hypot(point.x, point.z);
        const t = Math.max(0, Math.min(1, distance / this.erosionBorderWidth));
        return t * t * (3 - 2 * t);
    }

    /**
     * Advance the parcels, the sediment exchange and the sand relaxation.
     *
     * Args:
     *   wallSeconds: wall-clock time elapsed since the previous frame (s). When
     *     given, the step is simulationRate * timeScale * min(wallSeconds,
     *     maxFrameSeconds); when omitted, it is the nominal dt * timeScale.
     *
     * Returns:
     *   The simulated time advanced (sim s).
     */
    step(wallSeconds) {
        const grid = this.grid;
        grid.waterDepth.fill(0);
        grid.sediment.fill(0);
        grid.velocityX.fill(0);
        grid.velocityY.fill(0);
        const base = wallSeconds === undefined
            ? this.dt
            : this.simulationRate * Math.min(Math.max(0, wallSeconds), this.maxFrameSeconds);
        const dt = base * this.timeScale;
        // Keep travel per substep smaller than a particle radius.
        const steps = Math.max(1, Math.ceil(dt / (this.particleRadius / this.maxSpeed)));
        const subDt = dt / steps;
        for (let sub = 0; sub < steps; sub++) {
            if (subDt > 0) this.collideParticles(subDt);
            this.simulationTime += subDt;
            for (const particle of this.particles) this.updateParticle(particle, subDt);
            if (subDt > 0) this.relaxSand(subDt);
        }
        for (const particle of this.particles) {
            const sample = grid.sample(particle.x, particle.z);
            if (!sample) {
                // A particle that escaped the mesh must not crash the frame:
                // re-inject it at the disk edge (sediment load is kept) and
                // skip the accumulation for this frame.
                this.reinject(particle);
                continue;
            }
            sample.face.forEach((index, i) => {
                const weight = Math.max(0, sample.weights[i]);
                grid.waterDepth[index] += this.waterPerParticle * weight / grid.vertexArea[index];
                grid.sediment[index] += particle.sediment * weight / grid.vertexArea[index];
                grid.velocityX[index] += particle.vx * weight;
                grid.velocityY[index] += particle.vz * weight;
            });
        }
        return dt;
    }

    recordSinkExit(particle) {
        if (Number.isFinite(particle.travelTime) && particle.travelTime > 0) {
            if (this.transitTimes.length === TRANSIT_SAMPLE_LIMIT) {
                this.transitTimeTotal -= this.transitTimes.shift();
            }
            this.transitTimes.push(particle.travelTime);
            this.transitTimeTotal += particle.travelTime;
        }
        this.sandOutflowEvents.push({
            time: this.simulationTime,
            volume: particle.sediment
        });
        this.pruneSandOutflowEvents();
    }

    getMeanTransitTime() {
        return this.transitTimes.length
            ? this.transitTimeTotal / this.transitTimes.length
            : null;
    }

    getSandThroughput() {
        this.pruneSandOutflowEvents();
        const elapsed = Math.min(SAND_THROUGHPUT_WINDOW_SECONDS, this.simulationTime);
        if (elapsed <= 0) return 0;

        let volume = 0;
        for (let i = this.sandOutflowHead; i < this.sandOutflowEvents.length; i++) {
            volume += this.sandOutflowEvents[i].volume;
        }
        return volume / elapsed;
    }

    getParticleThroughput() {
        this.pruneSandOutflowEvents();
        const elapsed = Math.min(SAND_THROUGHPUT_WINDOW_SECONDS, this.simulationTime);
        return elapsed > 0 ? (this.sandOutflowEvents.length - this.sandOutflowHead) / elapsed : 0;
    }

    pruneSandOutflowEvents() {
        const cutoff = this.simulationTime - SAND_THROUGHPUT_WINDOW_SECONDS;
        while (this.sandOutflowHead < this.sandOutflowEvents.length &&
            this.sandOutflowEvents[this.sandOutflowHead].time < cutoff) {
            this.sandOutflowHead++;
        }
        if (this.sandOutflowHead === this.sandOutflowEvents.length) {
            this.sandOutflowEvents = [];
            this.sandOutflowHead = 0;
        } else if (this.sandOutflowHead > 128) {
            this.sandOutflowEvents = this.sandOutflowEvents.slice(this.sandOutflowHead);
            this.sandOutflowHead = 0;
        }
    }

    relaxSand(dt) {
        const grid = this.grid;
        const fraction = 1 - Math.exp(-20 * dt);
        for (let pass = 0; pass < 4; pass++) {
            for (let j = 0; j < grid.edges.length; j++) {
                const edge = grid.edges[pass % 2 === 0 ? j : grid.edges.length - 1 - j];
                if (edge.a >= grid.erodibleCount || edge.b >= grid.erodibleCount) continue;
                let high = edge.a;
                let low = edge.b;
                if (grid.elevation[high] < grid.elevation[low]) [high, low] = [low, high];
                const excess = grid.elevation[high] - grid.elevation[low] -
                    this.sandReposeSlope * edge.length;
                if (excess <= 0) continue;
                const available = (grid.elevation[high] - grid.bedrock[high]) * grid.vertexArea[high];
                if (available <= 0) continue;
                const amount = Math.min(available, fraction * excess /
                    (1 / grid.vertexArea[high] + 1 / grid.vertexArea[low]));
                const oldHeight = grid.elevation[high];
                grid.elevation[high] = Math.max(grid.bedrock[high], oldHeight - amount / grid.vertexArea[high]);
                grid.elevation[low] += (oldHeight - grid.elevation[high]) *
                    grid.vertexArea[high] / grid.vertexArea[low];
            }
        }
    }

    collideParticles(dt) {
        const diameter = 2 * this.particleRadius;
        const bins = new Map();
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            if (particle.burstProgress !== undefined) continue;
            const bx = Math.floor(particle.x / diameter);
            const bz = Math.floor(particle.z / diameter);
            for (let x = bx - 1; x <= bx + 1; x++) {
                for (let z = bz - 1; z <= bz + 1; z++) {
                    for (const j of bins.get(`${x},${z}`) || []) {
                        const other = this.particles[j];
                        let dx = particle.x - other.x;
                        let dz = particle.z - other.z;
                        const distance = Math.hypot(dx, dz);
                        if (distance >= diameter) continue;
                        if (distance < 1e-12) {
                            const angle = (i * 2.399963229728653 + j) % (2 * Math.PI);
                            dx = Math.cos(angle);
                            dz = Math.sin(angle);
                        } else {
                            dx /= distance;
                            dz /= distance;
                        }
                        const relativeSpeed = (particle.vx - other.vx) * dx + (particle.vz - other.vz) * dz;
                        // Equal and opposite impulses provide a soft pressure for overlapping parcels.
                        const impulse = Math.min(0.25, 6 * (diameter - distance) * dt) +
                            Math.max(0, -relativeSpeed) * 0.55;
                        particle.vx += impulse * dx;
                        particle.vz += impulse * dz;
                        other.vx -= impulse * dx;
                        other.vz -= impulse * dz;
                    }
                }
            }
            const key = `${bx},${bz}`;
            if (!bins.has(key)) bins.set(key, []);
            bins.get(key).push(i);
        }
    }

    updateParticle(particle, dt) {
        if (dt <= 0) return;
        if (particle.burstProgress !== undefined) {
            const progress = particle.burstProgress + dt / this.burstDuration;
            if (progress >= 1) {
                this.depositEvaporatedSediment(particle);
                this.reinject(particle);
            } else {
                particle.burstProgress = progress;
            }
            return;
        }
        if (this.random() < -Math.expm1(-this.particleHazardRate * dt)) {
            particle.burstProgress = 0;
            particle.vx = 0;
            particle.vz = 0;
            return;
        }
        this.moveParticle(particle, dt);
    }

    depositEvaporatedSediment(particle) {
        if (particle.sediment === 0) return;
        const grid = this.grid;
        const sample = grid.sample(particle.x, particle.z);
        if (!sample) {
            // Outside the mesh there is nowhere to deposit: keep the sediment
            // load so the caller's reinject() carries it to the next cycle.
            return;
        }
        const weights = sample.weights.map(weight => Math.max(0, weight));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        if (total < 1e-12) throw new Error('No terrain for sediment deposit');
        for (let i = 0; i < sample.face.length; i++) {
            if (weights[i] > 0) {
                const index = sample.face[i];
                grid.elevation[index] += particle.sediment * weights[i] / total / grid.vertexArea[index];
            }
        }
        particle.sediment = 0;
    }

    moveParticle(particle, dt) {
        if (dt === 0) return;
        particle.travelTime = (Number.isFinite(particle.travelTime) ? particle.travelTime : 0) + dt;
        const grid = this.grid;
        const sample = grid.sample(particle.x, particle.z);
        if (!sample) {
            // A particle that escaped the mesh is re-injected at the disk edge
            // (sediment load is kept) rather than crashing the simulation.
            this.reinject(particle);
            return;
        }
        const previousSpeed = Math.hypot(particle.vx, particle.vz);
        const damping = Math.exp(-this.friction * dt);
        particle.vx = (particle.vx - this.g * sample.dx * dt) * damping;
        particle.vz = (particle.vz - this.g * sample.dz * dt) * damping;
        let speed = Math.hypot(particle.vx, particle.vz);
        if (speed > this.maxSpeed) {
            particle.vx *= this.maxSpeed / speed;
            particle.vz *= this.maxSpeed / speed;
            speed = this.maxSpeed;
        }
        const capacity = this.waterPerParticle * this.transportCapacity * Math.max(0, speed - 0.1);
        const exchangeRate = speed < 0.1 ? 2 : 0.3;
        const relaxation = 1 - Math.exp(-exchangeRate * dt);
        // Entrainment and settling act at the same time, rather than as one net
        // exchange: on a sand bed the balance still relaxes the load towards
        // capacity, but on bare bedrock nothing can be entrained while the load
        // keeps settling, so a loaded parcel leaves a trail behind it.
        let entrainment = capacity * relaxation;
        let settling = particle.sediment * relaxation;
        if (speed < previousSpeed && particle.sediment > 0) {
            // A slowing parcel drops at least the fraction of its load it lost in speed.
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
            // Only sand already on the bed can be entrained: limiting the net
            // exchange instead would let entrainment cancel this substep's settling
            // on bare bedrock, and no trail would form.
            const available = (previousHeight - grid.bedrock[index]) * grid.vertexArea[index];
            const entrained = Math.min(available, weight * entrainment * this.erosionFactor(index));
            const height = Math.max(grid.bedrock[index],
                previousHeight + (weight * settling - entrained) / grid.vertexArea[index]);
            grid.elevation[index] = height;
            actualExchange += (previousHeight - height) * grid.vertexArea[index];
        });
        // Floating-point rounding can leave an exhausted load just below zero.
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

    reset() {
        this.grid.initialize();
        this.simulationTime = 0;
        this.transitTimes = [];
        this.transitTimeTotal = 0;
        this.sandOutflowEvents = [];
        this.sandOutflowHead = 0;
        this.createParticles();
    }
}
