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

---

## 1. The model

Lengths are in dimensionless simulation units (u) and times in simulation
seconds (sim s). Gravity is set to $g = 9.81$, so one unit can be read as one
metre, but nothing is calibrated against field data. Horizontal positions are
$(x, z)$ and elevation is vertical, following the Three.js convention ($y$ up).
The sink lies at $z = +L$, which appears at the bottom of the screen.

### 1.1 Equations

#### Terrain

The bed is a polar triangular mesh. The disk of radius $R$ is filled with $N_r$
concentric rings, each with about $2\pi r/\Delta s$ vertices, alternately rotated
by half a sector so that triangles are close to equilateral (a sunflower-like,
approximately hexagonal packing). Every interior vertex is then displaced by a
deterministic offset drawn uniformly in a disk of radius $j\,\Delta s$. This
jitter breaks the alignments of the rings along the cardinal axes, and hence along
the channel axis, which would otherwise favour some flow directions. The offset
comes from an integer hash of the vertex index and the seed, so the browser and the
Worker build bit-identical meshes. The triangulation depends only on ring angles
and is unchanged by the jitter. The outer ring is not jittered: it is a polygon
whose vertices lie on the circle, and it is projected radially onto a square of
half-side $L$ to form a fixed surround. Each vertex $i$ carries an elevation

$$\eta_i = \beta_i + s_i, \qquad s_i \ge 0,$$

where $\beta_i$ is the fixed, non-erodible bedrock and $s_i$ the sand thickness.
At distance $r = \sqrt{x^2 + z^2}$ from the centre, the bedrock is an inverted
cone

$$c(r) = S\,\min(r, R) + S_\text{out}\,\max(0, r - R) + S_p\,\operatorname{clip}(r - R + W_p,\ 0,\ W_p),$$

where $S$ is the cone slope, $S_\text{out}$ the slope of the surround and $S_p$ an
extra slope over the outermost band of width $W_p$, which drains peripheral water
inwards. Towards the sink ($z > 0$), an outlet channel of half-width
$w(z) = r_s + f z$ descends from the centre:

$$\beta(x, z) = \begin{cases} c(r) & z \le 0,\\ -S z\,\bigl(1 - \sigma(t)\bigr) + c(r)\,\sigma(t) & z > 0, \end{cases}
\qquad t = \operatorname{clip}\!\left(\frac{\lvert x\rvert}{w(z)},\ 0,\ 1\right),$$

with the smoothstep $\sigma(t) = t^2(3 - 2t)$, $r_s$ the sink half-width and $f$ the
channel flare. The bedrock thus rises from $0$ at the centre to $2.49$ u at the
disk edge and falls to $-2.70$ u at the sink. The initial sand layer is uniform
except in the channel:

$$\eta_i(0) = \beta_i + D_0\,\phi_i,\qquad
\phi(x, z) = \begin{cases} 1 & z \le 0 \text{ or } \lvert x\rvert \ge 1.25\,w(z),\\
0 & z > 0 \text{ and } \lvert x\rvert \le w(z),\\
\sigma\!\bigl((\lvert x\rvert / w(z) - 1)/0.25\bigr) & \text{otherwise,}\end{cases}$$

where $D_0$ is the initial sand depth and $\phi_i \in [0, 1]$ the sand factor. The
channel bed ($\phi = 0$) is bare bedrock: it never receives sand. Only the
48,696 vertices strictly inside the polygon edge are erodible. The edge ring and
the square surround can receive sediment from evaporating parcels, but they can
never be eroded.

#### Water parcels

Each parcel $p$ has a position $\mathbf{x}_p$, a velocity $\mathbf{v}_p$ and a
sediment load $q_p$ (a volume). The elevation is linearly interpolated over the
triangle containing the parcel with barycentric weights $w_{p,j}$, so the slope
$\nabla\eta$ is constant on each triangle. One physics step is taken per
animation frame, with a step

$$\Delta t = \Delta t_0\,\tau\,\frac{Q}{0.5},$$

where $\Delta t_0$ is the base step, $\tau$ the speed factor and $Q$ the
"flow rate" control. $Q$ does not inject water: it multiplies the step like
$\tau$, and $Q = 0$ pauses the simulation. Each step is split into
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
parcel relaxes its load towards capacity:

$$E = (C_p - q_p)\bigl(1 - e^{-\lambda\delta}\bigr),\qquad
\lambda = \begin{cases} 2 & \lVert\mathbf{v}_p\rVert < v_c,\\ 0.3 & \text{otherwise.}\end{cases}$$

A slowing parcel ($\lVert\mathbf{v}_p\rVert < \lVert\mathbf{v}_p^-\rVert$) deposits at
least the fraction of its load it lost in speed,
$E \leftarrow \min\bigl(E,\ -q_p(1 - \lVert\mathbf{v}_p\rVert / \lVert\mathbf{v}_p^-\rVert)\bigr)$,
and never deposits more than it carries ($E \ge -q_p$). The exchange is shared
among the erodible vertices $j$ of the triangle:

$$\eta_j \leftarrow \max\!\left(\beta_j,\ \eta_j - \frac{E\,w_{p,j}\,\phi_j\,e_j}{A_j}\right),\qquad
e_j = \begin{cases} \sigma\!\bigl(\operatorname{clip}((R - r_j)/W_e,\ 0,\ 1)\bigr) & E > 0,\\ 1 & E \le 0,\end{cases}$$

where $A_j$ is the lumped vertex area (one third of each adjacent triangle) and
$e_j$ fades erosion to zero over the outer band of width $W_e$. The load is then
updated with the volume that was **actually** removed or added,
$q_p \leftarrow \max\bigl(0,\ q_p + \sum_j A_j(\eta_j^- - \eta_j)\bigr)$, so the
bedrock floor cannot create or destroy sand.

#### Sand avalanches

After every substep, the sand relaxes towards the angle of repose $\theta_r$. For
each mesh edge between two erodible vertices, with $h$ the higher vertex, $l$ the
lower one ($\phi_l > 0$) and $\ell_{hl}$ the edge length:

$$\epsilon = \eta_h - \eta_l - \tan\theta_r\,\ell_{hl},\qquad
m = \min\!\left(s_h A_h,\ \frac{(1 - e^{-20\delta})\,\epsilon}{1/A_h + 1/A_l}\right)\ \text{ if } \epsilon > 0,$$

and the volume $m$ moves from $h$ to $l$. Four sweeps over the 150,005 edges,
alternately forwards and backwards, are made per substep. This is a simple
granular relaxation, not a model of wet sand.

#### Recycling: sink and evaporation

- **Sink.** A parcel crossing the sink is counted and reinjected, at rest and
  **with its load**, three ring spacings inside the disk edge
  ($r = R_\text{edge}(\theta) - 3R/N_r$) at a uniformly random angle $\theta$.
- **Evaporation ("bursting").** In each substep a parcel bursts with probability
  $1 - e^{-\delta/T_b}$, so each parcel has a mean lifetime $T_b$ between bursts.
  It stops, turns white and fades over $T_\text{fade}$, then deposits its load on
  the vertices of its triangle (weights $\propto w_{p,j}\phi_j$, surround
  included) and is reinjected without sediment. A parcel that bursts inside the
  sand-free channel keeps its load.

Exchange, avalanches and both recycling paths conserve
$\sum_i A_i s_i + \sum_p q_p$ exactly (to rounding). Remote merges do not
(section 1.3).

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

### 1.2 Variables

Values are the defaults in the code. The terrain parameters are duplicated in
`worker/mesh.mjs`, which must stay identical to `js/terrain.js`.

**Terrain:** `TerrainGrid` in `js/terrain.js`; `MESH_*` in `worker/mesh.mjs`.

| Symbol | Name in code | Default | Role |
| --- | --- | --- | --- |
| $R$ | `radius` | 25 u | Radius of the erodible disk |
| $L$ | `halfSize` | 30 u | Half-side of the square surround |
| $N_r$ | `rings` | 125 | Number of concentric rings |
| $\Delta s$ | `spacing` | 0.2 u | Target vertex spacing along a ring |
| $j$ | `jitter` (`MESH_JITTER`) | 0.1 | Jitter radius as a fraction of $\Delta s$ (0.02 u) |
| — | `jitterSeed` (`MESH_JITTER_SEED`) | 2026 | Seed of the deterministic jitter field |
| $S$ | `slope` | 0.09 | Cone slope and channel descent |
| $S_\text{out}$ | `surroundSlope` | 0.3 | Slope of the surround beyond $R$ |
| $S_p$ | `peripheralSlope` | 0.06 | Extra slope over the outer band |
| $W_p$ | `peripheralWidth` | 4 u | Width of the outer drainage band |
| $r_s$ | `sinkRadius` | 0.8 u | Sink and channel half-width at $z = 0$ |
| $f$ | `channelFlare` | 0.12 | Channel widening per unit of $z$ |
| $D_0$ | `initialSandDepth` | 0.3 u | Initial sand thickness |
| $\beta_i$ | `bedrock` | from $c$ and $\beta$ above | Non-erodible floor |
| $\eta_i$ | `elevation` | $\beta_i + D_0\phi_i$ | Bed elevation (the shared field) |
| $\phi_i$ | `sandDepthFactor()` | 0–1 | Sand factor; 0 on the channel bed |
| $A_i$ | `vertexArea` | ≈ 0.040 u² (0.030–0.051) | Lumped vertex area |
| — | `binSize` | 1 u | Spatial hash cell for point location |

The mesh has 50,264 vertices (48,696 erodible), 99,742 triangles and 150,005
edges, with 784 vertices on the edge ring.

**Water and sediment:** `PhysicsEngine` in `js/physics.js`.

| Symbol | Name in code | Default | Role |
| --- | --- | --- | --- |
| $\Delta t_0$ | `dt` | 0.04 sim s | Base step per animation frame |
| $\tau$ | `timeScale` | 1 (0.1–5, ×1.5 per key) | Speed factor |
| $Q$ | `Q_inlet` | 0.5 (0–2, ±0.1 per key) | "Flow rate"; scales the step, 0 pauses |
| $g$ | `g` | 9.81 u sim s⁻² | Gravity along the slope |
| $k$ | `friction` | 1.8 sim s⁻¹ | Linear velocity damping |
| $N_p$ | `particleCount` | 1,500 | Number of water parcels |
| $V_p$ | `waterPerParticle` | 0.02 u³ | Water volume per parcel |
| $K$ | `transportCapacity` | 6 | Capacity per unit volume and speed |
| $v_c$ | literal | 0.1 u sim s⁻¹ | Speed threshold for transport |
| $\lambda$ | literals | 0.3 or 2 sim s⁻¹ | Load relaxation rate (moving or slow) |
| $W_e$ | `erosionBorderWidth` | 2 u | Band where erosion fades to zero |
| $a$ | `particleRadius` | 0.105 u | Collision radius (substep criterion) |
| $v_\max$ | `maxSpeed` | 3 u sim s⁻¹ | Speed cap |
| $1/T_b$ | `particleHazardRate` | 1/90 sim s⁻¹ | Burst (evaporation) hazard |
| $T_\text{fade}$ | `burstDuration` | 0.8 sim s | Fade-out duration of a burst |
| $\tan\theta_r$ | `sandReposeSlope` | tan 34° ≈ 0.675 | Angle of repose |
| — | literal | 20 sim s⁻¹ | Avalanche relaxation rate |
| — | `TRANSIT_SAMPLE_LIMIT` | 100 | Trips averaged for the transit time |
| — | `SAND_THROUGHPUT_WINDOW_SECONDS` | 60 sim s | Window for the particle flow |

With the defaults, $\Delta t = 0.04$ sim s per frame in $n = 2$ substeps, and
parcels are reinjected at $r = 24.4$ u.

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
| $\Delta_\max$ | `MAX_DELTA` | 10 u | Largest accepted change per vertex |
| — | `MAX_COMPRESSED_BYTES` | 300,000 B | Upload limit; raised automatically only for meshes above ~74,000 vertices |
| — | literal | 6 h | Maximum retry backoff |

### 1.3 Collaboration as an averaging scheme

Let $\eta^{(v)}$ be the shared elevation at version $v$. Browser $c$ downloads it as
its base, simulates locally and submits once per version a float32 delta
$\Delta^{(c)}_i = \eta^{(c)}_i - \eta^{(v)}_i$, gzip-compressed. The first accepted
contribution opens a collection window of length

$$T = \max\!\left(T_\text{min},\ \left\lceil n_\text{active}\cdot 2\cdot\frac{86{,}400{,}000\ \text{ms}}{B}\right\rceil\right),$$

where $n_\text{active}$ is the number of browser IDs seen in the past 24 h. The
first sync after the window closes finalises it:

$$\eta^{(v+1)}_i = \max\!\left(\beta_i,\ \eta^{(v)}_i + \frac{1}{N_c}\sum_{c=1}^{N_c}\Delta^{(c)}_i\right),$$

where $N_c$ is the number of accepted contributions. Contributions based on an
older version are discarded, and the browser receives the newer terrain instead.
When a browser receives a new version, it **replaces** its local bed with the
shared one. Local erosion since its last accepted submission is lost, and the
sediment held by its parcels is no longer balanced by the bed. Averaging reduces
the weight of any single browser but does not make anonymous input trustworthy.

---

## 2. Using the simulation

The page opens looking straight down at the disk.

| Input | Action | Who |
| --- | --- | --- |
| Drag | Orbit the camera around the centre | Everyone |
| Scroll | Zoom (camera distance 10–100 u) | Everyone |
| **D** or **View** | Cycle the display mode | Everyone |
| **+** / **-** | Change $Q$ by ±0.1 (0–2) | Signed-in, `?admin` |
| **↑** / **↓** | Multiply or divide $\tau$ by 1.5 (0.1–5) | Signed-in, `?admin` |
| **S** | Sync now, if the adaptive interval has elapsed | Signed-in, `?admin` |
| **R**, twice within 3 s | Reset the shared terrain | Owner only |
| **?** | Toggle the control panel | Signed-in, `?admin` |

Touch gestures and double-click are not handled.

### Display modes

| Mode | What is shown |
| --- | --- |
| `elevation` (default) | Dark bed with the biology overlay: yellow-green vegetation and ochre-to-purple microbes |
| `mesh` | Wireframe of the triangular mesh with the parcels, without biology |
| `sand depth` | Sand thickness in a reversed cmocean *deep* map: dark for bare rock, mid-palette for the initial layer $D_0$, lightest at $2D_0$ or more (`SAND_DEPTH_DISPLAY_MAX`); dimmed lighting |
| `flux` | Water flux $\Phi_i$, square-root scaled by its current maximum |
| `sediment` | Suspended sediment $c_i$, square-root scaled by its current maximum |

The fixed surround is black in every mode except `mesh`. Water parcels are drawn
as flattened blue spheres. A bursting parcel turns white and fades.

### Status bar

The status bar is refreshed at most once per second. Its **❔** button opens the
same explanations.

| Icon | Indicator | Meaning |
| --- | --- | --- |
| 👥 | Collaborators | Browser IDs seen by the Worker in the past 24 h |
| 🔄 | Last sync | Wall-clock seconds since the last successful sync |
| ⌛ | Next sync | Wall-clock seconds to the next attempt, including retry backoff; `--` while syncing |
| 🕰️ | Simulation time | Cumulative sim s in this browser, summed over its tabs and saved every 5 s; not shared, not reset with the terrain |
| ⏱️ | Transit time | Mean rim-to-sink time over the last 100 trips (bursts excluded) |
| 💧 | Particle flow | Parcels reaching the sink per sim s, over the last 60 sim s |

### Administration

Open `?admin` (for example
<https://laurentperrinet.github.io/2026-11_tree-of-life/?admin>) to show the control
panel, then sign in with GitHub. Any GitHub account unlocks the simulation controls
for its own browser. Only the owner can reset the shared terrain: the browser
checks the login `laurentperrinet`, and the Worker independently checks the
numeric GitHub ID `OWNER_GITHUB_ID`. A reset reinitialises the shared terrain,
starts a new version, and resets the owner's local particles and biology. The URL
parameters `?reset=1` and `?reset=1&hard=1` trigger the same reset once the owner
is signed in. Other browsers adopt the reset terrain at their next sync, but keep
their own biology.

---

## 3. Collaboration protocol

The Worker (`worker/index.mjs`) routes every terrain request to a single
SQLite-backed Durable Object named `global`. Its `blockConcurrencyWhile` call
serialises updates.

| Method and path | Purpose |
| --- | --- |
| `GET /api/state` | Current shared elevation and metadata (does not count as activity) |
| `POST /api/sync` | Heartbeat or contribution; returns the metadata, and the terrain if the version changed |
| `POST /api/auth/exchange` | Exchange a GitHub OAuth code for a token (holds the client secret) |
| `POST /api/admin/reset` | Reset the terrain; requires the owner's GitHub bearer token |

A sync request carries `X-Collaborator-ID` (32 hexadecimal characters, random,
kept in `localStorage`). It also carries `X-Terrain-Version` and `X-Mesh-Signature`
once these are known. With a contribution, it adds `X-Payload-Encoding: gzip` and
a body holding one float32 per vertex. An empty body is a heartbeat. The Worker
rejects:

- a signature from another mesh (409);
- a wrong length, corrupt gzip or oversized body (400 or 413);
- non-finite values or $\lvert\Delta\rvert > \Delta_\max$;
- negative changes on non-erodible vertices (deposits on the surround are allowed).

Only the GitHub Pages origin is allowed by CORS.

The browser follows the interval returned by the Worker, never shorter than
5 minutes. After a failure it retries with exponential backoff, capped at 6 hours.
The 80,000-request target holds only for a stable, honestly reporting population.
OAuth, reset and direct calls are outside it. It is **not** a hard quota:
configure Cloudflare-side rate limiting before relying on a ceiling.

**Mesh versioning.** Terrain saves and Worker state carry a mesh signature:
`disk-square-polar-v2`, $R$, $L$, $N_r$, $\Delta s$, `channel-sand-free-v1`,
`jitter-v1`, $j$ and the seed. Worker states of schemas 2 and 3 were built on the
regular mesh, before the jitter, and they are migrated in place. Each vertex keeps its
sand depth at its jittered position, the steeper peripheral profile is applied and
sand is removed from the channel. Any other mismatch, such as a change of mesh
dimensions, resets the shared terrain and discards pending contributions. Deploy
the Worker and the site together whenever the mesh changes.

---

## 4. What is stored where

| Store | Key | Content | Lifetime |
| --- | --- | --- | --- |
| Durable Object | `state` | Shared elevation, bedrock, version, active IDs, pending sum of deltas | Permanent |
| `localStorage` | `tree-of-life-terrain-disk-v12` | Elevation, water, sediment and particles (format `13.0`); saved when a new shared version arrives and after a reset | Ignored after 24 h |
| `localStorage` | `tree-of-life-local-biology-v2` | Plants, inhibitor, $U$, $V$, quantised to 16 bits | Saved every 5 s and on exit |
| `localStorage` | `tree-of-life-collaborator-id` | Random browser ID | Until storage is cleared |
| `localStorage` | `tree-of-life-simulation-time-v1:<uuid>` | Simulation time of one tab | Summed over all tabs |
| `sessionStorage` | `github-oauth-token`, `tree-of-life-oauth-state` | GitHub token and OAuth `state` | Until the tab closes |

Terrain saves from formats `10.0` to `12.0` were made on the regular mesh. They
are migrated on load: the bedrock of their time is subtracted at the regular
positions, and their sand is laid back on the current, jittered bedrock, without
the channel. A save that still holds per-vertex vegetation and microbe
arrays (the former biology) is resampled once onto the 256 × 256 grid, if no
biology save exists yet.

---

## 5. Code layout

```text
index.html               Page, status bar, help dialogue; loads Three.js r128 from cdnjs
css/style.css            Dark full-screen layout, status bar, dialogues, toasts
js/terrain.js            TerrainGrid: polar mesh, bedrock, sand profile, point location, save format
js/physics.js            PhysicsEngine: parcels, collisions, sediment exchange, avalanches, recycling
js/biology.js            BiologyGrid: flow memory, vegetation, Gray–Scott microbes, compact save
js/renderer.js           TerrainRenderer: Three.js meshes, display modes, instanced parcels
js/collaboration.js      CollaborativeSync: browser ID, gzip deltas, schedule, backoff, reset call
js/auth.js               AuthManager (GitHub OAuth through the Worker), ResetManager
js/local-storage.js      LocalStorageManager, SimulationTimeTracker, SessionStorageManager
js/controls.js           InputControls: keyboard and mouse
js/ui.js                 UIManager: status bar, toasts, admin panel, reset confirmation
js/main.js               Application: wiring, start-up order, animation loop, autosave
worker/index.mjs         Cloudflare Worker and the Simulation Durable Object
worker/mesh.mjs          Mesh and sand profile mirrored from js/terrain.js; sync interval formula
tests/*.test.js          Browser modules run in node:vm with DOM mocks
worker/index.test.mjs    Worker protocol with a mocked Durable Object
wrangler.toml            Worker name, public variables, Durable Object binding and migration
.github/workflows/       GitHub Pages deployment of the repository root
```

The browser modules are classic scripts that share globals, in the order of
`index.html`. There is no build step. See [CODE_MAP.md](CODE_MAP.md) for a
function-level map.

---

## 6. Running and testing

```bash
npx http-server -p 8000 -c-1      # or: python3 -m http.server 8000
# open http://localhost:8000
npm test                          # node --test tests/*.test.js worker/*.test.mjs
```

A local page runs the simulation stand-alone. CORS admits only the GitHub Pages
origin and the OAuth callback is the production URL, so synchronisation and sign-in
fail locally. The tests cover mesh geometry, sediment conservation, avalanches,
recycling, save migrations, biology, the camera and UI, OAuth, the collaboration
client and the Worker protocol. They use mocks, not the Cloudflare runtime. The
physics suite takes about five minutes.

---

## 7. Documentation

| File | Purpose |
| --- | --- |
| [START_HERE.md](START_HERE.md) | Five-minute orientation for visitors, the owner and developers |
| [SUMMARY.md](SUMMARY.md) | One-page technical summary and design history |
| [CODE_MAP.md](CODE_MAP.md) | Where each mechanism lives, function by function |
| [FILES_MANIFEST.md](FILES_MANIFEST.md) | Every file in the repository and what uses it |
| [README_DEV.md](README_DEV.md) | Development set-up, conventions, save formats and mesh changes |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Troubleshooting |
| [DEPLOYMENT.md](DEPLOYMENT.md) | GitHub Pages, Cloudflare Worker and OAuth configuration |
| [PERFORMANCE.md](PERFORMANCE.md) | Measured costs and optimisation options |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How visitors and developers contribute |
| [PROJECT_CHECKLIST.md](PROJECT_CHECKLIST.md) | What is done, known limitations and open work |
| `.DEPLOYMENT_STATUS.txt` | Deployment configuration recorded in the repository and checks to run |

---

## Licence

MIT. See [LICENSE](LICENSE). © 2026 Laurent Perrinet.
