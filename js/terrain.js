/**
 * TerrainGrid - 2D terrain state with water flow and sediment transport
 * Stores: elevation h(x,y), water depth w(x,y), sediment concentration c(x,y)
 */
class TerrainGrid {
    constructor(width, height, cellSize = 1.0) {
        this.width = width;
        this.height = height;
        this.cellSize = cellSize;
        
        // Main state arrays (flattened for performance)
        this.elevation = new Float32Array(width * height);  // h(x,y) - terrain height
        this.waterDepth = new Float32Array(width * height); // w(x,y) - water thickness
        this.sediment = new Float32Array(width * height);   // c(x,y) - sediment concentration [0,1]
        
        // Velocity fields
        this.velocityX = new Float32Array(width * height);  // u - x-component velocity
        this.velocityY = new Float32Array(width * height);  // v - y-component velocity
        
        // Sediment flux fields
        this.fluxX = new Float32Array(width * height);      // Qsx - x-flux
        this.fluxY = new Float32Array(width * height);      // Qsy - y-flux
        
        // Temporary arrays for double-buffering
        this.elevationNew = new Float32Array(width * height);
        this.waterDepthNew = new Float32Array(width * height);
        this.sedimentNew = new Float32Array(width * height);
        
        // Energy tracking for convergence detection
        this.totalEnergy = 0;
        this.energyHistory = [];
        
        // Initialization
        this.initialize();
    }
    
    /**
     * Initialize terrain as a circular basin (cone-like cirque)
     */
    initialize() {
        const cx = this.width / 2;
        const cy = this.height / 2;
        const R = Math.min(this.width, this.height) / 3;
        const h_max = 2.0;
        
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const idx = y * this.width + x;
                const dx = (x - cx) * this.cellSize;
                const dy = (y - cy) * this.cellSize;
                const r = Math.sqrt(dx * dx + dy * dy);
                
                // Cone terrain: peaks at edges, depression at center
                if (r < R) {
                    const t = r / R;
                    this.elevation[idx] = h_max * (1 - t * t) * Math.cos(Math.atan2(dy, dx) * 4);
                } else {
                    this.elevation[idx] = -0.5 + (r - R) * 0.1; // Outer slopes down
                }
                
                // Add small random perturbations to seed bifurcation
                this.elevation[idx] += (Math.random() - 0.5) * 0.05 * h_max;
                
                // Inject water at top (center depression)
                if (r < R * 0.15) {
                    this.waterDepth[idx] = 0.3;
                    this.sediment[idx] = 0.5;
                }
            }
        }
        
        // Copy to new arrays
        this.elevationNew.set(this.elevation);
        this.waterDepthNew.set(this.waterDepth);
        this.sedimentNew.set(this.sediment);
    }
    
    /**
     * Get value at index, clamped to bounds
     */
    get(array, x, y) {
        x = Math.max(0, Math.min(this.width - 1, x));
        y = Math.max(0, Math.min(this.height - 1, y));
        return array[y * this.width + x];
    }
    
    /**
     * Get gradient (for flow calculation)
     */
    getGradient(array, x, y) {
        const dx = (this.get(array, x + 1, y) - this.get(array, x - 1, y)) / (2 * this.cellSize);
        const dy = (this.get(array, x, y + 1) - this.get(array, x, y - 1)) / (2 * this.cellSize);
        return { dx, dy };
    }
    
    /**
     * Get surface elevation (terrain + water)
     */
    getSurfaceElevation(x, y) {
        const idx = y * this.width + x;
        return this.elevation[idx] + this.waterDepth[idx];
    }
    
    /**
     * Calculate total kinetic energy for convergence detection
     */
    calculateEnergy() {
        let energy = 0;
        for (let i = 0; i < this.width * this.height; i++) {
            const u = this.velocityX[i];
            const v = this.velocityY[i];
            const h = this.waterDepth[i];
            energy += (u * u + v * v) * h;
        }
        this.totalEnergy = energy;
        
        // Keep history for stability check
        this.energyHistory.push(energy);
        if (this.energyHistory.length > 30) {
            this.energyHistory.shift();
        }
        
        return energy;
    }
    
    /**
     * Check if terrain has converged (energy plateau)
     * Returns: { converged: bool, stability: 0-100 }
     */
    checkConvergence() {
        if (this.energyHistory.length < 30) {
            return { converged: false, stability: 0 };
        }
        
        const recent = this.energyHistory.slice(-30);
        const avgOld = recent.slice(0, 15).reduce((a, b) => a + b) / 15;
        const avgNew = recent.slice(-15).reduce((a, b) => a + b) / 15;
        
        if (avgOld < 1e-6) {
            return { converged: true, stability: 100 };
        }
        
        const deltaE = Math.abs(avgNew - avgOld) / avgOld;
        const stability = Math.max(0, 100 * (1 - Math.min(1, deltaE / 0.05)));
        const converged = stability > 95;
        
        return { converged, stability };
    }
    
    /**
     * Serialize to JSON for GitHub persistence
     */
    toJSON() {
        return {
            version: "1.0",
            timestamp: new Date().toISOString(),
            grid: {
                width: this.width,
                height: this.height,
                cellSize: this.cellSize
            },
            elevation: Array.from(this.elevation),
            waterDepth: Array.from(this.waterDepth),
            sediment: Array.from(this.sediment),
            metadata: {
                totalEnergy: this.totalEnergy,
                convergenceChecked: this.checkConvergence()
            }
        };
    }
    
    /**
     * Deserialize from JSON
     */
    fromJSON(json) {
        if (json.grid.width !== this.width || json.grid.height !== this.height) {
            console.warn('Grid size mismatch, reinitializing');
            return false;
        }
        
        this.elevation.set(json.elevation);
        this.waterDepth.set(json.waterDepth);
        this.sediment.set(json.sediment);
        this.elevationNew.set(this.elevation);
        this.waterDepthNew.set(this.waterDepth);
        this.sedimentNew.set(this.sediment);
        
        return true;
    }
    
    /**
     * Merge contributions from another terrain (collaborative)
     * Strategy: h_global = max(h_old, h_contrib)
     */
    mergeContribution(other) {
        for (let i = 0; i < this.width * this.height; i++) {
            // Take maximum elevation (erosion accumulates)
            this.elevation[i] = Math.max(this.elevation[i], other.elevation[i]);
            
            // Reinject water at source
            if (other.waterDepth[i] > 0) {
                this.waterDepth[i] = Math.max(this.waterDepth[i], other.waterDepth[i] * 0.5);
            }
            
            // Average sediment concentration
            this.sediment[i] = (this.sediment[i] + other.sediment[i]) / 2;
        }
        
        this.elevationNew.set(this.elevation);
    }
}
