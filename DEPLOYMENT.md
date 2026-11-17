# Deployment

## GitHub Pages

The site is published from the `main` branch by
`.github/workflows/deploy.yml`. Push the frontend and documentation changes to
GitHub, then check the repository's **Actions** tab for the Pages deployment.
The public site is:

`https://laurentperrinet.github.io/2026-11_tree-of-life/`

## Cloudflare Worker

The collaboration API runs separately from GitHub Pages. Configure the
`SIMULATION` SQLite-backed Durable Object binding in `wrangler.toml`, then set
these Cloudflare Worker variables/secrets:

- `GITHUB_CLIENT_ID` (variable)
- `OWNER_GITHUB_ID=381808` (variable)
- `GITHUB_CLIENT_SECRET` (encrypted secret; never commit it)

From the project directory, deploy the Worker with:

```bash
npx wrangler deploy
```

The Worker URL configured by the frontend is
`https://tree-of-life.laurent-perrinet.workers.dev`.
Check `GET /api/state` after deployment. The GitHub OAuth callback must remain
`https://laurentperrinet.github.io/2026-11_tree-of-life/`.

## Collaboration protocol

Browsers run the existing triangular-mesh simulation locally and send
compressed elevation deltas to `POST /api/sync`. The Worker averages at most
one contribution per browser ID and terrain version, then returns the common
elevation field. Water, sediment, particles, vegetation and microorganisms are
not shared.

The browser stores a random collaborator ID in localStorage. The Worker
considers an ID active for 24 hours since its last sync and returns a suggested
interval:

```text
max(5 minutes, active browser IDs × 2 × 86,400,000 ms / 80,000)
```

The factor of two budgets for a possible CORS preflight plus the sync request.
This targets 80,000 sync-related Worker requests per day for the observed
browser population. It is not a hard cap on an open Worker URL: direct callers,
administrator actions and OAuth exchanges are outside the browser schedule.
Configure Cloudflare-side limits and abuse protection if a strict service
quota is required.

## Owner reset

Only the configured GitHub owner can reset shared terrain. Use the site admin
view, sign in with GitHub, then confirm **Reset Terrain**. The Worker verifies
the bearer token against GitHub's `/user` endpoint before changing the shared
state.

## Local checks

Serve the static site over HTTP (not `file://`) so browser APIs and relative
assets work:

```bash
npx http-server -p 8000 -c-1
```

Run tests:

```bash
npm test
```

`npm test` exercises the Worker protocol and OAuth flow locally. It does not
deploy the Worker or verify the production Cloudflare configuration.
