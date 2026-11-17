/**
 * Three.js view of the erodible bed, fixed surround and water parcels.
 */
class TerrainRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05070d);
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 85, 40);
        this.camera.lookAt(0, 0, 0);
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const light = new THREE.DirectionalLight(0xffffff, 0.85);
        light.position.set(20, 40, 20);
        this.scene.add(light);
        this.terrainMesh = null;
        this.particleMesh = null;
        this.mushroomCaps = null;
        this.mushroomStems = null;
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
        this.createMushroomMeshes(grid);
        this.updateTerrainColors(grid);
        this.updateMushrooms(grid);
    }

    createMushroomMeshes(grid) {
        for (const mesh of [this.mushroomCaps, this.mushroomStems]) {
            if (!mesh) continue;
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.mushroomCaps = new THREE.InstancedMesh(
            new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 8 }),
            grid.mushroomSites.length
        );
        this.mushroomStems = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(1, 1, 1, 6),
            new THREE.MeshPhongMaterial({ color: 0x9d816d, shininess: 4 }),
            grid.mushroomSites.length
        );
        if (grid.mushroomSites.length > 0) this.mushroomCaps.setColorAt(0, new THREE.Color(0xffffff));
        for (const mesh of [this.mushroomCaps, this.mushroomStems]) {
            mesh.count = 0;
            mesh.frustumCulled = false;
            this.scene.add(mesh);
        }
    }

    updateTerrainMesh(grid) {
        const positions = this.terrainMesh.geometry.attributes.position;
        for (let i = 0; i < grid.elevation.length; i++) positions.array[3 * i + 1] = grid.elevation[i];
        positions.needsUpdate = true;
        this.terrainMesh.geometry.computeVertexNormals();
        this.updateTerrainColors(grid);
        this.updateMushrooms(grid);
    }

    updateMushrooms(grid) {
        const visible = this.displayMode === 'elevation';
        this.mushroomCaps.visible = visible;
        this.mushroomStems.visible = visible;
        if (!visible) return;
        const ochre = new THREE.Color(0xc4934e);
        const violet = new THREE.Color(0x865482);
        const color = new THREE.Color();
        let count = 0;
        for (let site = 0; site < grid.mushroomSites.length; site++) {
            const growth = grid.mushrooms[site];
            if (growth <= 0.001) continue;
            const i = grid.mushroomSites[site];
            const point = grid.vertices[i];
            const variation = (Math.imul(i ^ (i >>> 8), 0x27d4eb2d) >>> 0) / 0xffffffff;
            const size = Math.sqrt(growth) * (0.85 + variation * 0.3);
            const stemHeight = 0.24 * size;
            this.dummy.position.set(point.x, grid.elevation[i] + stemHeight / 2, point.z);
            this.dummy.scale.set(0.035 * size, stemHeight, 0.035 * size);
            this.dummy.updateMatrix();
            this.mushroomStems.setMatrixAt(count, this.dummy.matrix);
            this.dummy.position.y = grid.elevation[i] + stemHeight;
            this.dummy.scale.set(0.2 * size, 0.1 * size, 0.2 * size);
            this.dummy.updateMatrix();
            this.mushroomCaps.setMatrixAt(count, this.dummy.matrix);
            color.copy(ochre).lerp(violet, variation);
            this.mushroomCaps.setColorAt(count, color);
            count++;
        }
        this.mushroomCaps.count = count;
        this.mushroomStems.count = count;
        this.mushroomCaps.instanceMatrix.needsUpdate = true;
        this.mushroomStems.instanceMatrix.needsUpdate = true;
        if (this.mushroomCaps.instanceColor) this.mushroomCaps.instanceColor.needsUpdate = true;
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
        for (let i = 0; i < grid.elevation.length; i++) {
            if (i >= grid.erodibleCount) {
                color.setRGB(0.055, 0.065, 0.075);
            } else if (this.displayMode === 'elevation') {
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

    volcanicColor(grid, i, normals, color) {
        const growth = grid.vegetation[i];
        const ny = normals.getY(i);
        const nx = normals.getX(i);
        const facing = Math.max(0, Math.min(1, 0.5 + 0.9 * (nx * 0.4 + ny - 0.85)));
        const hue = 0.17 + 0.04 * (1 - facing);
        const lightness = 0.035 + 0.45 * growth * (0.5 + 0.5 * facing);
        color.setHSL(hue, 0.95 * growth, lightness);
        const rock = grid.elevation[i] <= grid.bedrock[i] + 1e-8 ? 0.035 : 0.018;
        color.r += rock; color.g += rock; color.b += rock * 1.1;
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
                new THREE.SphereGeometry(physics.particleRadius * 0.5, 8, 6),
                new THREE.MeshPhongMaterial({ color: 0x567b88, shininess: 12 }),
                physics.particles.length
            );
            this.particleMesh.frustumCulled = false;
            this.scene.add(this.particleMesh);
        }
        physics.particles.forEach((particle, i) => {
            const sample = physics.grid.sample(particle.x, particle.z);
            if (!sample) throw new Error('Cannot render particle outside the terrain mesh');
            this.dummy.position.set(particle.x, sample.height + 0.02, particle.z);
            this.dummy.scale.set(1, 0.3, 1);
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
