/**
 * Three.js view of the erodible bed, fixed surround and water parcels.
 */
class TerrainRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05070d);
        this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 65, 0);
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(0, 0, 0);
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const light = new THREE.DirectionalLight(0xffffff, 0.85);
        light.position.set(20, 40, 20);
        this.scene.add(light);
        this.terrainMesh = null;
        this.biologyMesh = null;
        this.particleMesh = null;
        this.displayMode = 'elevation';
        this.dummy = new THREE.Object3D();
        window.addEventListener('resize', () => this.onWindowResize());
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
        const positions = new Float32Array(biology.active.length * 3);
        const indices = [];
        for (let z = 0; z < biology.size; z++) {
            for (let x = 0; x < biology.size; x++) {
                const i = z * biology.size + x;
                positions[3 * i] = x * biology.spacing - biology.terrain.radius;
                positions[3 * i + 2] = z * biology.spacing - biology.terrain.radius;
                if (x + 1 >= biology.size || z + 1 >= biology.size) continue;
                const right = i + 1, below = i + biology.size, diagonal = below + 1;
                if (biology.active[i] && biology.active[below] && biology.active[right]) {
                    indices.push(i, below, right);
                }
                if (biology.active[right] && biology.active[below] && biology.active[diagonal]) {
                    indices.push(right, below, diagonal);
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
        geometry.setIndex(indices);
        this.biologyMesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
            vertexColors: true, side: THREE.DoubleSide, shininess: 25
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
        this.biologyMesh.visible = this.displayMode === 'elevation';
        if (this.biologyMesh.visible) this.updateBiologyMesh(biology);
    }

    updateBiologyMesh(biology) {
        const geometry = this.biologyMesh.geometry;
        const positions = geometry.attributes.position;
        for (let i = 0; i < biology.active.length; i++) {
            if (biology.active[i]) positions.array[3 * i + 1] = biology.terrainValue(i, biology.terrain.elevation) + 0.015;
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
        const colors = geometry.attributes.color;
        const normals = geometry.attributes.normal;
        const color = new THREE.Color();
        for (let i = 0; i < biology.active.length; i++) {
            if (!biology.active[i]) continue;
            this.volcanicColor(biology, i, normals, color);
            colors.setXYZ(i, color.r, color.g, color.b);
        }
        colors.needsUpdate = true;
    }

    updateTerrainColors(grid) {
        const colors = this.terrainMesh.geometry.attributes.color;
        const material = this.terrainMesh.material;
        material.wireframe = this.displayMode === 'mesh';
        const sandView = this.displayMode === 'sand depth';
        const brightness = sandView ? 0.6 : material.wireframe ? 0.3 : 1;
        const specular = sandView || material.wireframe ? 0 : 17 / 255;
        material.color.setRGB(brightness, brightness, brightness);
        material.specular.setRGB(specular, specular, specular);
        let max = 0;
        if (this.displayMode === 'flux' || this.displayMode === 'sediment') {
            for (let i = 0; i < grid.elevation.length; i++) {
                const value = this.displayMode === 'flux'
                    ? grid.waterDepth[i] * Math.hypot(grid.velocityX[i], grid.velocityY[i])
                    : grid.sediment[i];
                max = Math.max(max, value);
            }
        }
        const color = new THREE.Color();
        for (let i = 0; i < grid.elevation.length; i++) {
            if (this.displayMode === 'mesh') {
                color.setRGB(0.55, 0.65, 0.7);
            } else if (i >= grid.erodibleCount) {
                color.setRGB(0, 0, 0);
            } else if (this.displayMode === 'elevation') {
                color.setRGB(0.053, 0.053, 0.055);
            } else if (this.displayMode === 'sand depth') {
                const depth = (grid.elevation[i] - grid.bedrock[i]) / grid.initialSandDepth;
                this.deepColor(depth / TerrainRenderer.SAND_DEPTH_DISPLAY_MAX, color);
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
            if (!sample) throw new Error('Cannot render particle outside the terrain mesh');
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
        const modes = ['elevation', 'mesh', 'sand depth', 'flux', 'sediment'];
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
// Sand depth (in multiples of the initial thickness) shown with the lightest colour;
// the initial layer then sits mid-palette and accumulations remain distinguishable.
TerrainRenderer.SAND_DEPTH_DISPLAY_MAX = 2;
