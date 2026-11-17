# Tree of Life: start here

A five-minute orientation. The full description of the model is in
[README.md](README.md).

## What you are looking at

A circular bed of sand, 50 units across, sits inside a black square. Its
bedrock is a shallow inverted cone: water runs towards the centre, then down an
outlet channel to a sink in the middle of the bottom edge. Blue dots are 1,500 water
parcels. They pick up sand where they move fast and drop it where they slow down,
so channels deepen where water concentrates. Sand slides when slopes exceed
34°. Vegetation (yellow-green) grows along wet banks, and microbial colonies
(ochre to purple) form Turing-like patterns in calm sandy areas.

Every visitor runs this simulation in their own browser. Only the **bed
elevation** is shared: every few minutes, each browser sends its changes to a
Cloudflare Worker, which averages them and sends back the common terrain.

## For visitors

1. Open <https://laurentperrinet.github.io/2026-11_tree-of-life/>.
2. Drag to orbit, scroll to zoom.
3. Press **D** or click **View** to cycle through `elevation`, `mesh`,
   `sand depth`, `flux` and `sediment`.
4. Click **❔** in the status bar for the meaning of each indicator.

Keeping the tab open is how you contribute: your local erosion is part of the
next averaged terrain. Your vegetation and microbes stay in your browser.

## For the owner

1. Open <https://laurentperrinet.github.io/2026-11_tree-of-life/?admin>.
2. Click **Sign in with GitHub**.
3. Use **+**/**-** (step size, "flow rate"), **↑**/**↓** (speed) and **S** (sync
   now) for your own browser.
4. Press **R** twice, or click **Reset Terrain**, to reset the shared terrain.
   The Worker accepts the reset only from the GitHub account whose numeric ID is
   `OWNER_GITHUB_ID`.

## For developers

```bash
git clone https://github.com/laurentperrinet/2026-11_tree-of-life.git
cd 2026-11_tree-of-life
npx http-server -p 8000 -c-1     # then open http://localhost:8000
npm test                         # about five minutes, mostly the physics suite
```

There is no build step and no runtime npm dependency: the page loads Three.js
r128 from cdnjs and plain scripts from `js/`. Locally, the simulation runs
stand-alone. Sync and sign-in work only from the GitHub Pages origin.

Where to go next:

| If you want to… | Read |
| --- | --- |
| Understand the equations and parameters | [README.md](README.md), section 1 |
| Find the code for a mechanism | [CODE_MAP.md](CODE_MAP.md) |
| Change the mesh, a save format or a parameter safely | [README_DEV.md](README_DEV.md) |
| Deploy the site or the Worker | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Fix something that does not work | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Know what limits the frame rate | [PERFORMANCE.md](PERFORMANCE.md) |
| See what is done and what is open | [PROJECT_CHECKLIST.md](PROJECT_CHECKLIST.md) |
