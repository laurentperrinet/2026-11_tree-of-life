/**
 * Physics simulation - Shallow water equations + sediment transport
 * 
 * Equations:
 * ∂h/∂t = -∇·(h*u)           [continuity]
 * u = -g*∇(h+b)              [momentum (gravity-driven)]
 * Q_s = k*u*c                [sediment transport]
 * ∂b/∂t = -∇·Q_s             [Exner - terrain evolution]
 */
class PhysicsEngine {
    constructor(grid) {
        this.grid = grid;
        this.dt = 0.01;           // Time step (seconds)
        this.g = 9.81;            // Gravity (m/s²)
        this.friction = 0.02;     // Friction coefficient
        this.k_transport = 0.1;   // Sediment transport coeff
        this.Q_inlet = 0.5;       // Inlet flow rate (adjustable)
        this.timeScale = 1.0;     // Simulation speed multiplier
    }
    
    /**
     * Main simulation step
     */
    step() {
        const grid = this.grid;
        const w = grid.width;
        const h = grid.height;
        
        // Step 1: Recycle water at inlet (top center)
        this.injectWater();
        
        // Step 2: Calculate flow velocities
        this.calculateFlow();
        
        // Step 3: Transport sediment
        this.transportSediment();
        
        // Step 4: Erode/deposit terrain
        this.erodeTerrain();
        
        // Step 5: Update water depth (continuity)
        this.updateWaterDepth();
        
        // Step 6: Drain outlet (bottom)
        this.drainOutlet();
        
        // Step 7: Swap buffers
        let temp;
        temp = grid.elevation;
        grid.elevation = grid.elevationNew;
        grid.elevationNew = temp;
        
        temp = grid.waterDepth;
        grid.waterDepth = grid.waterDepthNew;
        grid.waterDepthNew = temp;
        
        temp = grid.sediment;
        grid.sediment = grid.sedimentNew;
        grid.sedimentNew = temp;
        
        // Track energy for convergence detection
        grid.calculateEnergy();
    }
    
    /**
     * Inject water at top inlet (center of domain)
     */
    injectWater() {
        const grid = this.grid;
        const cx = Math.floor(grid.width / 2);
        const cy = Math.floor(grid.height / 8);
        
        const inletRadius = 3;
        const sedimentConc = 0.3; // Initial sediment concentration
        
        for (let dy = -inletRadius; dy <= inletRadius; dy++) {
            for (let dx = -inletRadius; dx <= inletRadius; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                
                if (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
                    const idx = y * grid.width + x;
                    grid.waterDepth[idx] += this.Q_inlet * this.dt;
                    grid.sediment[idx] = Math.min(1.0, grid.sediment[idx] + sedimentConc * this.dt * 0.1);
                }
            }
        }
    }
    
    /**
     * Calculate flow velocities (shallow water momentum)
     */
    calculateFlow() {
        const grid = this.grid;
        const w = grid.width;
        const h = grid.height;
        const g = this.g;
        const friction = this.friction;
        const cs = grid.cellSize;
        
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                
                // Total surface elevation (bed + water)
                const surfH = grid.getSurfaceElevation(x, y);
                const surfH_xp = grid.getSurfaceElevation(x + 1, y);
                const surfH_xm = grid.getSurfaceElevation(x - 1, y);
                const surfH_yp = grid.getSurfaceElevation(x, y + 1);
                const surfH_ym = grid.getSurfaceElevation(x, y - 1);
                
                // Gradient of surface elevation
                const gradX = (surfH_xp - surfH_xm) / (2 * cs);
                const gradY = (surfH_yp - surfH_ym) / (2 * cs);
                
                // Gravity-driven flow
                let u = -g * gradX;
                let v = -g * gradY;
                
                // Friction damping
                const speed = Math.sqrt(u * u + v * v);
                const damping = 1 - friction * this.dt;
                u *= damping;
                v *= damping;
                
                // Limit velocity (stability)
                const maxU = 2.0;
                if (speed > maxU) {
                    const scale = maxU / (speed + 1e-6);
                    u *= scale;
                    v *= scale;
                }
                
                grid.velocityX[idx] = u;
                grid.velocityY[idx] = v;
            }
        }
        
        // Boundary conditions: zero velocity at edges
        for (let x = 0; x < w; x++) {
            grid.velocityX[0 * w + x] = 0;
            grid.velocityY[0 * w + x] = 0;
            grid.velocityX[(h - 1) * w + x] = 0;
            grid.velocityY[(h - 1) * w + x] = 0;
        }
        for (let y = 0; y < h; y++) {
            grid.velocityX[y * w + 0] = 0;
            grid.velocityY[y * w + 0] = 0;
            grid.velocityX[y * w + (w - 1)] = 0;
            grid.velocityY[y * w + (w - 1)] = 0;
        }
    }
    
    /**
     * Transport sediment based on flow
     * Q_s = k * u * c (sediment flux)
     */
    transportSediment() {
        const grid = this.grid;
        const w = grid.width;
        const h = grid.height;
        const k = this.k_transport;
        const cs = grid.cellSize;
        
        // Calculate sediment flux at cell centers
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const u = grid.velocityX[idx];
                const v = grid.velocityY[idx];
                const c = grid.sediment[idx];
                
                // Sediment capacity ~ velocity magnitude
                const speed = Math.sqrt(u * u + v * v);
                const capacity = k * speed;
                
                // Limit concentration
                grid.sediment[idx] = Math.min(1.0, c + capacity * this.dt);
                
                // Store flux components
                grid.fluxX[idx] = u * c;
                grid.fluxY[idx] = v * c;
            }
        }
    }
    
    /**
     * Erode/deposit based on sediment flux divergence
     * ∂b/∂t = -∇·Q_s (Exner equation)
     */
    erodeTerrain() {
        const grid = this.grid;
        const w = grid.width;
        const h = grid.height;
        const cs = grid.cellSize;
        const dt = this.dt * this.timeScale;
        
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                
                // Divergence of sediment flux
                const divFluxX = (grid.fluxX[y * w + (x + 1)] - grid.fluxX[y * w + (x - 1)]) / (2 * cs);
                const divFluxY = (grid.fluxY[(y + 1) * w + x] - grid.fluxY[(y - 1) * w + x]) / (2 * cs);
                const divFlux = divFluxX + divFluxY;
                
                // Update bed elevation (erosion if div > 0, deposition if div < 0)
                grid.elevationNew[idx] = grid.elevation[idx] - divFlux * dt;
                
                // Constrain elevation
                grid.elevationNew[idx] = Math.max(-5.0, grid.elevationNew[idx]);
            }
        }
    }
    
    /**
     * Update water depth from continuity equation
     * ∂h/∂t = -∇·(h*u)
     */
    updateWaterDepth() {
        const grid = this.grid;
        const w = grid.width;
        const h = grid.height;
        const cs = grid.cellSize;
        const dt = this.dt * this.timeScale;
        
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                
                // Water volume flux
                const wh = grid.waterDepth[idx];
                const u = grid.velocityX[idx];
                const v = grid.velocityY[idx];
                
                // Divergence of volume flux
                const whxp = grid.waterDepth[y * w + (x + 1)] * grid.velocityX[y * w + (x + 1)];
                const whxm = grid.waterDepth[y * w + (x - 1)] * grid.velocityX[y * w + (x - 1)];
                const whyp = grid.waterDepth[(y + 1) * w + x] * grid.velocityY[(y + 1) * w + x];
                const whym = grid.waterDepth[(y - 1) * w + x] * grid.velocityY[(y - 1) * w + x];
                
                const divFlux = ((whxp - whxm) / (2 * cs)) + ((whyp - whym) / (2 * cs));
                
                // Update water depth
                grid.waterDepthNew[idx] = Math.max(0.001, grid.waterDepth[idx] - divFlux * dt);
            }
        }
    }
    
    /**
     * Drain outlet at bottom (recycle to inlet)
     */
    drainOutlet() {
        const grid = this.grid;
        const w = grid.width;
        const h = grid.height;
        const bottomRow = h - 3;
        
        // Drain water from bottom rows
        for (let x = 0; x < w; x++) {
            const idx = bottomRow * w + x;
            grid.waterDepthNew[idx] = Math.max(0, grid.waterDepthNew[idx] * 0.8);
        }
    }
    
    /**
     * Reset simulation (for recovery from bad convergence)
     */
    reset() {
        this.grid.initialize();
    }
}
