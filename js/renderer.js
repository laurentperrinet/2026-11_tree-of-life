/**
 * Three.js renderer for 3D terrain visualization
 */
class TerrainRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e27);
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 30, 30);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(20, 30, 20);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -50;
        directionalLight.shadow.camera.right = 50;
        directionalLight.shadow.camera.top = 50;
        directionalLight.shadow.camera.bottom = -50;
        this.scene.add(directionalLight);
        
        // Terrain mesh
        this.terrainMesh = null;
        this.displayMode = 'elevation'; // elevation, flux, sediment
        this.colorMap = this.createColorMap();
        
        // Animation loop tracking
        this.animationFrameId = null;
        
        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());
    }
    
    /**
     * Create terrain mesh geometry
     */
    createTerrainMesh(grid) {
        const w = grid.width;
        const h = grid.height;
        const cs = grid.cellSize;
        
        // Remove old mesh
        if (this.terrainMesh) {
            this.scene.remove(this.terrainMesh);
        }
        
        // Geometry
        const geometry = new THREE.BufferGeometry();
        
        // Vertices
        const vertices = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                vertices.push(
                    (x - w / 2) * cs,           // x
                    grid.elevation[idx],        // y (height)
                    (y - h / 2) * cs            // z
                );
            }
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        
        // Indices (two triangles per cell)
        const indices = [];
        for (let y = 0; y < h - 1; y++) {
            for (let x = 0; x < w - 1; x++) {
                const a = y * w + x;
                const b = y * w + (x + 1);
                const c = (y + 1) * w + x;
                const d = (y + 1) * w + (x + 1);
                
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        geometry.computeVertexNormals();
        
        // Material
        const material = new THREE.MeshPhongMaterial({
            flatShading: false,
            wireframe: false
        });
        
        // Mesh
        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.castShadow = true;
        this.terrainMesh.receiveShadow = true;
        this.scene.add(this.terrainMesh);
        
        // Update colors
        this.updateTerrainColors(grid);
    }
    
    /**
     * Update terrain mesh geometry and colors
     */
    updateTerrainMesh(grid) {
        if (!this.terrainMesh) {
            this.createTerrainMesh(grid);
            return;
        }
        
        const w = grid.width;
        const h = grid.height;
        const cs = grid.cellSize;
        
        // Update positions
        const positions = this.terrainMesh.geometry.attributes.position.array;
        let posIdx = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                positions[posIdx++] = (x - w / 2) * cs;
                positions[posIdx++] = grid.elevation[idx];
                positions[posIdx++] = (y - h / 2) * cs;
            }
        }
        this.terrainMesh.geometry.attributes.position.needsUpdate = true;
        this.terrainMesh.geometry.computeVertexNormals();
        
        // Update colors
        this.updateTerrainColors(grid);
    }
    
    /**
     * Update terrain vertex colors based on display mode
     */
    updateTerrainColors(grid) {
        const w = grid.width;
        const h = grid.height;
        
        const colors = [];
        let minVal = Infinity;
        let maxVal = -Infinity;
        
        // Calculate value range
        for (let i = 0; i < w * h; i++) {
            let val;
            switch (this.displayMode) {
                case 'elevation':
                    val = grid.elevation[i];
                    break;
                case 'flux':
                    val = Math.sqrt(grid.velocityX[i] ** 2 + grid.velocityY[i] ** 2) * grid.waterDepth[i];
                    break;
                case 'sediment':
                    val = grid.sediment[i];
                    break;
                default:
                    val = grid.elevation[i];
            }
            minVal = Math.min(minVal, val);
            maxVal = Math.max(maxVal, val);
        }
        
        if (maxVal === minVal) maxVal = minVal + 1;
        
        // Map values to colors
        for (let i = 0; i < w * h; i++) {
            let val;
            switch (this.displayMode) {
                case 'elevation':
                    val = grid.elevation[i];
                    break;
                case 'flux':
                    val = Math.sqrt(grid.velocityX[i] ** 2 + grid.velocityY[i] ** 2) * grid.waterDepth[i];
                    break;
                case 'sediment':
                    val = grid.sediment[i];
                    break;
                default:
                    val = grid.elevation[i];
            }
            
            const normalized = (val - minVal) / (maxVal - minVal);
            const color = this.getColorFromValue(normalized, this.displayMode);
            colors.push(color.r, color.g, color.b);
        }
        
        if (!this.terrainMesh.geometry.attributes.color) {
            this.terrainMesh.geometry.setAttribute('color', 
                new THREE.BufferAttribute(new Float32Array(colors), 3));
            this.terrainMesh.material.vertexColors = true;
        } else {
            this.terrainMesh.geometry.attributes.color.array.set(colors);
            this.terrainMesh.geometry.attributes.color.needsUpdate = true;
        }
    }
    
    /**
     * Get color from normalized value [0,1]
     */
    getColorFromValue(t, mode) {
        if (mode === 'elevation') {
            // Blue (low) -> Red (high)
            if (t < 0.25) {
                return new THREE.Color().lerpColors(
                    new THREE.Color(0x0033ff), // dark blue
                    new THREE.Color(0x00ffff), // cyan
                    t * 4
                );
            } else if (t < 0.5) {
                return new THREE.Color().lerpColors(
                    new THREE.Color(0x00ffff), // cyan
                    new THREE.Color(0x00ff00), // green
                    (t - 0.25) * 4
                );
            } else if (t < 0.75) {
                return new THREE.Color().lerpColors(
                    new THREE.Color(0x00ff00), // green
                    new THREE.Color(0xffff00), // yellow
                    (t - 0.5) * 4
                );
            } else {
                return new THREE.Color().lerpColors(
                    new THREE.Color(0xffff00), // yellow
                    new THREE.Color(0xff0000), // red
                    (t - 0.75) * 4
                );
            }
        } else if (mode === 'flux') {
            // Cyan (low) -> White (high)
            return new THREE.Color().lerpColors(
                new THREE.Color(0x00ffff),
                new THREE.Color(0xffffff),
                t
            );
        } else if (mode === 'sediment') {
            // Black (low) -> Yellow (high)
            return new THREE.Color().lerpColors(
                new THREE.Color(0x000000),
                new THREE.Color(0xffff00),
                t
            );
        }
        return new THREE.Color(0xffffff);
    }
    
    /**
     * Cycle display mode
     */
    cycleDisplayMode() {
        const modes = ['elevation', 'flux', 'sediment'];
        const currentIdx = modes.indexOf(this.displayMode);
        this.displayMode = modes[(currentIdx + 1) % modes.length];
        
        if (this.terrainMesh) {
            // Re-apply colors for new mode
            const grid = window.app?.physics?.grid;
            if (grid) {
                this.updateTerrainColors(grid);
            }
        }
    }
    
    /**
     * Render frame
     */
    render() {
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Handle window resize
     */
    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    /**
     * Create default color map
     */
    createColorMap() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        
        const gradient = ctx.createLinearGradient(0, 0, 256, 0);
        gradient.addColorStop(0, '#0033ff');
        gradient.addColorStop(0.25, '#00ffff');
        gradient.addColorStop(0.5, '#00ff00');
        gradient.addColorStop(0.75, '#ffff00');
        gradient.addColorStop(1, '#ff0000');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 1);
        
        return new THREE.CanvasTexture(canvas);
    }
    
    /**
     * Clean up
     */
    dispose() {
        if (this.terrainMesh) {
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
        }
        this.renderer.dispose();
    }
}
