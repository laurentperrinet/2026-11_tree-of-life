/**
 * Three.js view of the erodible bed, fixed surround and water parcels.
 */
class TerrainRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05070d);
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 55, 20);
        this.camera.lookAt(0, 0, -10);
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const light = new THREE.DirectionalLight(0xffffff, 0.85);
        light.position.set(20, 40, 20);
        this.scene.add(light);
        this.terrainMesh = null;
        this.particleMesh = null;
        this.displayMode = 'elevation';
        this.dummy = new THREE.Object3D();
        window.addEventListener('resize', () => this.onWindowResize());
        this.onWindowResize();
    }

    createTerrainMesh(grid) {
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
        this.createSurround(grid);
        this.updateTerrainColors(grid);
    }

    createSurround(grid) {
        const positions = [];
        const indices = [];
        for (let s = 0; s <= grid.sectors; s++) {
            const angle = Math.PI * s / grid.sectors;
            for (const radius of [grid.radius, grid.radius + 5]) {
                positions.push(radius * Math.cos(angle), grid.radius * grid.slope + grid.initialSandDepth,
                    -radius * Math.sin(angle));
            }
        }
        for (let s = 0; s < grid.sectors; s++) {
            const i = 2 * s;
            indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
        }
        const apron = new THREE.BufferGeometry();
        apron.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        apron.setIndex(indices);
        apron.computeVertexNormals();
        this.scene.add(new THREE.Mesh(apron, new THREE.MeshPhongMaterial({ color: 0x0c0d0f, side: THREE.DoubleSide })));

        const wallPositions = [];
        const wallIndices = [];
        for (const sign of [-1, 1]) {
            const start = wallPositions.length / 3;
            for (const x of [sign * grid.sinkRadius, sign * grid.radius]) {
                const height = Math.abs(x) * grid.slope + grid.initialSandDepth;
                wallPositions.push(x, height - 0.1, 0, x, height + 0.2, 0);
            }
            wallIndices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
        }
        const wall = new THREE.BufferGeometry();
        wall.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
        wall.setIndex(wallIndices);
        wall.computeVertexNormals();
        this.scene.add(new THREE.Mesh(wall, new THREE.MeshPhongMaterial({ color: 0x15181a, side: THREE.DoubleSide })));
    }

    updateTerrainMesh(grid) {
        const positions = this.terrainMesh.geometry.attributes.position;
        for (let i = 0; i < grid.elevation.length; i++) positions.array[3 * i + 1] = grid.elevation[i];
        positions.needsUpdate = true;
        this.terrainMesh.geometry.computeVertexNormals();
        this.updateTerrainColors(grid);
    }

    updateTerrainColors(grid) {
        const colors = this.terrainMesh.geometry.attributes.color;
        let max = 0;
        if (this.displayMode !== 'elevation') {
            for (let i = 0; i < grid.elevation.length; i++) {
                const value = this.displayMode === 'flux'
                    ? grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i])
                    : grid.sediment[i];
                max = Math.max(max, value);
            }
        }
        const color = new THREE.Color();
        const normals = this.terrainMesh.geometry.attributes.normal;
        if (this.displayMode === 'elevation') this.updateMoisture(grid);
        for (let i = 0; i < grid.elevation.length; i++) {
            if (this.displayMode === 'elevation') {
                this.volcanicColor(grid, i, normals, color);
            } else if (this.displayMode === 'sand depth') {
                const depth = (grid.elevation[i] - grid.bedrock[i]) / grid.initialSandDepth;
                this.deepColor(depth, color);
            } else {
                const value = this.displayMode === 'flux'
                    ? grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i])
                    : grid.sediment[i];
                const t = max > 0 ? Math.sqrt(value / max) : 0;
                if (this.displayMode === 'flux') color.setRGB(0.12 + 0.2 * t, 0.17 + 0.65 * t, 0.2 + 0.8 * t);
                else color.setRGB(0.2 + 0.7 * t, 0.16 + 0.55 * t, 0.1);
            }
            colors.setXYZ(i, color.r, color.g, color.b);
        }
        colors.needsUpdate = true;
    }

    // Short running mean of water flux: vegetation follows the moving water instead of staying fixed.
    updateMoisture(grid) {
        const n = grid.elevation.length;
        if (!this.moisture || this.moisture.length !== n) this.moisture = new Float32Array(n);
        let max = 0;
        const flux = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            flux[i] = grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i]);
            max = Math.max(max, flux[i]);
        }
        this.fluxMax = Math.max(max, (this.fluxMax || 0) * 0.995);
        for (let i = 0; i < n; i++) {
            const f = this.fluxMax > 0 ? Math.sqrt(flux[i] / this.fluxMax) : 0;
            this.moisture[i] += (f - this.moisture[i]) * 0.3;
        }
    }

    // Black volcanic sand; phosphorescent green where little water flows, hue and glow
    // varying with the surface angle and the flux.
    volcanicColor(grid, i, normals, color) {
        const m = this.moisture[i];
        const t = performance.now() / 1000;
        const shimmer = 0.85 + 0.15 * Math.sin(t * 1.5 + grid.vertices[i].x * 0.7 + grid.vertices[i].z * 0.5);
        const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
        const growth = smooth(0.02, 0.12, m) * (1 - smooth(0.35, 0.8, m));
        const ny = normals.getY(i);
        const nx = normals.getX(i);
        const facing = Math.max(0, Math.min(1, 0.5 + 0.9 * (nx * 0.4 + ny - 0.85)));
        const hue = 0.17 + 0.17 * Math.min(1, m * 2.5) + 0.05 * (1 - facing);
        const lightness = 0.07 + 0.5 * growth * shimmer * (0.35 + 0.65 * facing);
        color.setHSL(hue, 0.95 * growth, lightness);
        const rock = grid.elevation[i] <= grid.bedrock[i] + 1e-8 ? 0.035 : 0.018;
        color.r += rock; color.g += rock; color.b += rock * 1.1;
        if (m >= 0.8) color.lerp(new THREE.Color(0.05, 0.1, 0.14), smooth(0.8, 1, m) * 0.7);
    }

    // cmocean "deep": light for bare bedrock, dark for the full initial sand thickness.
    deepColor(t, color) {
        const stops = TerrainRenderer.DEEP;
        const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(x));
        const f = x - k;
        color.setRGB(stops[k][0] + (stops[k + 1][0] - stops[k][0]) * f,
            stops[k][1] + (stops[k + 1][1] - stops[k][1]) * f,
            stops[k][2] + (stops[k + 1][2] - stops[k][2]) * f);
    }

    updateParticles(physics) {
        if (!this.particleMesh) {
            this.particleMesh = new THREE.InstancedMesh(
                new THREE.SphereGeometry(physics.particleRadius, 8, 6),
                new THREE.MeshPhongMaterial({ color: 0x32b9ff, emissive: 0x075080 }),
                physics.particles.length
            );
            this.particleMesh.frustumCulled = false;
            this.scene.add(this.particleMesh);
        }
        physics.particles.forEach((particle, i) => {
            const sample = physics.grid.sample(particle.x, particle.z);
            if (!sample) throw new Error('Cannot render particle outside the terrain mesh');
            this.dummy.position.set(particle.x, sample.height + 0.13, particle.z);
            this.dummy.updateMatrix();
            this.particleMesh.setMatrixAt(i, this.dummy.matrix);
        });
        this.particleMesh.instanceMatrix.needsUpdate = true;
    }

    cycleDisplayMode() {
        const modes = ['elevation', 'sand depth', 'flux', 'sediment'];
        this.displayMode = modes[(modes.indexOf(this.displayMode) + 1) % modes.length];
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.fov = 2 * Math.atan(Math.tan(55 * Math.PI / 360) /
            Math.min(1, this.camera.aspect)) * 180 / Math.PI;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    dispose() {
        this.scene.traverse(object => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) object.material.dispose();
        });
        this.renderer.dispose();
    }
}

TerrainRenderer.DEEP = [[0.993, 0.994, 0.8], [0.866, 0.947, 0.73], [0.734, 0.902, 0.676], [0.596, 0.857, 0.645],
    [0.47, 0.806, 0.639], [0.383, 0.747, 0.643], [0.334, 0.684, 0.641], [0.305, 0.62, 0.632], [0.283, 0.556, 0.619],
    [0.264, 0.498, 0.605], [0.248, 0.436, 0.592], [0.242, 0.371, 0.578], [0.251, 0.303, 0.548], [0.255, 0.243, 0.464],
    [0.232, 0.195, 0.36], [0.197, 0.149, 0.262], [0.156, 0.103, 0.173]];
