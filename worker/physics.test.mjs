import { test } from 'node:test';
import { deepStrictEqual, ok } from 'node:assert/strict';
import { calculateRows, createTerrain, DEFAULT_PARAMETERS, HEIGHT, WIDTH } from './physics.mjs';

test('partitioned calculations reproduce the complete time step', () => {
    const terrain = createTerrain();
    const whole = calculateRows(terrain, DEFAULT_PARAMETERS, 0, HEIGHT);
    const rows = [[0, 7], [7, 17], [17, 43], [43, HEIGHT]];
    for (const field of ['elevation', 'waterDepth', 'sediment']) {
        const combined = rows.flatMap(([start, end]) =>
            calculateRows(terrain, DEFAULT_PARAMETERS, start, end)[field]
        );
        deepStrictEqual(combined, whole[field]);
        ok(combined.length === WIDTH * HEIGHT);
    }
});

test('sediment transport persists after the step', () => {
    const terrain = createTerrain();
    const next = calculateRows(terrain, DEFAULT_PARAMETERS, 0, HEIGHT);
    ok(next.sediment.some((value, i) => value > terrain.sediment[i]));
});
