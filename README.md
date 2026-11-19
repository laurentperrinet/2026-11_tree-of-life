# Tree of Life: a collaborative erosion simulation

**Live site:** <https://laurentperrinet.github.io/2026-11_tree-of-life/>

Tree of Life is a browser simulation of water carving channels in a sandy bed.
It was inspired by "Tree of Life" photographs of branching rivulets on Icelandic
beaches. Each visitor runs the full model locally: 1,500 water parcels move
across a triangular mesh, erode sand and deposit it again, while vegetation and
microbial colonies grow on the evolving bed. Visitors share only the bed
**elevation**. A Cloudflare Worker averages the elevation changes contributed by
each browser into a common terrain, so everyone sculpts the same landscape.

This is an **exploratory particle model**. It is not a calibrated hydrodynamic
or morphodynamic solver: it does not solve the shallow-water or Exner equations,
and branching is encouraged but not guaranteed.

```text
 ┌──────────── each browser (local) ────────────┐           ┌──── Cloudflare ─────┐
 │ water parcels ─► erosion / deposition ─► bed │  delta    │ Worker + Durable    │
 │                                          │   ├─────────► │ Object "global":    │
 │ vegetation + microbes (256 × 256 grid) ◄─┘   │           │ mean of the deltas  │
 │                                              │ ◄─────────┤ per vertex, version │
 └──────────────────────────────────────────────┘  shared   └─────────────────────┘
                                                   elevation
```

Water, carried sediment, particles, vegetation and microorganisms **never
leave the browser**. Only the elevation field is shared.

## Contents

1. [Quick start](#quick-start): [visitors](#for-visitors), [owner](#for-the-owner), [developers](#for-developers)
2. [The model](#the-model)
   - [Equations](#equations): [terrain](#terrain), [water parcels](#water-parcels),
     [sediment exchange](#sediment-exchange), [sand avalanches](#sand-avalanches),
     [recycling](#recycling-sink-and-evaporation), [diagnostic fields](#diagnostic-fields),
     [biology](#biology-vegetation-and-microbial-colonies)
   - [Variables](#variables)
   - [Collaboration as an averaging scheme](#collaboration-as-an-averaging-scheme)
3. [Using the simulation](#using-the-simulation): [controls](#controls),
   [display modes](#display-modes), [status bar](#status-bar), [administration](#administration)
4. [Collaboration protocol](#collaboration-protocol)
5. [What is stored where](#what-is-stored-where)
6. [Technical summary](#technical-summary): [data flow](#data-flow),
   [design choices](#design-choices), [history](#history)
7. [Repository files](#repository-files)
8. [Code map](#code-map)
9. [Development](#development): [set-up](#set-up), [tests](#tests), [conventions](#conventions),
   [changing the mesh](#changing-the-mesh-or-the-initial-terrain), [save formats](#save-formats)
10. [Deployment](#deployment)
11. [Performance](#performance)
12. [Troubleshooting](#troubleshooting)
13. [Contributing](#contributing)
14. [Status, limitations and open work](#status-limitations-and-open-work)
15. [Licence](#licence)

---

## Quick start

### For visitors

1. Open <https://laurentperrinet.github.io/2026-11_tree-of-life/>.
2. Drag to orbit, scroll to zoom.
3. Press **D** or click **View** to cycle through `habitat`, `mesh`,
   `sand depth`, `flux` and `sediment`.
4. Click **❔** in the status bar: it explains, in plain words, each indicator
   and how your screen shares the sand with other visitors.

What you see: a circular bed of sand, 50 units across, inside a black square.
Its bedrock is a shallow inverted cone. Water runs towards the centre, then down an
outlet channel to a sink in the middle of the bottom edge. Blue dots are the water
parcels: they pick up sand where they move fast and drop it where they slow down,
so channels deepen where water concentrates. Vegetation (yellow-green) grows along
wet banks, and microbial colonies (ochre to purple) form Turing-like patterns in
calm sandy areas. Keeping the tab open is how you contribute (see
[Contributing](#contributing)).

### For the owner

1. Open <https://laurentperrinet.github.io/2026-11_tree-of-life/?admin>.
2. Click **Sign in with GitHub**.
3. Use **↑**/**↓** (speed) and **S** (sync now) for your own browser (see
   [Controls](#controls)).
4. Press **R** twice, or click **Reset Terrain**, to reset the shared terrain
   (see [Administration](#administration)).

### For developers

```bash
git clone https://github.com/laurentperrinet/2026-11_tree-of-life.git
cd 2026-11_tree-of-life
npx http-server -p 8000 -c-1     # then open http://localhost:8000
npm test                         # about five minutes, mostly the physics suite
```

There is no build step and no runtime npm dependency: the page loads Three.js
r128 from cdnjs and plain scripts from `js/`. Locally, the simulation runs
stand-alone. Sync and sign-in work only from the GitHub Pages origin. Continue
with [Development](#development).

[↑ Contents](#contents)

---

## The model

Lengths are in dimensionless simulation units (u) and times in simulation
seconds (sim s). Gravity is set to $g = 9.81$, so one unit can be read as one
metre, but nothing is calibrated against field data. Horizontal positions are
$(x, z)$ and elevation is vertical, following the Three.js convention ($y$ up).
The sink lies at $z = +L$, which appears at the bottom of the screen.

### Equations

#### Terrain

The bed is a Delaunay triangulation of a Poisson-disk (blue-noise) point set on the
square $[-L, L]^2$, sampled in Cartesian coordinates. Points lie on the four sides
every $\Delta s$, and the interior is filled by Bridson's algorithm under the
constraint

$$\lVert \mathbf{p}_n - \mathbf{p}_{n'} \rVert \ge d_\text{min} \quad (n \ne n'),$$

where $d_\text{min}$ is the minimum distance between points. From an active point,
$k$ candidates are drawn uniformly in the annulus $[d_\text{min}, 2d_\text{min}]$
until one fits; the sample is then close to maximal, with about one point per
$\Delta s^2$. Such a sample is random but evenly spread: it has no preferred
direction and no long-range order. Earlier meshes had both. Polar rings aligned
their vertices along the axes and the diagonals; a Vogel (sunflower) spiral removed
these directions, but its lattice defects lined up on concentric circles where its
parastichies switch from one Fibonacci family to the next. The points are generated
once, with a fixed seed, by `tools/generate-mesh-points.mjs` and stored in
`js/mesh-points.js` as integer micrometres, so that the browser and the Worker read
bit-identical positions. The erodible disk of radius $R$ is the set of points with
$\lVert \mathbf{p}_i \rVert < R$; the other interior points and the border form a
fixed surround. The sides are straight, and each side segment is a Gabriel edge,
hence an edge of the triangulation. The browser triangulates the points by Delaunay
(incremental insertion with Lawson flips, the border inserted first); the smallest
triangle angle is 25.8°. Each vertex $i$ carries an
elevation

$$\eta_i = \beta_i + s_i, \qquad s_i \ge 0,$$

where $\beta_i$ is the fixed, non-erodible bedrock and $s_i$ the sand thickness.
At distance $r = \sqrt{x^2 + z^2}$ from the centre, the bedrock is an inverted
cone

$$c(r) = S\,\min(r, R) + S_\text{out}\,\max(0, r - R) + S_p\,\operatorname{clip}(r - R + W_p,\ 0,\ W_p),$$

where $S$ is the cone slope, $S_\text{out}$ the slope of the surround and $S_p$ an
extra slope over the outermost band of width $W_p$, which drains peripheral water
inwards. Towards the sink ($z > 0$), an outlet channel of half-width
$w(z) = r_s + f z$ descends from the centre with its own slope $S_c$:

$$\beta(x, z) = \begin{cases} c(r) & z \le 0,\\ -S_c z\,\bigl(1 - \sigma(t)\bigr) + c(r)\,\sigma(t) & z > 0, \end{cases}
\qquad t = \operatorname{clip}\!\left(\frac{\lvert x\rvert}{w(z)},\ 0,\ 1\right),$$

with the smoothstep $\sigma(t) = t^2(3 - 2t)$, $r_s$ the sink half-width and $f$ the
channel flare. The bedrock thus rises from $0$ at the centre to $2.99$ u at the
disk edge and falls to $-2.70$ u at the sink. Keeping $S_c$ separate from $S$
lets the funnel be steepened, to speed up the drainage, without deepening the
channel. The initial sand layer is uniform
except in the channel:

$$\eta_i(0) = \beta_i + D_0\,\phi_i,\qquad
\phi(x, z) = \begin{cases} 1 & z \le 0 \text{ or } \lvert x\rvert \ge 1.25\,w(z),\\
0 & z > 0 \text{ and } \lvert x\rvert \le w(z),\\
\sigma\!\bigl((\lvert x\rvert / w(z) - 1)/0.25\bigr) & \text{otherwise,}\end{cases}$$

where $D_0$ is the initial sand depth and $\phi_i \in [0, 1]$ the sand factor. The
channel bed ($\phi = 0$) starts as bare bedrock. Afterwards it behaves like the
rest of the bed: water deposits and re-erodes sand there, avalanches from the
banks reach it, and evaporating parcels drop their load on it. Only the
47,323 vertices inside the disk ($\lVert \mathbf{p}_i \rVert < R$) are erodible. The
surround (the other interior points and the border) can receive sediment from
evaporating parcels, but it is never eroded, and avalanches do not relax the edges
that touch it.

#### Water parcels

Each parcel $p$ has a position $\mathbf{x}_p$, a velocity $\mathbf{v}_p$ and a
sediment load $q_p$ (a volume). The elevation is linearly interpolated over the
triangle containing the parcel with barycentric weights $w_{p,j}$, so the slope
$\nabla\eta$ is constant on each triangle. One physics step is taken per
animation frame, and its length follows the wall-clock time $\Delta t_w$ elapsed
since the previous frame:

$$\Delta t = \rho\,\tau\,\min(\Delta t_w,\ \Delta t_w^{\max}),$$

where $\rho$ is the simulation rate (simulated seconds per wall-clock second), $\tau$
the speed factor and $\Delta t_w^{\max}$ the longest interval credited to one frame.
Simulated time therefore advances at the same pace, $\rho\tau$ sim s per second, on
every device that renders at least $1/\Delta t_w^{\max} = 10$ frames per second. A
slower device, or a tab returning from the background, falls behind real time
instead of taking ever longer, ever slower frames: a frame never simulates more
than $\rho\tau\,\Delta t_w^{\max}$. Called without wall-clock time, as in the tests, the step is the
nominal $\Delta t_0\,\tau$. Each step is split into
$n = \lceil \Delta t / (a / v_\max) \rceil$ substeps of length $\delta = \Delta t / n$,
so that a parcel of radius $a$ travels less than one radius per substep. In each
substep:

$$\mathbf{v}_p \leftarrow \bigl(\mathbf{v}_p - g\,\nabla\eta\,\delta\bigr)\,e^{-k\delta},\qquad
\mathbf{v}_p \leftarrow \mathbf{v}_p\,\min\!\left(1, \frac{v_\max}{\lVert\mathbf{v}_p\rVert}\right),\qquad
\mathbf{x}_p \leftarrow \mathbf{x}_p + \mathbf{v}_p\,\delta,$$

where $k$ is a linear friction rate and $v_\max$ a speed cap. The square walls
$\lvert x\rvert = L$ and $\lvert z\rvert = L$ reflect parcels, except for the sink:
the segment $\lvert x\rvert < r_s$ of the wall $z = L$.

**Pressure.** Overlapping parcels ($d < 2a$, unit normal $\mathbf{n}$ from the
other parcel $o$ to $p$) exchange equal and opposite impulses

$$J = \min\bigl(0.25,\ 6\,(2a - d)\,\delta\bigr) + 0.55\,\max\bigl(0,\ -(\mathbf{v}_p - \mathbf{v}_o)\cdot\mathbf{n}\bigr),
\qquad \mathbf{v}_p \mathrel{+}= J\mathbf{n},\quad \mathbf{v}_o \mathrel{-}= J\mathbf{n}.$$

This soft repulsion stands in for water pressure. It spreads accumulations and keeps
water moving towards the sink.

#### Sediment exchange

A parcel's transport capacity grows with its speed above a threshold $v_c$:

$$C_p = V_p\,K\,\max\bigl(0,\ \lVert\mathbf{v}_p\rVert - v_c\bigr),$$

where $V_p$ is the water volume per parcel and $K$ the capacity coefficient. The
parcel entrains sand and lets part of its load settle **at the same time**:

$$U = C_p\bigl(1 - e^{-\lambda\delta}\bigr),\qquad
S = q_p\bigl(1 - e^{-\lambda\delta}\bigr),\qquad
\lambda = \begin{cases} 2 & \lVert\mathbf{v}_p\rVert < v_c,\\ 0.3 & \text{otherwise,}\end{cases}$$

where $U$ is the entrainment and $S$ the settling. On a sand bed the net exchange
$U - S = (C_p - q_p)(1 - e^{-\lambda\delta})$ relaxes the load towards capacity.
On bare bedrock nothing can be entrained, but the load keeps settling, so a loaded
parcel leaves a trail of sand behind it (for instance along the initially bare
outlet channel). A slowing parcel ($\lVert\mathbf{v}_p\rVert < \lVert\mathbf{v}_p^-\rVert$)
drops at least the fraction of its load it lost in speed: if
$U - S > -q_p(1 - \lVert\mathbf{v}_p\rVert / \lVert\mathbf{v}_p^-\rVert)$, then $U = 0$
and $S = q_p(1 - \lVert\mathbf{v}_p\rVert / \lVert\mathbf{v}_p^-\rVert)$. Since
$S \le q_p$, a parcel never deposits more than it carries. Both terms are shared
among the erodible vertices $j$ of the triangle, entrainment being limited to the
sand $s_j = \eta_j - \beta_j$ already on the bed:

$$\eta_j \leftarrow \eta_j + \frac{w_{p,j}\,S - \min\bigl(s_j A_j,\ w_{p,j}\,U\,e_j\bigr)}{A_j},\qquad
e_j = \sigma\!\bigl(\operatorname{clip}((R - r_j)/W_e,\ 0,\ 1)\bigr),$$

where $A_j$ is the lumped vertex area (one third of each adjacent triangle) and
$e_j$ fades entrainment (not settling) to zero over the outer band of width $W_e$.
Limiting the entrainment, rather than the net exchange, is what lets the trail
form: otherwise entrainment would cancel the settling of the same substep on bare
bedrock. The load is then
updated with the volume that was **actually** removed or added,
$q_p \leftarrow \max\bigl(0,\ q_p + \sum_j A_j(\eta_j^- - \eta_j)\bigr)$, so the
bedrock floor cannot create or destroy sand.

#### Sand avalanches

After every substep, the sand relaxes towards the angle of repose $\theta_r$. For
each mesh edge between two erodible vertices, with $h$ the higher vertex, $l$ the
lower one and $\ell_{hl}$ the edge length:

$$\epsilon = \eta_h - \eta_l - \tan\theta_r\,\ell_{hl},\qquad
m = \min\!\left(s_h A_h,\ \frac{(1 - e^{-20\delta})\,\epsilon}{1/A_h + 1/A_l}\right)\ \text{ if } \epsilon > 0,$$

and the volume $m$ moves from $h$ to $l$. Four sweeps over the 150,005 edges,
alternately forwards and backwards, are made per substep. This is a simple
granular relaxation, not a model of wet sand.

#### Recycling: sink and evaporation

- **Sink.** A parcel crossing the sink is counted and reinjected, at rest and
  **with its load**, three mesh spacings inside the disk edge
  ($r = R_\text{edge}(\theta) - 3\Delta s$) at a uniformly random angle $\theta$.
- **Evaporation ("bursting").** In each substep a parcel bursts with probability
  $1 - e^{-\delta/T_b}$, so each parcel has a mean lifetime $T_b$ between bursts.
  It stops, turns white and fades over $T_\text{fade}$, then deposits its load on
  the vertices of its triangle (weights $\propto w_{p,j}$, surround and channel
  included) and is reinjected without sediment.

Exchange, avalanches and both recycling paths conserve
$\sum_i A_i s_i + \sum_p q_p$ exactly (to rounding). Remote merges do not (see
[Collaboration as an averaging scheme](#collaboration-as-an-averaging-scheme)).

#### Diagnostic fields

After each step, the parcels are projected onto the vertices for display and
biology:

$$h_i = \frac{V_p}{A_i}\sum_p w_{p,i},\qquad c_i = \frac{1}{A_i}\sum_p q_p\,w_{p,i},\qquad
\mathbf{u}_i = \sum_p w_{p,i}\,\mathbf{v}_p,\qquad \Phi_i = h_i\,\lVert\mathbf{u}_i\rVert,$$

where $h_i$ is the water depth, $c_i$ the suspended sediment, $\mathbf{u}_i$ the
weighted velocity and $\Phi_i$ the water flux.

#### Biology: vegetation and microbial colonies

Biology lives on a regular $256 \times 256$ grid of spacing $\Delta = 2R/255$,
finer than the mesh. It is restricted to cells inside the disk whose triangle is
fully erodible. Each cell interpolates the bed and has a sand mask
$m_i = [\eta > \beta]$. Every frame, a flow memory $F$ follows the interpolated
flux with time constant $\tau_F$:

$$F \leftarrow F + \bigl(1 - e^{-\Delta t/\tau_F}\bigr)(\Phi - F).$$

Once at least $0.16$ sim s has accumulated, colonies advance through
$\lceil 5\,\Delta t_b\rceil$ explicit Euler steps covering $5\,\Delta t_b$ units of
biological time, where $\Delta t_b$ is the accumulated simulation time. Biology
therefore runs five times faster than the water. Two
neighbourhood fields come from repeated decaying max-dilations
$\mathcal{D}_\gamma[X]_i = \max(X_i,\ \gamma X_j : j \in \mathcal{N}_4(i))$:
nearby flow $N = \mathcal{D}^4_{0.72}[F]$ and nearby plants
$N_P = \mathcal{D}^{12}_{0.84}[P]$, the latter spreading through sand only. Then

$$H = m\,(1 - F/0.04)_+\,(1 - P/0.6)_+\,\operatorname{clip}\!\left(\frac{N_P - 0.035}{0.12},\ 0,\ 1\right),\qquad
B = m\,\operatorname{clip}\!\left(\frac{N - 0.0008}{0.008},\ 0,\ 1\right)\operatorname{clip}\!\left(\frac{0.8 - F/N}{0.6},\ 0,\ 1\right),$$

where $H$ is the microbial habitat (calm, sandy, near but not under plants) and
$B$ the plant-growth "bank" term (wet surroundings but not the strongest path).
The four fields evolve as

$$\begin{aligned}
\dot P &= D_P\,\mathcal{L}P + B\,(0.06 + 0.8P)(1 - P) - \bigl(0.9\,I + 0.2\,(1 - m)\bigr)P,\\
\dot I &= D_I\,\mathcal{L}I + 0.1\,P - 0.05\,I,\\
\dot U &= D_U\,\mathcal{L}_H U - [H > 0]\,U V^2 + F_{GS}(1 - U),\\
\dot V &= D_V\,\mathcal{L}_H V + [H > 0]\,U V^2 - \bigl(F_{GS} + k_{GS} + 0.15\,(1 - H)\bigr)V + 0.06\,\Sigma\,H\,(1 - V/0.15)_+,
\end{aligned}$$

where $P$ is the vegetation density, $I$ its inhibitor (crowded centres fade while
colony edges keep growing), $U$ and $V$ the Gray–Scott substrate and microbe
concentrations, and $\Sigma$ a fixed map of Gaussian seed patches. The diffuse
source $0.06\,\Sigma H$ lets colonies regrow after extinction. The discrete
Laplacian $\mathcal{L}X_i = \tfrac14\sum_{j}(X_j - X_i)$ runs over the four
neighbours, with both cells sandy. $\mathcal{L}_H$ weights each term by
$\min(H_i, H_j)$, so microbes diffuse only through suitable habitat. All fields are
clipped to $[0, 1]$.

### Variables

Values are the defaults in the code. The terrain parameters are duplicated in
`worker/mesh.mjs`, which must stay identical to `js/terrain.js` (see
[Changing the mesh](#changing-the-mesh-or-the-initial-terrain)).

**Terrain:** `TerrainGrid` in `js/terrain.js`; `MESH_*` in `worker/mesh.mjs`.

| Symbol | Name in code | Default | Role |
| --- | --- | --- | --- |
| $R$ | `radius` | 25 u | Radius of the erodible disk |
| $L$ | `halfSize` | 30 u | Half-side of the square domain |
| $\Delta s$ | `spacing` (`MESH_SPACING`) | 0.2 u | Spacing of the border points; about one interior point per $\Delta s^2$ |
| $d_\text{min}$ | `MIN_DISTANCE` (`params.minDistance`) | 0.16 u | Minimum distance between interior points |
| $e$ | `EDGE_MARGIN` (`params.edgeMargin`) | 0.15 u | Margin kept free inside the disk edge |
| $k$ | `CANDIDATES` (`params.candidates`) | 30 | Candidates tried around an active point |
| — | `SEED` (`params.seed`) | 2026 | Seed of the point sample |
| $N$ | `erodibleCount` (`MESH_POINTS.params.erodibleCount`) | 47,323 | Erodible points inside the disk, first in the vertex order |
| $N_b$ | `MESH_POINTS.count` − `borderStart` | 1,200 | Border points, last in the vertex order |
| $S$ | `slope` (`MESH_SLOPE`) | 0.11 | Radial slope of the funnel cone |
| $S_c$ | `channelSlope` (`MESH_CHANNEL_SLOPE`) | 0.09 | Descent of the outlet channel axis |
| $S_\text{out}$ | `surroundSlope` | 0.3 | Slope of the surround beyond $R$ |
| $S_p$ | `peripheralSlope` | 0.06 | Extra slope over the outer band |
| $W_p$ | `peripheralWidth` | 4 u | Width of the outer drainage band |
| $r_s$ | `sinkRadius` | 0.8 u | Sink and channel half-width at $z = 0$ |
| $f$ | `channelFlare` | 0.12 | Channel widening per unit of $z$ |
| $D_0$ | `initialSandDepth` | 0.3 u | Initial sand thickness |
| $\beta_i$ | `bedrock` | from $c$ and $\beta$ above | Non-erodible floor |
| $\eta_i$ | `elevation` | $\beta_i + D_0\phi_i$ | Bed elevation (the shared field) |
| $\phi_i$ | `sandDepthFactor()` | 0–1 | Initial sand factor; 0 on the channel bed |
| $A_i$ | `vertexArea` | ≈ 0.042 u² (0.016–0.080) | Lumped vertex area |
| — | `binSize` | 1 u | Spatial hash cell for point location |

The constants $d_\text{min}$, $k$, the seed and the side spacing live in
`tools/generate-mesh-points.mjs` and are copied into `MESH_POINTS.params`. The mesh
has 87,276 vertices (47,323 erodible, 38,753 other interior points, 1,200 border),
173,350 triangles and 260,625 edges. Building it takes about 0.6 s in Node.js on an
Apple M3 Ultra; no sampling happens at run time. The test *mesh defects are spread
evenly over the radius* checks that the share of vertices without six neighbours
does not depend on the radius.

**Water and sediment:** `PhysicsEngine` in `js/physics.js`.

| Symbol | Name in code | Default | Role |
| --- | --- | --- | --- |
| $\rho$ | `simulationRate` | 0.5 (sim s per wall-clock s) | Simulation rate at $\tau = 1$ |
| $\Delta t_w^{\max}$ | `maxFrameSeconds` | 0.1 s | Longest wall-clock interval credited to one frame |
| $\Delta t_0$ | `dt` | 0.04 sim s | Nominal step when no wall-clock time is given (tests) |
| $\tau$ | `timeScale` | 1 (0.1–5, ×1.5 per key) | Speed factor |
| $g$ | `g` | 9.81 u sim s⁻² | Gravity along the slope |
| $k$ | `friction` | 1.8 sim s⁻¹ | Linear velocity damping |
| $N_p$ | `particleCount` | 1,500 | Number of water parcels |
| $V_p$ | `waterPerParticle` | 0.02 u³ | Water volume per parcel |
| $K$ | `transportCapacity` | 6 | Capacity per unit volume and speed |
| $v_c$ | literal | 0.1 u sim s⁻¹ | Speed threshold for transport |
| $\lambda$ | literals | 0.3 or 2 sim s⁻¹ | Entrainment and settling rate (moving or slow) |
| $W_e$ | `erosionBorderWidth` | 2 u | Band where erosion fades to zero |
| $a$ | `particleRadius` | 0.105 u | Collision radius (substep criterion) |
| $v_\max$ | `maxSpeed` | 3 u sim s⁻¹ | Speed cap |
| $1/T_b$ | `particleHazardRate` | 1/90 sim s⁻¹ | Burst (evaporation) hazard |
| $T_\text{fade}$ | `burstDuration` | 0.8 sim s | Fade-out duration of a burst |
| $\tan\theta_r$ | `sandReposeSlope` | tan 34° ≈ 0.675 | Angle of repose |
| — | literal | 20 sim s⁻¹ | Avalanche relaxation rate |
| — | `TRANSIT_SAMPLE_LIMIT` | 100 | Trips averaged for the transit time |
| — | `SAND_THROUGHPUT_WINDOW_SECONDS` | 60 sim s | Window for the particle flow |

With the defaults, a frame rendered every 0.1 s (or more slowly) gives
$\Delta t = 0.05$ sim s in $n = 2$ substeps ($a / v_\max = 0.035$ sim s); at 60
frames per second, $\Delta t \approx 0.008$ sim s in one substep. Parcels are
reinjected at $r = 24.4$ u.

**Biology:** `BiologyGrid` in `js/biology.js`.

| Symbol | Name in code | Default | Role |
| --- | --- | --- | --- |
| — | `size` | 256 | Cells per side |
| $\Delta$ | `spacing` | $2R/255$ ≈ 0.196 u | Cell spacing |
| $\tau_F$ | literal | 8 sim s | Flow-memory time constant |
| — | literal | 0.16 sim s | Minimum interval between colony updates |
| — | literal | 5 | Biological time per simulation second |
| $D_P$, $D_I$ | literals | 0.15, 0.02 | Plant and inhibitor diffusion (grid units) |
| $D_U$, $D_V$ | literals | 0.9, 0.45 | Gray–Scott diffusion (grid units) |
| $F_{GS}$ | literal | 0.046 | Gray–Scott feed rate |
| $k_{GS}$ | literal (0.109 − 0.046) | 0.063 | Gray–Scott kill rate |
| $\Sigma$ | `microbeSeeds` | Gaussian patches, amplitude 1 | Inoculum map (3 u lattice) |

**Collaboration:** `worker/index.mjs`, `worker/mesh.mjs` and `js/collaboration.js`.

| Symbol | Name in code | Default | Role |
| --- | --- | --- | --- |
| $B$ | `DAILY_REQUEST_BUDGET` | 80,000 requests day⁻¹ | Target sync-related requests |
| — | `MAX_REQUESTS_PER_SYNC` | 2 | One CORS preflight plus one sync |
| $T_\text{min}$ | literal | 300,000 ms (5 min) | Minimum sync interval |
| — | `ACTIVE_CLIENT_MS` | 86,400,000 ms (24 h) | Activity window of a browser ID |
| — | `ONLINE_SYNC_INTERVALS` | 2 | A browser seen within this many sync intervals ($2T$, about 10 min) counts as online |
| — | `MERGE_HISTORY_LENGTH` | 50 | Recent merges listed by `GET /api/status` |
| $\Delta_\max$ | `MAX_DELTA` | 10 u | Largest accepted change per vertex |
| — | `MAX_COMPRESSED_BYTES` | 300,000 B | Upload limit; raised automatically only for meshes above ~74,000 vertices |
| — | literal | 6 h | Maximum retry backoff |

### Collaboration as an averaging scheme

Let $\eta^{(v)}$ be the shared elevation at version $v$. Browser $c$ downloads it as
its base, simulates locally and submits once per version a float32 delta
$\Delta^{(c)}_i = \eta^{(c)}_i - \eta^{(v)}_i$, gzip-compressed. The first accepted
contribution opens a collection window of length

$$T = \max\!\left(T_\text{min},\ \left\lceil n_\text{active}\cdot 2\cdot\frac{86{,}400{,}000\ \text{ms}}{B}\right\rceil\right),$$

where $n_\text{active}$ is the number of browser IDs seen in the past 24 h. The
first request after the window closes finalises it:

$$\eta^{(v+1)}_i = \max\!\left(\beta_i,\ \eta^{(v)}_i + \frac{1}{N_c}\sum_{c=1}^{N_c}\Delta^{(c)}_i\right),$$

where $N_c$ is the number of accepted contributions. Contributions based on an
older version are discarded, and the browser receives the newer terrain instead.
When a browser receives a new version, it **replaces** its local bed with the
shared one. Local erosion since its last accepted submission is lost, and the
sediment held by its parcels is no longer balanced by the bed. Averaging reduces
the weight of any single browser but does not make anonymous input trustworthy.

[↑ Contents](#contents)

---

## Using the simulation

The page opens looking straight down at the disk.

### Controls

| Input | Action | Who |
| --- | --- | --- |
| Drag | Orbit the camera around the centre | Everyone |
| Scroll | Zoom (camera distance 10–100 u) | Everyone |
| **D** or **View** | Cycle the display mode | Everyone |
| **F** or a click on the bottom bar (outside its buttons) | Toggle full screen; **Esc** leaves it | Everyone |
| **↑** / **↓** | Multiply or divide $\tau$ by 1.5 (0.1–5) | Signed-in, `?admin` |
| **S** | Sync now, if the adaptive interval has elapsed | Signed-in, `?admin` |
| **R**, twice within 3 s | Reset the shared terrain | Owner only |
| **?** | Toggle the control panel | Signed-in, `?admin` |
| **📷 Start timelapse** | Save one PNG of the default view per second on this computer ([Timelapse](#timelapse)) | `?admin`, page served by `tools/timelapse_server.py` |

Touch gestures and double-click are not handled. For debugging, `window.app`
exposes the running `Application`, for example `app.physics.timeScale = 3` in the
console.

### Display modes

| Mode | What is shown |
| --- | --- |
| `habitat` (default) | Dark bed with the biology overlay: yellow-green vegetation and ochre-to-purple microbes |
| `mesh` | Wireframe of the triangular mesh with the parcels, without biology |
| `sand depth` | Sand thickness in a reversed cmocean *deep* map: dark for bare rock, mid-palette for the initial layer $D_0$, lightest at $2D_0$ or more (`SAND_DEPTH_DISPLAY_MAX`); dimmed lighting |
| `flux` | Water flux $\Phi_i$, square-root scaled by its current maximum |
| `sediment` | Suspended sediment $c_i$, square-root scaled by its current maximum |

The fixed surround is black in every mode except `mesh`. Water parcels are drawn
as flattened blue spheres. A bursting parcel turns white and fades.

### Status bar

The status bar is refreshed once per second. Its **❔** button opens the same
explanations; that text lives in `index.html` and must be kept in step with this
section.

**How sharing works, in pictures.** Picture a large map of sand that everyone draws
on together. Your screen does not draw on the map itself: it works on a sheet of
tracing paper laid over it, where its own water carves its own channels. Every few
minutes, like a postman on a round, your screen posts what its water changed to a
shared table and brings back the latest map. The table collects the tracings for a
few minutes, then blends them as a jury averages its marks: where one screen dug and
another piled sand, the map takes the average. Everyone then copies the new map and
carries on. Only the shape of the sand is shared; the water, the plants and the
microbes stay on each screen. (Technically, the table is the Cloudflare Worker and a
blend is a merge; see [Collaboration protocol](#collaboration-protocol).)

**Sharing**

| Icon | Name | What it tells you |
| --- | --- | --- |
| 👥 | Visitors | For example `37 (3)`: 37 screens have taken part since counting began on 2026-11-17, like names in a guest book; 3 of them are here now (heard from in the last ten minutes or so) |
| 🔄 | Last post | Seconds since your screen last exchanged with the shared table |
| ⌛ | Next post | Seconds until the postman's next round; `--` while a post is on its way. After a failed round (no network, for example) the postman waits twice as long before trying again, up to six hours |
| 🔀 | Next blend | Seconds until the table blends the tracings it has collected; in brackets, how many screens are waiting. `--`: nothing is waiting. `0`: the blend is due, happens as soon as any screen gets in touch, and you see it at your next post |
| 🤝 | Last blend | For example `v31 · 3 ✓ · 12 min`: the last blend produced edition 31 of the shared map, mixing the work of 3 screens, 12 minutes ago; ✓ means yours was one of them. Like a newspaper, the map gets a new edition number after each blend (and after a reset). Two screens or more means the sand was shaped together. `--` before the first blend or after a reset |

**Your own simulation.** The simulation runs on its own clock, like a time-lapse
film: `sim s` are simulated seconds, not seconds on your watch.

| Icon | Name | What it tells you |
| --- | --- | --- |
| 🕰️ | Simulated time | How long the water has flowed on this computer, all its tabs together; kept on this computer only, not shared, not erased by a terrain reset |
| ⏱️ | Journey time | How long a drop of water (a blue dot) takes, on average, to travel from the edge of the disk to the drain, over its last 100 journeys |
| 💧 | Flow | How many drops reach the drain each simulated second, like cars counted at a toll booth, over the last 60 sim s. Drops that evaporate on the way (they turn white and leave their sand where they are) are not counted |

**The whole story.** The [sharing status page](https://laurentperrinet.github.io/2026-11_tree-of-life/status.html)
(`status.html`, also linked from **❔**) shows the edition of the shared map, how
many blends there have been and how many mixed two screens or more, the next blend,
the visitors, a bar chart of the screens mixed in each of the last 50 blends, and the
same list as a table. It asks the shared table for news once a minute while it is
visible.

**Buttons.** **View** (or **D**) changes what the map shows; 🔒 shows the GitHub
account you are signed in with; **GitHub** opens the source code. To spare the shared
table, rounds never come more often than every five minutes, and they space out when
many people visit. A tab left in the background may be a little late.

### Administration

Open `?admin` to show the control panel, then sign in with GitHub. Any GitHub
account unlocks the simulation controls for its own browser. Only the owner can
reset the shared terrain: the browser checks the login `laurentperrinet`, and the
Worker independently checks the numeric GitHub ID `OWNER_GITHUB_ID`. A reset
reinitialises the shared terrain, starts a new version, and resets the owner's
local particles and biology. The URL parameters `?reset=1` and
`?reset=1&hard=1` trigger the same reset once the owner is signed in. Other
browsers adopt the reset terrain at their next sync, but keep their own biology.

#### Timelapse

The panel's **📷 Start timelapse** button saves one PNG of the default view per
wall-clock second, numbered `000001.png`, `000002.png`, … (the 342nd frame is
`000342.png`). It needs `?admin` but no sign-in, since it touches no shared state.

```bash
python3 tools/timelapse_server.py        # or: npm run timelapse
# then open http://localhost:8765/?admin in Safari (or any browser)
```

**⏹ Stop timelapse** then makes the video: the server runs, in the background,

```bash
ffmpeg -framerate 30 -i timelapse/%06d.png -pix_fmt yuv420p timelapse.mp4
```

and the panel shows the video's path, frame count and duration when it is ready
(one recorded second per video frame, so a day lasts 48 min at 30 frames/s).

- **Why a local server.** Frames stay on the recording computer: at about 1–3 MB
  per frame, a day of recording (86,400 frames) would exceed the Worker's and
  GitHub's limits. Safari blocks requests from the HTTPS page to
  `http://localhost` as mixed content, so `tools/timelapse_server.py` (standard
  library only, listening on 127.0.0.1) serves the page itself from this
  repository, receives each frame from that same origin, and relays `/api/*` to
  the Worker server to server, so the shared terrain keeps being synchronised.
  The relayed requests carry no `Origin`, which the Worker accepts, and the
  browser's `User-Agent`, since Cloudflare rejects urllib's (error 1010). On
  GitHub Pages the button is disabled and shows the command above. Pages served
  from `localhost` or `127.0.0.1` always sync through `/api/sync` on their own
  origin.
- **Where the frames go.** `timelapse/` in the repository (ignored by git), or
  `--out <folder>`. The server numbers the frames: a restart, or a second tab,
  continues after the highest number found instead of overwriting. Each frame is
  written to a temporary file then renamed, so a crash never leaves a truncated
  PNG under a frame name. Options: `--port` (8765), `--out`, `--worker`, `--fps`
  (30).
- **The video.** `<folder>.mp4` next to the frame folder (`timelapse.mp4` in the
  repository, ignored by git), replaced at each stop and covering all frames so
  far. ffmpeg runs with `-y` (overwrite without asking), `-nostdin`,
  `-start_number` set to the first frame (ffmpeg alone only looks for 0–4) and
  writes a temporary file renamed at the end. It stops at the first missing
  number, so deleting a frame in the middle shortens the video. A stop during an
  encoding queues one more encoding. Without ffmpeg (`brew install ffmpeg`) the
  frames are kept and the panel reports the error. Closing the page does not
  encode.
- **What is captured.** The default view whatever the visitor does: the start-up
  zenith camera and the `habitat` mode, rendered off screen at 1920 × 1080 px
  (`TimelapseRecorder` options `width`, `height`), without the status bar or
  panels.
- **Metadata.** Each PNG carries three `tEXt` chunks: `Creation Time` (ISO 8601,
  UTC, e.g. `2026-11-17T18:42:03.123Z`), `Commit` (`git rev-parse HEAD` of the
  served files, with `-dirty` if tracked files are modified; `unknown` outside a
  git checkout) and `Software`. Read them with `exiftool 000342.png` or, in
  Python, `PIL.Image.open('000342.png').text`.
- **Limits.** Frames are taken by the animation loop, so a hidden tab or a
  minimised window records nothing; keep the window visible. While a frame is
  being sent, the next waits rather than queueing. A server error (disk full,
  server stopped) stops the recording with a message. The page served locally
  has its own browser storage, hence its own collaborator ID, and GitHub sign-in
  does not work there (the OAuth callback is the Pages URL).

[↑ Contents](#contents)

---

## Collaboration protocol

The Worker (`worker/index.mjs`) routes every terrain request to a single
SQLite-backed Durable Object named `global`. Its `blockConcurrencyWhile` call
serialises updates.

| Method and path | Purpose |
| --- | --- |
| `GET /api/state` | Current shared elevation and metadata (does not count as activity) |
| `GET /api/status` | The same metadata without the terrain, plus `merges`: `total`, `shared` (merges of two browsers or more), `since` (ISO 8601, when counting began) and `recent` (the last `MERGE_HISTORY_LENGTH` merges, newest first, each with `agoMs`, `version`, `contributors`); read by `status.html` |
| `POST /api/sync` | Heartbeat or contribution; returns the metadata, and the terrain if the version changed |
| `POST /api/auth/exchange` | Exchange a GitHub OAuth code for a token (holds the client secret) |
| `POST /api/admin/reset` | Reset the terrain; requires the owner's GitHub bearer token |

A sync request carries `X-Collaborator-ID` (32 hexadecimal characters, random,
kept in `localStorage`). It also carries `X-Terrain-Version` and `X-Mesh-Signature`
once these are known. With a contribution, it adds `X-Payload-Encoding: gzip` and
a body holding one float32 per vertex. An empty body is a heartbeat. The response
holds the version, the mesh signature, the browser counts `activeCollaborators`
(past 24 h, used for the interval), `onlineCollaborators` (past $2T$) and
`totalCollaborators` (distinct IDs ever counted), the number of pending
contributions `acceptedContributions`, the suggested interval `syncIntervalMs`,
and `mergeInMs`: the delay before the collection window closes, `null` when no
contribution is pending. `lastMerge` gives the last merge's age `agoMs`, its
`version`, its number of `contributors` and `includesYou` (whether the requesting
browser was one of them; `null` for `GET /api/state`); it is `null` before the
first merge and after a reset. Contributor IDs are never returned. The total is
stored apart from the terrain, one storage key per ID, so resets and mesh changes
keep it; it started from the IDs active when it was introduced. The Worker rejects:

- a signature from another mesh (409);
- a wrong length, corrupt gzip or oversized body (400 or 413);
- non-finite values or $\lvert\Delta\rvert > \Delta_\max$;
- negative changes on non-erodible vertices (deposits on the surround are allowed).

Only the GitHub Pages origin is allowed by CORS.

The browser follows the interval returned by the Worker, never shorter than
5 minutes. After a failure, including a failed first or manual sync, it retries
with exponential backoff, capped at 6 hours. The 80,000-request target holds only
for a stable, honestly reporting population. OAuth, reset and direct calls are
outside it. It is **not** a hard quota: configure Cloudflare-side rate limiting
before relying on a ceiling.

**Mesh versioning.** Terrain saves and Worker state carry a mesh signature:
`square-poisson-v1`, $L$, $\Delta s$, $d_\text{min}$, the seed, the vertex count, a
checksum of `js/mesh-points.js`, `channel-sand-free-v1`, `slopes-v1`, $S$ and $S_c$.
States and saves from the earlier meshes (`disk-square-polar-v2`,
`disk-square-vogel-v1`, `disk-square-poisson-v1`) are not migrated, because their
vertices do not correspond to the square Poisson points: any mismatch resets the
shared terrain and discards pending contributions. Deploy the Worker and the site together whenever
the mesh changes.

[↑ Contents](#contents)

---

## What is stored where

| Store | Key | Content | Lifetime |
| --- | --- | --- | --- |
| Durable Object | `state` | Shared elevation, bedrock, version, active IDs, pending sum of deltas | Permanent |
| `localStorage` | `tree-of-life-terrain-disk-v12` | Elevation, water, sediment and particles (format `16.0`); saved when a new shared version arrives and after a reset | Ignored after 24 h |
| `localStorage` | `tree-of-life-local-biology-v2` | Plants, inhibitor, $U$, $V$, quantised to 16 bits | Saved every 5 s and on exit |
| `localStorage` | `tree-of-life-collaborator-id` | Random browser ID | Until storage is cleared |
| `localStorage` | `tree-of-life-simulation-time-v1:<uuid>` | Simulation time of one tab | Summed over all tabs |
| `sessionStorage` | `github-oauth-token`, `tree-of-life-oauth-state` | GitHub token and OAuth `state` | Until the tab closes |
| Local folder | `timelapse/000001.png`, … (or `--out`) and `timelapse.mp4` | Admin timelapse frames, one per second, and their video, written by `tools/timelapse_server.py` | On the recording computer, until deleted |

Terrain saves from formats `10.0` to `13.0` were made on the polar-ring meshes
and are ignored. A save that still holds per-vertex vegetation and microbe arrays (the
former biology) is resampled once onto the 256 × 256 grid, if no biology save
exists yet. The terrain save is about 1.5 million characters and the biology save
about 0.7 million, so both together use roughly half the usual 5-million-character
quota of an origin.

[↑ Contents](#contents)

---

## Technical summary

### Data flow

```text
   frame loop (js/main.js)
   ├─ PhysicsEngine.step()        parcels move, exchange sand, avalanches, recycling
   ├─ BiologyGrid.step(dt)        flow memory every frame, colonies every ≥ 0.16 sim s
   ├─ TerrainRenderer.update…()   positions, normals, colours, parcels
   └─ UIManager.updateStatus()    at most once per second

   CollaborativeSync (timer, ≥ 5 min)
   └─ POST /api/sync  ── delta = elevation − base ──► Worker
                       ◄── version, interval, merge delay, terrain if newer ──
```

### Design choices

- **Particles rather than a grid solver.** Parcels on a triangulated bed are
  robust, conserve sand exactly, and show the flow directly. The price is
  realism: there is no water depth equation, and pressure is a soft repulsion.
- **Poisson-disk mesh.** Polar rings, even with a half-sector shift and a jitter,
  kept vertices aligned along the axes and diagonals (6 % of edges within 1° of an
  axis), and the flow followed these rays. A Vogel spiral removed the directions
  but concentrated its lattice defects on concentric circles. Poisson-disk points
  are isotropic and have no such circles. They are precomputed, because sampling
  them takes about 0.4 s; the browser computes only the Delaunay triangulation.
- **Share elevation only.** Elevation is the slow, meaningful variable. Averaging
  it is simple and bounded. Water and biology are fast, local and decorative.
- **Request budget.** The interval grows with the number of active browsers, to
  target 80,000 sync-related requests per day for the whole population.

### History

| Date | Milestone |
| --- | --- |
| 2026-11-16 | First version: 64 × 64 shallow-water grid, terrain committed to `data/terrain.json` through the GitHub API; first Cloudflare Worker |
| 2026-11-17 | Lagrangian particle model and sand avalanches replace the grid solver |
| 2026-11-17 | Funnel bed with flared outlet channel; polar triangular mesh; circular drainage basin and vegetation |
| 2026-11-17 | Microbial colonies; collaboration through the Worker with per-version averaging |
| 2026-11-17 | Evaporating parcels recycle water and deposit their sediment |
| 2026-11-17 | Energy convergence replaced by transit time and particle flow; bottom status bar; public display modes |
| 2026-11-17 | Sand-free outlet channel, jittered mesh, next-merge indicator; legacy grid and GitHub-sync code removed; documentation merged into this README |
| 2026-11-17 | Vogel-spiral mesh with golden-angle rotation and Delaunay triangulation replaces the polar rings; shared terrain and local saves restart |
| 2026-11-18 | Precomputed Poisson-disk points replace the Vogel spiral, whose defects formed concentric rings; shared terrain and local saves restart |
| 2026-11-19 | Poisson-disk points sampled over the whole square in Cartesian coordinates; the disk is only the erodible subset; shared terrain and local saves restart |

[↑ Contents](#contents)

---

## Repository files

| File | Purpose |
| --- | --- |
| `index.html` | Canvas, status bar, status help dialogue, admin panel; loads Three.js r128 from cdnjs, then the scripts below in order |
| `status.html` | Self-contained sharing status page (inline CSS and script, no library): reads `GET /api/status` once a minute |
| `css/style.css` | Full-screen dark layout, status bar, dialogues, toasts, spinner |
| `js/local-storage.js` | `LocalStorageManager`, `SimulationTimeTracker`, `SessionStorageManager` |
| `js/mesh-points.js` | Generated Poisson-disk points (`globalThis.MESH_POINTS`), shared with the Worker; do not edit |
| `js/terrain.js` | `TerrainGrid`: Poisson-disk mesh, Delaunay triangulation, bedrock, sand profile, point location, save format |
| `js/physics.js` | `PhysicsEngine`: parcels, collisions, sediment exchange, avalanches, recycling |
| `js/biology.js` | `BiologyGrid`: flow memory, vegetation, Gray–Scott microbes, compact save |
| `js/renderer.js` | `TerrainRenderer`: Three.js meshes, display modes, instanced parcels |
| `js/collaboration.js` | `CollaborativeSync`: browser ID, gzip deltas, schedule, backoff, reset call |
| `js/auth.js` | `AuthManager` (GitHub OAuth through the Worker), `ResetManager` |
| `js/controls.js` | `InputControls`: keyboard and mouse |
| `js/timelapse.js` | `TimelapseRecorder`: admin timelapse frames, PNG `tEXt` metadata, upload to the local server |
| `js/ui.js` | `UIManager`: status bar, toasts, admin panel, reset confirmation, timelapse button |
| `js/main.js` | `Application`: wiring, start-up order, animation loop, autosave |
| `worker/index.mjs` | Cloudflare Worker (routing, CORS, OAuth, owner check) and the `Simulation` Durable Object |
| `worker/mesh.mjs` | Mesh and sand profile mirrored from `js/terrain.js`; sync interval formula |
| `wrangler.toml` | Worker name, public variables, Durable Object binding `SIMULATION` and migration `v1` |
| `tests/*.test.js` | Browser modules run in `node:vm` with DOM mocks |
| `worker/index.test.mjs` | Worker protocol with a mocked Durable Object |
| `tools/generate-mesh-points.mjs` | Generates `js/mesh-points.js` (Bridson sampling, fixed seed) |
| `tools/timelapse_server.py` | Local server for the timelapse: serves the page, writes numbered frames, encodes the video with ffmpeg on stop, relays `/api/*` to the Worker |
| `tools/test_timelapse_server.py` | Its tests (`unittest`, real server on a free port, fake Worker) |
| `package.json` | Scripts (`test`, `timelapse`, `dev`, `dev:http`, `lint`, `format`) and dev dependencies |
| `.github/workflows/deploy.yml` | Publishes the repository root to GitHub Pages |
| `.nojekyll`, `.gitignore`, `LICENSE` | Pages setting, ignored paths (including `secrets/`), MIT licence |
| `.DEPLOYMENT_STATUS.txt` | Deployment configuration recorded in the repository and checks to run |

The browser scripts are not modules: they define globals and must load in the
order of `index.html`. There is no build step. The first version's
`data/terrain.json`, `js/github-sync.js` and `worker/physics.mjs` were removed on
2026-11-17; the git history keeps them.

[↑ Contents](#contents)

---

## Code map

Where each mechanism lives. Symbols are those of [the model](#the-model). Line
numbers are omitted on purpose because they drift; search for the method name.

### Start-up and frame loop: `js/main.js`

- `Application.constructor()` builds, in order: `TerrainGrid` → `PhysicsEngine` →
  `BiologyGrid` → `TerrainRenderer`. Then the stores, `CollaborativeSync`,
  `AuthManager` (client ID, callback URL and Worker exchange URL are hard-coded
  here), `ResetManager`, `UIManager`, `InputControls` and `TimelapseRecorder`.
- `initialize()` runs the OAuth callback or restores the session, loads the local
  terrain, then the local biology. An unreadable biology save is discarded with a
  warning and the biology restarts; a failed write is logged and does not stop
  start-up. It then runs a first sync (failures only show a toast), builds the
  meshes and starts `animate()`.
- `animate()` makes one `physics.step(deltaTime)` per `requestAnimationFrame`,
  with the wall-clock time since the previous frame, then `biology.step(dt)`. Every 5 s it saves the biology and the simulation time. It
  then updates the renderer and the status bar, renders, and lets the timelapse
  capture a frame if one is due.
- `handleUrlParams()` handles `?reset=1[&hard=1]` one second after start-up, owner only.

### Terrain: `js/terrain.js`

| Task | Method or field |
| --- | --- |
| Read the points, Delaunay triangulation with the border first | `constructor()`, `meshPoints` |
| Delaunay triangulation (Lawson flips, convexity guard) | module function `delaunayTriangles(xs, zs)` |
| Bedrock $\beta$: cone, peripheral band, channel | `bedrockHeight(x, z)` |
| Sand factor $\phi$ | `sandDepthFactor(x, z)`, `sandDepthFactorAt(i)` |
| Initial sand, reset of per-vertex fields | `initialize()` |
| Lumped areas $A_i$, unique edges, spatial bins | `vertexArea`, `edges`, `bins` (built in the constructor) |
| Point location and barycentric weights | `locate(x, z)` |
| Interpolated height and slope $\nabla\eta$ | `sample(x, z)` |
| Mesh signature, save and load | `meshSignature()`, `toJSON()`, `fromJSON(json)` |
| Former per-vertex microbes (read by `importLegacy()`) | `seedMicrobes()` |

`erodibleCount` is the number of points inside the disk; vertices below it are
erodible, and the border is the last `MESH_POINTS.count − borderStart` vertices.

### Water and sediment: `js/physics.js`

| Task | Method |
| --- | --- |
| Step size, substeps, projection to $h_i$, $c_i$, $\mathbf{u}_i$ | `step()` |
| Gravity, friction, speed cap, sediment exchange, walls, sink | `moveParticle(particle, dt)` |
| Burst hazard and fade | `updateParticle(particle, dt)` |
| Deposit of an evaporated load | `depositEvaporatedSediment(particle)` |
| Soft pressure between parcels (spatial hash of size $2a$) | `collideParticles(dt)` |
| Angle-of-repose avalanches (4 sweeps) | `relaxSand(dt)` |
| Erosion fade near the edge $e_j$ | `erosionFactor(index)` |
| Reinjection three spacings inside the disk edge | `reinject(particle)` |
| Initial parcels spread over the disk | `createParticles()` |
| Transit time and particle flow | `recordSinkExit()`, `getMeanTransitTime()`, `getParticleThroughput()`; `getSandThroughput()` is tested but not displayed |
| Reset parcels, statistics and terrain | `reset()` |

### Biology: `js/biology.js`

| Task | Method |
| --- | --- |
| Map grid cells to mesh triangles (`faces`, `weights`, `active`) | `constructor(terrain)` |
| Seed patches $\Sigma$ and initial $U$, $V$ | `reset()` |
| Interpolate a vertex field at a cell | `terrainValue(i, values)` |
| Sand mask $m$ | `updateSand()` |
| Flow memory $F$, colony timer | `step(dt)` |
| Dilations $N$, $N_P$, habitat $H$, bank $B$, Euler steps of $P$, $I$, $U$, $V$ | `updateColonies(dt)` |
| Import the former per-vertex biology | `importLegacy()` |
| 16-bit base64 save | `toJSON()`, `fromJSON(json)` |

### Rendering: `js/renderer.js`

| Task | Method |
| --- | --- |
| Scene, top-down camera, lights | `constructor(canvas)`, `onWindowResize()` (keeps the disk in view on portrait screens) |
| Terrain geometry and colours per display mode | `createTerrainMesh()`, `updateTerrainMesh()`, `updateTerrainColors()` |
| Biology overlay (`habitat`, `Tree of life`, and `streams` modes) | `createBiologyMesh()`, `updateBiologyMesh()`, `volcanicColor()`, `lifeMapColor()`, `streamsColor()` |
| Sand-depth colour map | `deepColor(t)`, `TerrainRenderer.DEEP`, `SAND_DEPTH_DISPLAY_MAX` |
| Instanced parcels with a burst shader patch | `updateParticles(physics)` |
| Mode order | `cycleDisplayMode()` |
| Default view off screen, for the timelapse | `captureDefaultView()`, `placeDefaultCamera()`, `fieldOfView()`, `flipRows()` |

### Collaboration: `js/collaboration.js`

| Task | Method |
| --- | --- |
| Random browser ID in `localStorage` | `getClientId()` |
| One request: delta, headers, response | `performSync()` (wrapped by `sync()`, which de-duplicates calls in flight) |
| gzip with `CompressionStream` | `compress(delta)` |
| Validate the response, adopt a new version, save locally | `applyState(data)` |
| Timer, interval, exponential backoff | `start()`, `schedule()`, `stop()` |
| Manual sync (**S**), never under the interval | `syncNow()` (alias `fetchAndMerge()`) |
| Owner reset | `reset(token)` |
| Status bar values | `getSecondsSinceSync()`, `getSecondsUntilSync()`, `getSecondsUntilMerge()` |

### Authentication and reset: `js/auth.js`

- `AuthManager`: `login()` stores a random `state` and redirects to GitHub.
  `initialize()` checks `state` on return, then `exchangeCode()` posts the code
  to the Worker. `fetchUser()` verifies the token with `api.github.com/user`.
  `canReset()` compares the login with `laurentperrinet`. `isConfigured()`
  requires HTTPS and an exact callback URL match.
- `ResetManager`: `softReset()` calls the Worker reset, then resets the physics
  and biology and saves both. `hardReset()` is the same operation behind a
  confirmation flag.

### Interface and persistence: `js/ui.js`, `js/controls.js`, `js/local-storage.js`

- `UIManager.updateStatus()` updates the seven indicators at most once per second.
  `updateAdminPanel()` shows the panel with `?admin`, and the controls once signed
  in. `confirmReset()` needs a second **R** within 3 s.
- `InputControls.onKeyDown()`: **D** and **F** (full screen, also a click on the bottom bar via `UIManager.setupEventListeners()`) for everyone; the other keys need sign-in
  and `?admin`. Mouse drag orbits, the wheel zooms, the camera looks at the origin.
- `LocalStorageManager(key, maxAgeHours)`: JSON wrapper with a format version and
  an age limit (terrain 24 h, biology none). `SimulationTimeTracker`: one key per
  tab, `getTotal()` sums them. `SessionStorageManager`: the GitHub token.

### Worker: `worker/index.mjs`, `worker/mesh.mjs`

| Task | Function |
| --- | --- |
| Routing, CORS (GitHub Pages origin only) | default export `fetch(request, env)` |
| OAuth code exchange (uses `GITHUB_CLIENT_SECRET`) | `exchangeCode()` |
| Owner check by numeric GitHub ID | `authenticateOwner()` |
| Size-limited body and gzip decoding | `readStreamLimited()`, `readDelta()` |
| Load, migrate or recreate the state | `Simulation.loadState()` |
| Heartbeat, activity, validation, accumulation | `Simulation.sync()` |
| Mean of the deltas, new version, last-merge record | `Simulation.finalizeContributions()` |
| Response body, including `mergeInMs`, counts and `lastMerge` | `Simulation.stateResponse()` |
| Cumulative count of distinct browser IDs | `Simulation.loadCollaboratorTotal()`, `Simulation.registerCollaborator()` |
| Merge statistics (stored apart from the terrain, kept across resets) and `GET /api/status` | `Simulation.loadMergeHistory()`, `Simulation.recordMerge()`, `Simulation.handle()` |
| Mesh, bedrock and sand mirrored from the browser | `createInitialMesh()`, `meshJitter()`, `hashUint32()`, `channelSandFactor()` |
| Sync interval | `getSyncIntervalMs()` |

[↑ Contents](#contents)

---

## Development

### Set-up

Node.js 20 or later is needed only for the tests and local servers. `npm install`
is optional (dev tools: eslint, prettier, serve, http-server). Serve the folder
over HTTP, since `file://` breaks relative assets and browser APIs:

| Command | URL |
| --- | --- |
| `npx http-server -p 8000 -c-1` | <http://localhost:8000> (no cache) |
| `npm run dev:http` | <http://localhost:8080> (opens the browser, no cache) |
| `npm run dev` | <http://localhost:3000> (`serve`) |
| `python3 -m http.server 8000` | <http://localhost:8000> |

A local page simulates stand-alone: the Worker accepts only the GitHub Pages
origin and the OAuth callback is the production URL, so sync and sign-in fail with
a warning toast.

### Tests

```bash
npm test                                   # everything, about five minutes
node --test tests/collaboration.test.js    # one file
node --test --test-name-pattern="avalanche" tests/terrain-physics.test.js
python3 -m unittest discover -s tools      # timelapse server only; opens local ports
```

| File | Covers |
| --- | --- |
| `tests/terrain-physics.test.js` | Mesh geometry, minimum distance and evenly spread defects, bedrock and channel, sand conservation, avalanches, recycling, save migrations, biology, colours (slow) |
| `tests/collaboration.test.js` | Deltas once per version, mesh mismatch, intervals, countdowns, reset during sync |
| `tests/auth.test.js` | OAuth `state`, callback, admin view, reset failure handling |
| `tests/ui.test.js` | Camera, display modes, status bar, simulation time, URL resets |
| `tests/timelapse.test.js` | PNG `tEXt` chunks and CRC, 1 s cadence, server check, frame upload and errors, stop then video, off-screen default view |
| `tools/test_timelapse_server.py` | Frame numbering and atomic writes, ffmpeg command and a real encoding (skipped without ffmpeg), static files only (no `secrets/`, `.git/`), Host check, Worker relay (Python, `unittest`) |
| `worker/index.test.mjs` | Browser and Worker build the same mesh, migrations, averaging, validation, owner reset, CORS |

Browser scripts are evaluated in `node:vm` contexts with minimal DOM, storage and
`fetch` mocks. The timelapse server tests start real servers on 127.0.0.1 with a
fake Worker. No test runs Cloudflare or GitHub for real.

### Conventions

- Plain ES2020 browser scripts, no bundler, no runtime dependency.
- International English with British spelling in comments and docs (colour,
  centre, behaviour); existing identifiers keep their spelling, such as
  `initialize()`.
- Docstrings with `Args:` and `Returns:`, units in brackets; comments explain why,
  not what.
- `Float64Array` for the bed (conservation is checked to 1e-9 in the tests),
  `Float32Array` for biology.
- Any new exchange of sand must move the same volume out of one store and into
  another.
- When a parameter or an equation changes, update [Equations](#equations) and
  [Variables](#variables) in the same commit.
- `npm run lint` and `npm run format` exist, but no ESLint or Prettier
  configuration is committed yet.

### Changing the mesh or the initial terrain

The browser (`js/terrain.js`) and the Worker (`worker/mesh.mjs`) build the same
mesh independently and must agree bit for bit; the test *browser and Worker
initialize the same higher-resolution terrain* checks it.

1. Change the constant in **both** files (`this.radius` ↔ `MESH_RADIUS`, etc.).
2. Change the **mesh signature** in both files (`meshSignature()` and
   `MESH_SIGNATURE`). Add a tag (such as `'slopes-v1'`) when the geometry or
   profile changes without a dimension change. The point set needs no tag: its
   parameters and checksum are part of the signature.
3. Decide whether existing terrains are **migrated** or **reset**:
   - Browser: `TerrainGrid.fromJSON()` accepts only format `16.0` with the
     current signature. Bump `toJSON().version` and add a conversion if old saves
     must survive.
   - Worker: `Simulation.loadState()` resets on any signature or schema mismatch.
     Bump `STATE_SCHEMA_VERSION` and add a migration if sand must survive.
4. To change the interior points (radius, $d_\text{min}$, $e$, $k$, seed), edit the
   constants of `tools/generate-mesh-points.mjs` and run
   `node tools/generate-mesh-points.mjs`; it rewrites `js/mesh-points.js`
   atomically, and two runs give identical files. Never edit the generated file.
5. Deploy the Worker and the site together (see [Deployment](#deployment)).

### Save formats

| Data | Writer | Format | Compatibility |
| --- | --- | --- | --- |
| Local terrain | `TerrainGrid.toJSON()` | `version: '16.0'`, `topology`, `meshSignature`, arrays, particles | Reads `16.0` only; 500 or 1,000 saved parcels are topped up to 1,500 |
| Local biology | `BiologyGrid.toJSON()` | `version: 1`, `size: 256`, base64 of four 16-bit fields | Exact match only |
| Store wrapper | `LocalStorageManager.save()` | `{ version: '1.0', savedAt, data }` | Version must match; terrain expires after 24 h |
| Shared state | `createState()` in the Worker | `schemaVersion: 4`, `meshSignature`, float64 arrays, contributions | Resets any other schema or signature |

`fromJSON()` rejects, with a console warning, any save whose elevation lies below
the bedrock, erodes the surround, adds sand to the channel, or holds non-finite
values or invalid particles.

**Randomness.** Parcel creation, reinjection angles and burst times use
`Math.random()` without a seed, so two runs never match. The mesh points (seed
2026) and the microbe seed patches are deterministic. Tests therefore check invariants
and statistics, not exact trajectories.

[↑ Contents](#contents)

---

## Deployment

| Part | Hosted on | Deployed by | URL |
| --- | --- | --- | --- |
| Static site (`index.html`, `css/`, `js/`) | GitHub Pages | `.github/workflows/deploy.yml`, on every push to `main` | <https://laurentperrinet.github.io/2026-11_tree-of-life/> |
| Collaboration API (`worker/`) | Cloudflare Workers + Durable Objects | `npx wrangler deploy`, by hand | <https://tree-of-life.laurent-perrinet.workers.dev> |

### GitHub Pages

The workflow uploads the repository root as the Pages artefact and deploys it; it
also runs on pull requests. In the repository settings, **Pages → Source** must be
**GitHub Actions**. `.nojekyll` stops Jekyll from processing the files.

### GitHub OAuth application

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. **Homepage URL** and **Authorization callback URL** are both
   `https://laurentperrinet.github.io/2026-11_tree-of-life/`. The browser
   (`AuthManager.isConfigured()`) and the Worker (`FRONTEND_URL`) require this
   exact URL.
3. Copy the **Client ID** into **both** `js/main.js` (`clientId`) and
   `wrangler.toml` (`GITHUB_CLIENT_ID`); the current value is `Ov23liPHpc4sc5qUGMVx`.
4. Generate a **client secret**. It goes only into Cloudflare (next section),
   never into the repository, the browser code or a chat. The `secrets/` folder is
   ignored by git for local copies.

The browser requests the `user:email` scope with `allow_signup=false`. The token
lives in `sessionStorage` and is dropped when the tab closes.

### Cloudflare Worker

1. `wrangler.toml` declares the Worker `tree-of-life` (entry `worker/index.mjs`),
   the public variables `GITHUB_CLIENT_ID` and `OWNER_GITHUB_ID` (`381808`, the
   numeric ID of the owner's account, from `https://api.github.com/users/<login>`),
   and the Durable Object binding `SIMULATION` → class `Simulation`, created by the
   migration `v1` as a SQLite-backed class.
2. Log in once: `npx wrangler login`.
3. Set the secret: `npx wrangler secret put GITHUB_CLIENT_SECRET`.
4. Deploy: `npx wrangler deploy`.
5. Check: `curl -s https://tree-of-life.laurent-perrinet.workers.dev/api/state | head -c 300`
   returns `{"version":…,"meshSignature":…,"activeCollaborators":…`.

The Worker URL is hard-coded in `js/collaboration.js` (`endpoint`) and `js/main.js`
(`exchangeUrl`); the allowed origin is `ORIGIN` in `worker/index.mjs`. Change all
three together if the site moves.

### Deploying a change

| Change | Deploy |
| --- | --- |
| Interface, rendering, physics or biology only | Push to `main` (Pages only) |
| Worker logic that keeps the mesh | `npx wrangler deploy` |
| Mesh, bedrock or initial sand (signature changes) | `npx wrangler deploy`, then push to `main` straight away; until both are live, open tabs get HTTP 409 and must reload |

Run `npm test` before any deployment. The tests use mocks, so afterwards also check
`/api/state`, load the site, and watch the 🔄 indicator after the first sync.

### Request budget and abuse

The suggested interval targets 80,000 sync-related requests per day for a
well-behaved population. It is **not** enforced against direct calls; OAuth
exchanges, resets and reads of `/api/state` are outside it. If a strict ceiling
matters, add Cloudflare rate limiting or WAF rules in front of the Worker.
Averaging bounds the effect of one browser per version, but a script with many IDs
can still bias the terrain.

[↑ Contents](#contents)

---

## Performance

`Application.animate()` takes **one** physics step per animation frame, whose length
follows wall-clock time (see [Water parcels](#water-parcels)). On the reference
machine below, a frame costs about 24 ms per physics substep, whatever its length,
plus colony updates in proportion to simulated time (97 ms per 0.16 sim s, i.e.
about 0.3 × the frame interval at $\rho = 0.5$), plus rendering. With
$\rho = 0.5$, frames up to 70 ms long need one substep ($\le 0.035$ sim s), so the
loop should settle at about one substep and 10–15 frames per second there. This is
an estimate from the Node.js timings, not a browser measurement. A device that
cannot keep up reaches the cap $\Delta t_w^{\max}$: each frame then simulates
0.05 sim s (2 substeps, like the former fixed step of 0.04 sim s), and the
simulation falls behind real time. Raising the speed with **↑** adds substeps, so
it makes each frame more expensive.

Measured on 2026-11-17 under Node.js 26 (V8), one core of an Apple M3 Ultra,
jittered mesh, nominal step of 0.04 sim s, averages over 40 calls:

| Operation | Time | Per frame |
| --- | --- | --- |
| `PhysicsEngine.step()` (2 substeps) | 48 ms | 48 ms |
| of which `relaxSand()` (4 sweeps × 150,005 edges) | 18 ms per substep | ≈ 36 ms |
| of which `collideParticles()` | 1.3 ms per substep | ≈ 3 ms |
| `BiologyGrid.step()`, averaged | 26 ms | 26 ms |
| of which `updateColonies(0.16)` | 97 ms, every 4th frame | ≈ 24 ms |
| `new TerrainGrid()` | 270 ms | once |
| `new BiologyGrid()` | 90 ms | once |

At this step, physics and biology take about **75 ms per frame**. Rendering adds the upload and
`computeVertexNormals()` of the 87,276-vertex terrain, of the 65,536-vertex biology
overlay in `habitat`, `Tree of life`, and `streams` modes, and 1,500 `sample()` calls to place the parcels.

Where the time goes:

1. **Sand relaxation**: four full sweeps over all edges in every substep, even
   where no slope exceeds the angle of repose.
2. **Colony update**: about 18 passes over 65,536 cells every 0.16 sim s.
3. **Geometry upload**: normals and colours of every vertex, every frame.
4. **Point location**: `locate()` builds a string key and scans a bin of triangles,
   several times per parcel per substep.

| Option | Expected gain | Caveat |
| --- | --- | --- |
| Run `relaxSand()` once per frame, or only near recent changes | Up to ~30 ms per frame | Steeper transient slopes; check the avalanche tests |
| Cache each parcel's triangle and walk to neighbours | Several ms | More state per parcel |
| Integer bin keys instead of template strings | A few ms | — |
| Update normals and colours every second or third frame | Several ms of rendering | Slightly delayed visuals |
| Move physics and biology to a Web Worker | Frees the main thread | Transferable buffers needed |
| WebGL/WebGPU compute for biology | Large | Major rewrite |

To reproduce, load `js/terrain.js`, `js/physics.js` and `js/biology.js` into a
`node:vm` context as the tests do, and time the calls with `performance.now()`. A
sync uploads at most 201,056 bytes before gzip; a response that includes the
terrain carries about 0.9 MB of JSON, and heartbeats at the current version omit it.

[↑ Contents](#contents)

---

## Troubleshooting

Open the browser console first (F12, or ⌥⌘I on a Mac): every failure below also
logs a message there.

| Symptom | Cause and fix |
| --- | --- |
| "Simulation ready; local vegetation could not be restored and restarts" | The biology save was unreadable (format change, corrupt value); it was discarded. Nothing to do |
| "✗ Initialization failed" | Another start-up step threw; read the console error |
| "Error initializing application" on a red panel | The constructor failed, usually because Three.js did not load from cdnjs (offline, blocked by an extension) |
| Terrain or particles not restored | The save is older than 24 h, has another mesh signature, or failed validation (console warning). The next sync replaces the bed with the shared terrain anyway |
| "Could not save local biology" or "…simulation time" | `localStorage` is full or disabled (private browsing). Clear the site data and reload |
| "Collaboration unavailable: …" on a local server | Expected: the Worker allows only the GitHub Pages origin |
| "Incompatible terrain mesh; reload the application" (409) | Page and Worker use different mesh signatures; deploy both, then reload |
| "This browser does not support compressed collaboration updates" | `CompressionStream` is missing: the first, empty sync works, later syncs fail. Use a current browser |
| ⌛ Next post hours away | Earlier rounds failed, so the postman waits twice as long each time (up to 6 h); or very many visitors; a background tab may also be late |
| 🔀 Next blend stays at `0` | The blend is due; it happens as soon as any screen gets in touch, and you see it at your next post |
| **S** says "Sync is already rate-limited" | A manual sync never bypasses the Worker's interval |
| "GitHub sign-in unavailable" | The page must be exactly the production URL over HTTPS; sign-in cannot work from `localhost` or `file://` |
| "GitHub sign-in failed: invalid OAuth state" | The callback opened in another tab, or session storage was cleared; sign in again from the same tab |
| "GitHub token exchange failed (503)" | The Worker lacks `GITHUB_CLIENT_ID` or the secret `GITHUB_CLIENT_SECRET` |
| "✗ Reset failed" | 401: expired token, sign in again; 403: not `OWNER_GITHUB_ID`; 503: `OWNER_GITHUB_ID` not configured. Local state is left unchanged |
| Low frame rate | See [Performance](#performance); `mesh`, `sand depth`, `flux` and `sediment` modes skip the biology overlay |
| Simulation time (🕰️) grows more slowly than 0.5 s per second | The device renders fewer than 10 frames per second and hits the per-frame cap, or the tab was in the background |
| `npm run lint`: "No ESLint configuration found" | No configuration is committed yet; add `eslint.config.js` first |
| VS Code starts a Python interpreter | JavaScript-only project: disable the Python extensions for this workspace (`.vscode/` is not tracked) |

[↑ Contents](#contents)

---

## Contributing

**By running the simulation.** Your browser downloads the shared bed, simulates it,
and every 5 minutes or more sends its change in elevation, once per shared version.
The Worker averages the changes of all browsers that contributed to the same
version: when $N$ browsers contribute, yours moves the terrain by $1/N$ of your
own erosion. Your contribution is anonymous (a random browser ID), and water,
sediment in transit, vegetation and microbes never leave your browser.

**By improving the code.**

1. Fork the repository and create a branch.
2. Read [Development](#development), especially
   [Changing the mesh](#changing-the-mesh-or-the-initial-terrain) if you touch
   `js/terrain.js` or `worker/mesh.mjs`.
3. Keep [Equations](#equations) and [Variables](#variables) in step with the code.
4. Run `npm test` and check the page locally.
5. Open a pull request that explains **why**, with a screenshot or short clip for
   visual changes.

**Reporting a problem.** Open a GitHub issue with the browser and device, the
display mode, the console messages, what you expected and what you saw; for sync
problems, add the values of 👥, 🔄, ⌛, 🔀 and 🤝.

[↑ Contents](#contents)

---

## Status, limitations and open work

Status on 2026-11-17.

**Done**

- [x] Cartesian Poisson-disk Delaunay mesh over the square, precomputed points;
  browser and Worker build identical meshes
- [x] Inverted-cone bedrock, peripheral drainage band, flared outlet channel bare at start
- [x] Lagrangian parcels with gravity, friction, soft pressure and wall reflection
- [x] Speed-dependent transport capacity, angle-of-repose avalanches, recycling
- [x] Exact conservation of sand plus load (tested over a closed cycle and reload)
- [x] Vegetation with inhibitor and Gray–Scott microbes on a local 256 × 256 grid
- [x] Cloudflare Worker with per-version averaging of compressed deltas,
  validation, migrations, an adaptive request budget and a merge countdown
- [x] GitHub OAuth through the Worker; owner-only reset checked server-side
- [x] An unreadable local biology save no longer blocks start-up
- [x] Simulated time follows wall-clock time ($\rho = 0.5$), with a per-frame cap
- [x] The misleading "flow rate" control, which only scaled the step, removed
- [x] Legacy GitHub persistence, grid solver and unused methods removed

**Known limitations**

- The model is exploratory and uncalibrated; branching is not guaranteed.
- Adopting a new shared version replaces the local bed: local erosion since the
  last accepted submission is lost, and the local sand balance breaks.
- Contributions are anonymous; the request budget is a client-side target, not a
  quota.
- Particle randomness is unseeded, so runs are not reproducible.
- A device rendering fewer than 10 frames per second falls behind the nominal
  simulation rate; the cost of sand relaxation dominates.
- There is no pause: the speed factor goes down to 0.1, not 0.
- No touch controls; sync and sign-in cannot be tested from `localhost`.

**Open work**

- [ ] Measure the frame rate and simulation rate in browsers, then tune $\rho$
- [ ] Seed the particle generator, for reproducible runs and parameter scans
- [ ] Make sand relaxation cheaper; move the simulation to a Web Worker
- [ ] Touch gestures (orbit, pinch zoom)
- [ ] Quantitative branching measures: channel count, drainage density, bifurcation ratios
- [ ] Rebase local changes on a new shared version instead of replacing them
- [ ] Cloudflare-side rate limiting; end-to-end test against `wrangler dev`
- [ ] ESLint and Prettier configuration

[↑ Contents](#contents)

---

## Licence

MIT. See [LICENSE](LICENSE). © 2026 Laurent Perrinet. Contributions are accepted
under the same licence.
