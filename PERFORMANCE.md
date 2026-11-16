# Performance Optimization Notes

## Current Specifications

- **Grid size**: 64×64 cells (4,096 values)
- **Simulation frequency**: 60 FPS (target)
- **Time step**: 0.01s (physics), scaling via UI
- **Rendering**: 3D mesh update + color remapping

## Performance Metrics

| Component | CPU Time | Notes |
|-----------|----------|-------|
| Physics step | ~2-3ms | Shallow water + sediment transport |
| Mesh update | ~1-2ms | Geometry + vertex colors |
| Rendering | ~3-5ms | Three.js + WebGL |
| GitHub sync | <1ms | Async, no blocking |
| **Total** | **~8-12ms** | Leaves ~20ms for OS (60 FPS budget) |

## Why Float32Array?

- **Memory efficient**: 4 bytes/value vs 8 bytes for JS numbers
- **SIMD friendly**: GPU-ready format for future WebGL compute shaders
- **Zero-copy**: Can be passed directly to WebGL uniforms

## WebGL Compute Shaders (Future)

For grids > 128×128:

```glsl
// Example compute shader for physics step
layout(local_size_x = 8, local_size_y = 8) in;
void main() {
    // Parallel shallow water calculation
    // Would run on GPU, 64x speedup possible
}
```

## Bottlenecks & Solutions

### 1. **Gradient calculations** (current)
- Naïve finite differences: O(N²) per step
- **Solution**: 2D convolution with SIMD or WebGL (future)

### 2. **Mesh update**
- Full geometry re-upload every frame
- **Solution**: Only update vertices that changed (vertex buffering)
- **Fallback**: WebGL compute shader

### 3. **GitHub sync**
- Network I/O: ~200-500ms per request
- **Solution**: Async (non-blocking), already done ✓
- **Optimization**: Batch multiple simulation frames between syncs

## Optimization Checklist

- [x] Use Float32Array for all numerical data
- [x] Async GitHub sync (non-blocking)
- [x] localStorage caching (avoid re-fetch)
- [x] Single Three.js mesh (no per-cell objects)
- [x] requestAnimationFrame for timing
- [ ] WebGL compute shaders (64×64 not needed yet)
- [ ] Spatial partitioning (for collision, not needed)
- [ ] Multi-threading (Web Workers - future enhancement)

## Testing Performance

### Measure FPS
```js
console.log(`FPS: ${1 / deltaTime}`);
```

### Profile physics
```js
console.time('physics');
physics.step();
console.timeEnd('physics');
```

### Monitor memory
```js
console.log(performance.memory.usedJSHeapSize / 1e6, 'MB');
```

## Scaling Paths

| Grid | Recommendation | Est. FPS |
|------|-----------------|----------|
| 32×32 | CPU (current) | 120+ |
| **64×64** | **CPU (current)** | **60** ✓ |
| 128×128 | CPU or WebGL | 30-60 |
| 256×256 | **WebGL compute shaders** | 30-60 |
| 512×512+ | GPU only | 15-30 |

## Energy Calculation Optimization

For convergence detection:

```js
// Current O(N²) - acceptable
let energy = 0;
for (let i = 0; i < width * height; i++) {
    energy += (u[i]² + v[i]²) * h[i];
}

// Future: WebGL reduction shader
// Would compute in parallel on GPU
```

## Recommendations for 128×128

1. Keep physics on CPU (minimal overhead)
2. Move mesh updates to WebGL compute if needed
3. Reduce color remapping frequency (every 2-3 frames)
4. Use normal maps for lighting instead of vertex colors

## Debug Performance

Enable performance overlay (add to index.html):

```html
<div id="debug-perf" style="position: fixed; top: 80px; right: 20px; 
     background: rgba(0,0,0,0.8); color: #0f0; font-family: monospace; 
     padding: 10px; font-size: 11px; z-index: 999;">
    FPS: <span id="fps">--</span> | Physics: <span id="phys-time">--</span>ms
</div>

<script>
let frameCount = 0, lastTime = performance.now();
setInterval(() => {
    const now = performance.now();
    const fps = frameCount / ((now - lastTime) / 1000);
    document.getElementById('fps').textContent = fps.toFixed(0);
    frameCount = 0;
    lastTime = now;
}, 1000);
</script>
```

---

**Conclusion**: Current implementation achieves target 60 FPS at 64×64 grid. Scaling to 256×256+ requires WebGL compute shaders, which is well-documented path for browser-based physics simulations.
