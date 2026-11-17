/**
 * Three.js view of the erodible bed, fixed surround and water parcels.
 */
class TerrainRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e27);
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 40, 35);
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
            vertexColors: true, side: THREE.DoubleSide, shininess: 8
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
        this.scene.add(new THREE.Mesh(apron, new THREE.MeshPhongMaterial({ color: 0x747c78, side: THREE.DoubleSide })));

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
        this.scene.add(new THREE.Mesh(wall, new THREE.MeshPhongMaterial({ color: 0x555e5a, side: THREE.DoubleSide })));
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
        for (let i = 0; i < grid.elevation.length; i++) {
            if (this.displayMode === 'elevation') {
                const t = Math.max(0, Math.min(1, (grid.elevation[i] - grid.initialSandDepth) /
                    (grid.radius * grid.slope)));
                if (grid.elevation[i] <= grid.bedrock[i] + 1e-8) {
                    color.setRGB(0.29, 0.32, 0.32);
                } else {
                    const initialHeight = grid.bedrock[i] + grid.initialSandDepth;
                    const erosion = Math.max(0, Math.min(1, (initialHeight - grid.elevation[i]) / 0.08));
                    const shade = 1 - 0.6 * erosion;
                    color.setRGB((0.30 + 0.30 * t) * shade, (0.25 + 0.29 * t) * shade,
                        (0.16 + 0.20 * t) * shade);
                }
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
        const modes = ['elevation', 'flux', 'sediment'];
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
