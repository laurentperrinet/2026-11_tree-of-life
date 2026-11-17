# Deployment

The application has two independently deployed parts:

| Part | Hosted on | Deployed by | URL |
| --- | --- | --- | --- |
| Static site (`index.html`, `css/`, `js/`) | GitHub Pages | `.github/workflows/deploy.yml`, on every push to `main` | <https://laurentperrinet.github.io/2026-11_tree-of-life/> |
| Collaboration API (`worker/`) | Cloudflare Workers + Durable Objects | `npx wrangler deploy`, by hand | <https://tree-of-life.laurent-perrinet.workers.dev> |

## 1. GitHub Pages

The workflow uploads the repository root as the Pages artefact and deploys it.
It also runs on pull requests. In the repository settings, **Pages → Source**
must be **GitHub Actions**. `.nojekyll` stops Jekyll from processing the files.
After a push, follow the run in the **Actions** tab. The site is usually updated
within a minute or two.

## 2. GitHub OAuth application

Sign-in is needed only for the admin controls and the owner reset.

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. **Homepage URL** and **Authorization callback URL** are both
   `https://laurentperrinet.github.io/2026-11_tree-of-life/`. The browser
   (`AuthManager.isConfigured()`) and the Worker (`FRONTEND_URL`) both require
   this exact URL.
3. Copy the **Client ID** into **both** `js/main.js` (`clientId`) and
   `wrangler.toml` (`GITHUB_CLIENT_ID`). The current value is
   `Ov23liPHpc4sc5qUGMVx`.
4. Generate a **client secret**. It goes only into Cloudflare (step 3.3). Never
   put it in the repository, the browser code or a chat. The `secrets/` folder is
   ignored by git for local copies.

The browser requests the `user:email` scope with `allow_signup=false`. The token
lives in `sessionStorage` and is dropped when the tab closes.

## 3. Cloudflare Worker

1. `wrangler.toml` declares:
   - the Worker `tree-of-life` with entry point `worker/index.mjs`;
   - the public variables `GITHUB_CLIENT_ID` and `OWNER_GITHUB_ID` (`381808`, the
     numeric ID of the owner's GitHub account, from
     `https://api.github.com/users/<login>`);
   - the Durable Object binding `SIMULATION` → class `Simulation`, created by the
     migration `v1` as a SQLite-backed class.
2. Log in once: `npx wrangler login`.
3. Set the secret: `npx wrangler secret put GITHUB_CLIENT_SECRET`.
4. Deploy: `npx wrangler deploy`.
5. Check:

   ```bash
   curl -s https://tree-of-life.laurent-perrinet.workers.dev/api/state | head -c 300
   ```

   The response starts with `{"version":…,"meshSignature":…,"activeCollaborators":…`.
   A first request after a mesh change creates or migrates the stored state.

The Worker URL is hard-coded in `js/collaboration.js` (`endpoint`) and
`js/main.js` (`exchangeUrl`). The allowed origin `https://laurentperrinet.github.io`
is hard-coded in `worker/index.mjs` (`ORIGIN`). Change all three together if the
site moves.

## 4. Deploying a change

| Change | Deploy |
| --- | --- |
| Interface, rendering, physics or biology only | Push to `main` (Pages only) |
| Worker logic that keeps the mesh | `npx wrangler deploy` |
| Mesh, bedrock or initial sand (signature changes) | Run `npx wrangler deploy`, then push to `main` straight away. Until both are live, open tabs get HTTP 409 and must reload |

Before any deployment, run `npm test`. The tests use mocks and do not prove that
the production configuration is right: after deploying, check `/api/state`, load
the site, and watch the 🔄 indicator after the first sync.

## 5. Request budget and abuse

The Worker suggests a sync interval of
`max(5 min, active browsers × 2 × 86,400,000 ms / 80,000)`. This targets 80,000
sync-related requests per day for a well-behaved population. It is **not**
enforced against direct calls. OAuth exchanges, resets and reads of
`/api/state` are outside it. If a strict ceiling matters, add Cloudflare rate
limiting or WAF rules in front of the Worker. Contributions are anonymous:
averaging bounds the effect of one browser per version, but a script with many IDs
can still bias the terrain.

## 6. Owner reset

Open `?admin`, sign in with GitHub, then press **R** twice or click **Reset
Terrain**. The Worker checks the bearer token with `api.github.com/user` and
compares the numeric ID with `OWNER_GITHUB_ID`, then reinitialises the shared
terrain and increments its version.
