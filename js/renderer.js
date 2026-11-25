/**
 * Three.js view of the erodible bed, fixed surround and water parcels.
 */
class TerrainRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05070d);
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        TerrainRenderer.placeDefaultCamera(this.camera);
        this.captureTarget = null;
        this.captureCamera = null;
        this.captureBuffer = null;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        // Cap the pixel ratio at 2: the bed is a dense 25 m disk and the default
        // ratio can make the frame buffer enormous on high-density displays.
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const light = new THREE.DirectionalLight(0xffffff, 0.85);
        light.position.set(20, 40, 20);
        this.scene.add(light);
        this.terrainMesh = null;
        this.biologyMesh = null;
        this.particleMesh = null;
        this.displayMode = TerrainRenderer.DEFAULT_DISPLAY_MODE;
        this.dummy = new THREE.Object3D();
        // Kept as a named handler so dispose() can remove it again.
        this.onResize = () => this.onWindowResize();
        window.addEventListener('resize', this.onResize);
        this.onWindowResize();
    }

    createTerrainMesh(grid, biology) {
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
        }
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(grid.vertices.length * 3);
        grid.vertices.forEach((point, i) => {
            positions[3 * i] = point.x;
            positions[3 * i + 1] = grid.elevation[i];
            positions[3 * i + 2] = point.z;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
        geometry.setIndex(grid.triangles.flat());
        geometry.computeVertexNormals();
        this.terrainMesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
            vertexColors: true, side: THREE.DoubleSide, shininess: 25
        }));
        this.scene.add(this.terrainMesh);
        this.updateTerrainColors(grid);
        this.createBiologyMesh(biology);
    }

    createBiologyMesh(biology) {
        if (this.biologyMesh) {
            this.scene.remove(this.biologyMesh);
            this.biologyMesh.geometry.dispose();
            this.biologyMesh.material.dispose();
        }
        const terrain = biology.terrain;
        const count = biology.count;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[3 * i] = terrain.vertices[i].x;
            positions[3 * i + 1] = terrain.elevation[i] + 0.015;
            positions[3 * i + 2] = terrain.vertices[i].z;
        }
        // The biology overlay is built on the terrain mesh itself: one vertex per
        // erodible vertex and the same triangles, so the two stay in register as
        // the bed erodes.
        const indices = [];
        for (const [a, b, c] of terrain.triangles) {
            if (a < count && b < count && c < count) indices.push(a, b, c);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        // RGBA colour attribute: the alpha channel carries the per-vertex density,
        // so the overlay blends softly over the bed instead of snapping opaque.
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
        geometry.setIndex(indices);
        this.biologyMesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
            vertexColors: true, transparent: true, depthWrite: false,
            side: THREE.DoubleSide, shininess: 25
        }));
        this.scene.add(this.biologyMesh);
        this.updateBiologyMesh(biology);
    }

    updateTerrainMesh(grid, biology) {
        const positions = this.terrainMesh.geometry.attributes.position;
        for (let i = 0; i < grid.elevation.length; i++) positions.array[3 * i + 1] = grid.elevation[i];
        positions.needsUpdate = true;
        this.terrainMesh.geometry.computeVertexNormals();
        this.updateTerrainColors(grid);
        this.biologyMesh.visible = this.displayMode === 'habitat' || this.displayMode === 'Tree of life' || this.displayMode === 'streams';
        if (this.biologyMesh.visible) this.updateBiologyMesh(biology);
    }

    updateBiologyMesh(biology) {
        const geometry = this.biologyMesh.geometry;
        const terrain = biology.terrain;
        const positions = geometry.attributes.position;
        for (let i = 0; i < biology.count; i++) {
            positions.array[3 * i + 1] = terrain.elevation[i] + 0.015;
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
        const colors = geometry.attributes.color;
        const normals = geometry.attributes.normal;
        const color = new THREE.Color();
        for (let i = 0; i < biology.count; i++) {
            if (this.displayMode === 'Tree of life') {
                this.treeOfLifeColor(biology, i, normals, color);
            } else if (this.displayMode === 'streams') {
                this.streamsColor(biology, i, color);
            } else {
                this.volcanicColor(biology, i, normals, color);
            }
            // Per-density alpha: sparse colonies stay translucent, dense patches
            // approach full opacity. No fade-out at the disk edge.
            const density = Math.max(
                biology.plants[i], biology.microbeV[i] / 0.3, biology.flow[i] / 0.02);
            const alpha = Math.min(1, density * 1.5);
            colors.setXYZW(i, color.r, color.g, color.b, alpha);
        }
        colors.needsUpdate = true;
    }

    updateTerrainColors(grid) {
        const colors = this.terrainMesh.geometry.attributes.color;
        const material = this.terrainMesh.material;
        material.wireframe = this.displayMode === 'mesh';
        const sandView = this.displayMode === 'sand depth' || this.displayMode === 'Tree of life';
        const brightness = sandView ? 0.6 : material.wireframe ? 0.3 : 1;
        const specular = sandView || material.wireframe ? 0 : 17 / 255;
        material.color.setRGB(brightness, brightness, brightness);
        material.specular.setRGB(specular, specular, specular);
        let max = 0;
        if (this.displayMode === 'flux' || this.displayMode === 'sediment') {
            for (let i = 0; i < grid.elevation.length; i++) {
                const value = this.displayMode === 'flux'
                    ? grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i])
                    : grid.sediment[i] * grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i]);
                max = Math.max(max, value);
            }
        }
        const color = new THREE.Color();
        for (let i = 0; i < grid.elevation.length; i++) {
            if (this.displayMode === 'mesh') {
                color.setRGB(0.55, 0.65, 0.7);
            } else if (i >= grid.erodibleCount) {
                color.setRGB(0, 0, 0);
            } else if (this.displayMode === 'habitat' || this.displayMode === 'streams') {
                color.setRGB(0.053, 0.053, 0.055);
            } else if (this.displayMode === 'sand depth' || this.displayMode === 'Tree of life') {
                const depth = (grid.elevation[i] - grid.bedrock[i]) / grid.initialSandDepth;
                this.deepColor(depth / TerrainRenderer.SAND_DEPTH_DISPLAY_MAX, color);
            } else {
                const value = this.displayMode === 'flux'
                    ? grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i])
                    : grid.sediment[i] * grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i]);
                const t = max > 0 ? Math.sqrt(value / max) : 0;
                if (this.displayMode === 'flux') color.setRGB(0.12 + 0.2 * t, 0.17 + 0.65 * t, 0.2 + 0.8 * t);
                else color.setRGB(0.18 + 0.77 * t, 0.05 + 0.2 * t, 0.28 + 0.55 * t);
            }
            colors.setXYZ(i, color.r, color.g, color.b);
        }
        colors.needsUpdate = true;
    }

    treeOfLifeColor(biology, i, normals, color) {
        // Composite of the habitat view (sand depth + plants) and the flow view:
        // plant intensity and hue are boosted where water runs, so the overlay
        // brightens along streams while microbes stay confined to calm patches.
        const growth = biology.sand[i] ? biology.plants[i] : 0;
        const ny = normals.getY(i);
        const nx = normals.getX(i);
        const facing = Math.max(0, Math.min(1, 0.5 + 0.9 * (nx * 0.4 + ny - 0.85)));
        const flowBoost = Math.min(1, biology.flow[i] / 0.012);
        const hue = 0.17 + 0.04 * (1 - facing);
        const lightness = 0.035 + 0.45 * growth * (0.4 + 0.6 * flowBoost) * (0.5 + 0.5 * facing);
        color.setHSL(hue, 0.95 * growth * (0.4 + 0.6 * flowBoost), lightness);
        const rock = biology.sand[i] ? 0.018 : 0.035;
        color.r += rock; color.g += rock; color.b += rock * 1.1;
        const habitat = biology.sand[i] * Math.max(0, 1 - biology.flow[i] / 0.04) *
            Math.max(0, 1 - growth / 0.6);
        const density = Math.min(1, Math.max(0, (biology.microbeV[i] - 0.025) / 0.16));
        const amount = density * density * habitat * (0.4 + 0.6 * flowBoost);
        const purple = Math.min(1, biology.microbeV[i] / 0.35);
        color.r += ((0.55 - 0.18 * purple) - color.r) * amount;
        color.g += ((0.30 - 0.18 * purple) - color.g) * amount;
        color.b += ((0.07 + 0.28 * purple) - color.b) * amount;
    }

    streamsColor(biology, i, color) {
        // Luminous blue water: depth sets lightness, speed sets saturation, so
        // the overlay reads as a luminous sheet of moving water.
        const terrain = biology.terrain;
        const depth = terrain.waterDepth[i];
        const velocity = Math.hypot(terrain.velocityX[i], terrain.velocityY[i]);
        const flow = biology.flow[i];
        color.setRGB(0.01, 0.01, 0.015);
        if (depth > 0.0005 || flow > 0.0005) {
            const depthStrength = Math.min(1, depth / 0.12);
            const velocityStrength = Math.min(1, velocity / 0.6);
            const hue = 0.6;
            const saturation = 0.55 + 0.45 * velocityStrength;
            const lightness = 0.18 + 0.55 * depthStrength;
            color.setHSL(hue, saturation, lightness);
        }

        // Plants: green along streams
        if (biology.sand[i] && biology.plants[i] > 0.03) {
            const plantBase = biology.plants[i];
            const flowPresence = Math.min(1, flow / 0.01);
            const plantIntensity = plantBase * (0.3 + 0.7 * flowPresence);
            const hue = 0.28;
            color.setHSL(hue, 0.95, Math.max(color.b, 0.25 + 0.4 * plantIntensity));
        }

        // Microbes: distinct colonies in red-magenta, edge-detected over the
        // mesh neighbours rather than a regular grid.
        if (biology.microbeV[i] > 0.03) {
            const v = biology.microbeV[i];
            let edgeStrength = 0;
            for (const j of biology.neighbours[i]) {
                const d = Math.abs(biology.microbeV[j] - v);
                if (d > edgeStrength) edgeStrength = d;
            }
            const density = Math.min(1, biology.microbeV[i] / 0.2);
            const edgeDetected = Math.min(1, edgeStrength / 0.05);
            const colonyStrength = density * (0.25 + 0.75 * edgeDetected);

            const purple = Math.min(1, biology.microbeV[i] / 0.25);
            const targetR = Math.max(color.r, 0.8 - 0.15 * purple);
            const targetG = 0.02;
            const targetB = Math.max(color.b, 0.15 + 0.6 * purple);

            color.r = color.r + (targetR - color.r) * colonyStrength;
            color.g = color.g + (targetG - color.g) * colonyStrength;
            color.b = color.b + (targetB - color.b) * colonyStrength;
        }
    }

    volcanicColor(biology, i, normals, color) {
        const growth = biology.sand[i] ? biology.plants[i] : 0;
        const ny = normals.getY(i);
        const nx = normals.getX(i);
        const facing = Math.max(0, Math.min(1, 0.5 + 0.9 * (nx * 0.4 + ny - 0.85)));
        const hue = 0.17 + 0.04 * (1 - facing);
        const lightness = 0.035 + 0.45 * growth * (0.5 + 0.5 * facing);
        color.setHSL(hue, 0.95 * growth, lightness);
        const rock = biology.sand[i] ? 0.018 : 0.035;
        color.r += rock; color.g += rock; color.b += rock * 1.1;
        const habitat = biology.sand[i] * Math.max(0, 1 - biology.flow[i] / 0.04) *
            Math.max(0, 1 - growth / 0.6);
        const density = Math.min(1, Math.max(0, (biology.microbeV[i] - 0.025) / 0.16));
        const amount = density * density * habitat;
        const purple = Math.min(1, biology.microbeV[i] / 0.35);
        color.r += ((0.55 - 0.18 * purple) - color.r) * amount;
        color.g += ((0.30 - 0.18 * purple) - color.g) * amount;
        color.b += ((0.07 + 0.28 * purple) - color.b) * amount;
    }

    // Reversed cmocean "deep": dark for bare bedrock, light for thick sand, so that
    // brightness reads as sand quantity (the bathymetric order made bare banks glow).
    deepColor(t, color) {
        const stops = TerrainRenderer.DEEP;
        const x = (1 - Math.max(0, Math.min(1, t))) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(x));
        const f = x - k;
        color.setRGB(stops[k][0] + (stops[k + 1][0] - stops[k][0]) * f,
            stops[k][1] + (stops[k + 1][1] - stops[k][1]) * f,
            stops[k][2] + (stops[k + 1][2] - stops[k][2]) * f);
    }

    updateParticles(physics) {
        if (!this.particleMesh) {
            const geometry = new THREE.SphereGeometry(physics.particleRadius * 0.5, 8, 6);
            geometry.setAttribute('burstProgress', new THREE.InstancedBufferAttribute(
                new Float32Array(physics.particles.length), 1));
            const material = new THREE.MeshPhongMaterial({
                color: 0x567b88, shininess: 12, transparent: true, depthWrite: false
            });
            material.onBeforeCompile = shader => {
                shader.vertexShader = shader.vertexShader.replace('#include <common>',
                    '#include <common>\nattribute float burstProgress;\nvarying float vBurstProgress;');
                shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
                    '#include <begin_vertex>\nvBurstProgress = burstProgress;');
                shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
                    '#include <common>\nvarying float vBurstProgress;');
                shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
                    float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0),
                        smoothstep(0.0, 0.35, vBurstProgress));
                    gl_FragColor.a *= (1.0 - smoothstep(0.45, 1.0, vBurstProgress)) *
                        mix(1.0, 0.25 + 0.75 * rim, smoothstep(0.35, 0.7, vBurstProgress));
                    #include <dithering_fragment>`);
            };
            this.particleMesh = new THREE.InstancedMesh(
                geometry, material,
                physics.particles.length
            );
            this.particleMesh.frustumCulled = false;
            this.scene.add(this.particleMesh);
        }
        const bursts = this.particleMesh.geometry.attributes.burstProgress;
        physics.particles.forEach((particle, i) => {
            const sample = physics.grid.sample(particle.x, particle.z);
            if (!sample) {
                // A particle outside the mesh is skipped this frame; the physics
                // step re-injects it and the instance matrix stays at its last
                // position, which is harmless for one frame.
                return;
            }
            this.dummy.position.set(particle.x, sample.height + 0.02, particle.z);
            this.dummy.scale.set(1, 0.3, 1);
            this.dummy.updateMatrix();
            this.particleMesh.setMatrixAt(i, this.dummy.matrix);
            bursts.setX(i, particle.burstProgress ?? 0);
        });
        this.particleMesh.instanceMatrix.needsUpdate = true;
        bursts.needsUpdate = true;
    }

    cycleDisplayMode() {
        const modes = ['habitat', 'Tree of life', 'streams', 'mesh', 'sand depth', 'flux', 'sediment'];
        this.displayMode = modes[(modes.indexOf(this.displayMode) + 1) % modes.length];
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Render the default view (zenith camera, `habitat` mode) off screen, whatever
     * the visitor's camera and display mode, and return its pixels.
     *
     * The image size is fixed rather than the window's, so that timelapse frames
     * keep the same size; the visible canvas is left untouched.
     *
     * Args:
     *   grid: TerrainGrid, to recolour the bed if another display mode is shown.
     *   biology: BiologyGrid, idem for the vegetation overlay.
     *   width: Image width (px).
     *   height: Image height (px).
     *
     * Returns:
     *   Uint8ClampedArray of width × height opaque RGBA pixels, top row first.
     */
    captureDefaultView(grid, biology, width, height) {
        if (!this.captureTarget || this.captureTarget.width !== width || this.captureTarget.height !== height) {
            this.captureTarget?.dispose();
            // The default framebuffer is antialiased; a multisampled target (WebGL 2)
            // gives frames the same smooth edges as the screen.
            const Target = this.renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget
                ? THREE.WebGLMultisampleRenderTarget : THREE.WebGLRenderTarget;
            this.captureTarget = new Target(width, height);
            this.captureCamera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
            this.captureBuffer = new Uint8Array(width * height * 4);
        }
        TerrainRenderer.placeDefaultCamera(this.captureCamera);
        this.captureCamera.aspect = width / height;
        this.captureCamera.fov = TerrainRenderer.fieldOfView(this.captureCamera.aspect);
        this.captureCamera.updateProjectionMatrix();

        const mode = this.displayMode;
        const recolour = mode !== TerrainRenderer.DEFAULT_DISPLAY_MODE;
        if (recolour) {
            this.displayMode = TerrainRenderer.DEFAULT_DISPLAY_MODE;
            this.updateTerrainMesh(grid, biology);
        }
        try {
            this.renderer.setRenderTarget(this.captureTarget);
            this.renderer.render(this.scene, this.captureCamera);
            this.renderer.readRenderTargetPixels(this.captureTarget, 0, 0, width, height, this.captureBuffer);
        } finally {
            this.renderer.setRenderTarget(null);
            if (recolour) {
                this.displayMode = mode;
                this.updateTerrainMesh(grid, biology);
            }
        }
        return TerrainRenderer.flipRows(this.captureBuffer, width, height);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.fov = TerrainRenderer.fieldOfView(this.camera.aspect);
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    dispose() {
        window.removeEventListener('resize', this.onResize);
        this.captureTarget?.dispose();
        this.scene.traverse(object => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) object.material.dispose();
        });
        this.renderer.dispose();
    }
}

TerrainRenderer.DEFAULT_DISPLAY_MODE = 'habitat';

// Camera of the page at start-up and of timelapse frames: straight down at the disk.
TerrainRenderer.placeDefaultCamera = camera => {
    camera.position.set(0, 65, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
};

// Vertical field of view (degrees): 55° when the image is wider than tall, widened
// on portrait images so that the disk still fits horizontally.
TerrainRenderer.fieldOfView = aspect =>
    2 * Math.atan(Math.tan(55 * Math.PI / 360) / Math.min(1, aspect)) * 180 / Math.PI;

// WebGL reads pixels bottom row first; images are stored top row first. Alpha is
// forced to opaque, since transparent parcels blend into it in a render target.
TerrainRenderer.flipRows = (pixels, width, height) => {
    const out = new Uint8ClampedArray(width * height * 4);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
        out.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
};

TerrainRenderer.DEEP = [[0.993, 0.994, 0.8], [0.866, 0.947, 0.73], [0.734, 0.902, 0.676], [0.596, 0.857, 0.645],
    [0.47, 0.806, 0.639], [0.383, 0.747, 0.643], [0.334, 0.684, 0.641], [0.305, 0.62, 0.632], [0.283, 0.556, 0.619],
    [0.264, 0.498, 0.605], [0.248, 0.436, 0.592], [0.242, 0.371, 0.578], [0.251, 0.303, 0.548], [0.255, 0.243, 0.464],
    [0.232, 0.195, 0.36], [0.197, 0.149, 0.262], [0.156, 0.103, 0.173]];
// Sand depth (in multiples of the initial thickness) shown with the lightest colour;
// the initial layer then sits mid-palette and accumulations remain distinguishable.
TerrainRenderer.SAND_DEPTH_DISPLAY_MAX = 2;
