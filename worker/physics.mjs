export const WIDTH = 64;
export const HEIGHT = 64;
export const CELL_SIZE = 1;
export const DEFAULT_PARAMETERS = Object.freeze({ flow: 0.5, speed: 1 });

const DT = 0.01;
const GRAVITY = 9.81;
const FRICTION = 0.02;
const TRANSPORT = 0.1;

export function createTerrain() {
    const elevation = new Float32Array(WIDTH * HEIGHT);
    const waterDepth = new Float32Array(WIDTH * HEIGHT);
    const sediment = new Float32Array(WIDTH * HEIGHT);
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const radius = Math.min(WIDTH, HEIGHT) / 3;

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const index = y * WIDTH + x;
            const dx = x - cx;
            const dy = y - cy;
            const r = Math.hypot(dx, dy);
            elevation[index] = r < radius
                ? 2 * (1 - (r / radius) ** 2) * Math.cos(Math.atan2(dy, dx) * 4)
                : -0.5 + (r - radius) * 0.1;
            elevation[index] += (Math.random() - 0.5) * 0.1;
            if (r < radius * 0.15) {
                waterDepth[index] = 0.3;
                sediment[index] = 0.5;
            }
        }
    }

    return {
        elevation: Array.from(elevation),
        waterDepth: Array.from(waterDepth),
        sediment: Array.from(sediment)
    };
}

/**
 * Compute a single time step for rows [start, end), using adjacent rows as a halo.
 */
export function calculateRows(terrain, parameters, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < 0 || end > HEIGHT || start >= end) {
        throw new RangeError('Invalid row range');
    }

    const elevation = Float32Array.from(terrain.elevation);
    const water = Float32Array.from(terrain.waterDepth);
    const sediment = Float32Array.from(terrain.sediment);
    const velocityX = new Float32Array(WIDTH * HEIGHT);
    const velocityY = new Float32Array(WIDTH * HEIGHT);
    const fluxX = new Float32Array(WIDTH * HEIGHT);
    const fluxY = new Float32Array(WIDTH * HEIGHT);

    const inletX = Math.floor(WIDTH / 2);
    const inletY = Math.floor(HEIGHT / 8);
    for (let y = inletY - 3; y <= inletY + 3; y++) {
        for (let x = inletX - 3; x <= inletX + 3; x++) {
            const i = y * WIDTH + x;
            water[i] += parameters.flow * DT;
            sediment[i] = Math.min(1, sediment[i] + 0.3 * DT * 0.1);
        }
    }

    const haloStart = Math.max(1, start - 1);
    const haloEnd = Math.min(HEIGHT - 1, end + 1);
    for (let y = haloStart; y < haloEnd; y++) {
        for (let x = 1; x < WIDTH - 1; x++) {
            const i = y * WIDTH + x;
            const surface = (j) => elevation[j] + water[j];
            const gx = (surface(i + 1) - surface(i - 1)) / (2 * CELL_SIZE);
            const gy = (surface(i + WIDTH) - surface(i - WIDTH)) / (2 * CELL_SIZE);
            let u = -GRAVITY * gx * (1 - FRICTION * DT);
            let v = -GRAVITY * gy * (1 - FRICTION * DT);
            const speed = Math.hypot(-GRAVITY * gx, -GRAVITY * gy);
            if (speed > 2) {
                const scale = 2 / (speed + 1e-6);
                u *= scale;
                v *= scale;
            }
            velocityX[i] = u;
            velocityY[i] = v;
            fluxX[i] = velocityX[i] * sediment[i];
            fluxY[i] = velocityY[i] * sediment[i];
        }
    }

    const count = (end - start) * WIDTH;
    const nextElevation = new Float32Array(count);
    const nextWater = new Float32Array(count);
    const nextSediment = new Float32Array(count);
    const dt = DT * parameters.speed;

    for (let y = start; y < end; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const i = y * WIDTH + x;
            const out = (y - start) * WIDTH + x;
            nextElevation[out] = elevation[i];
            nextWater[out] = water[i];
            nextSediment[out] = Math.min(
                1, sediment[i] + TRANSPORT * Math.hypot(velocityX[i], velocityY[i]) * DT
            );
            if (x > 0 && x < WIDTH - 1 && y > 0 && y < HEIGHT - 1) {
                const sedimentDivergence = (
                    fluxX[i + 1] - fluxX[i - 1] + fluxY[i + WIDTH] - fluxY[i - WIDTH]
                ) / (2 * CELL_SIZE);
                const waterDivergence = (
                    water[i + 1] * velocityX[i + 1] - water[i - 1] * velocityX[i - 1] +
                    water[i + WIDTH] * velocityY[i + WIDTH] -
                    water[i - WIDTH] * velocityY[i - WIDTH]
                ) / (2 * CELL_SIZE);
                nextElevation[out] = Math.max(-5, elevation[i] - sedimentDivergence * dt);
                nextWater[out] = Math.max(0.001, water[i] - waterDivergence * dt);
            }
            if (y === HEIGHT - 3) {
                nextWater[out] *= 0.8;
            }
        }
    }

    return {
        elevation: Array.from(nextElevation),
        waterDepth: Array.from(nextWater),
        sediment: Array.from(nextSediment)
    };
}
