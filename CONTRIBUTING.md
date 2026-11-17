# Contributing

There are two ways to contribute: by running the simulation, and by improving
the code.

## 1. Running the simulation

Opening <https://laurentperrinet.github.io/2026-11_tree-of-life/> is enough.

1. Your browser downloads the shared bed and simulates it locally.
2. Every few minutes (5 minutes or more), it sends the change in elevation since
   that download, once per shared version.
3. The Worker **averages** the changes of all browsers that contributed to the
   same version, adds the mean to the shared bed, and publishes a new version.
4. Your browser adopts the new version, and the cycle starts again.

Your contribution is anonymous: the Worker sees only a random browser ID. Because
changes are averaged, one browser moves the terrain by $1/N$ of its own erosion
when $N$ browsers contribute. Water, sediment in transit, vegetation and microbes
remain in your browser and are never sent. See [README.md](README.md), section 1.3,
for the exact rule.

## 2. Improving the code

### Workflow

1. Fork the repository and create a branch.
2. Read [README_DEV.md](README_DEV.md), especially *Changing the mesh or the
   initial terrain* if you touch `js/terrain.js` or `worker/mesh.mjs`.
3. Make the change. Keep the README equations and variable tables in step with
   the code.
4. Run `npm test` (about five minutes) and check the page locally.
5. Open a pull request that explains **why**, with a screenshot or short clip
   for visual changes.

### Style

- Plain browser scripts, no bundler, no runtime dependencies.
- International English with British spelling in comments and docs.
- Docstrings with `Args:` and `Returns:`, units in brackets. Comments explain
  why, not what.
- Keep physics conservative: any new exchange of sand must move the same volume
  out of one store and into another. The tests check this.
- Seeded or hashed randomness for anything that the browser and the Worker must
  reproduce.

### Ideas

The most useful work is listed under *Open work* in
[PROJECT_CHECKLIST.md](PROJECT_CHECKLIST.md). For example: speeding up sand
relaxation, seeding the particle generator, touch controls, and quantitative
measures of branching.

### Reporting a problem

Open a GitHub issue with:

- the browser and device;
- the display mode;
- the console messages (F12);
- what you expected and what you saw.

For sync problems, add the values of 👥, 🔄 and ⌛ in the status bar.

## Licence

Contributions are accepted under the [MIT licence](LICENSE).
