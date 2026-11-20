# Running ZENO Order locally

Set up on 2026-11-19 for a machine behind the FPT corporate proxy.

## Prerequisites (already installed on this machine)

- **Node 24** via nvm (`nvm use 24`; it is the default). Node 18 is too old for vitest/rolldown.
- **neon CLI** (`npm i -g neon@latest`) — used once to provision a claimable Neon project.
- Dependencies: `npm install` (done). Includes `ws` + `https-proxy-agent` for the proxy tunnel.

## What is provisioned

A **Claimable Neon project** (no account needed) gives Postgres + Neon Auth:

- Project `cold-boat-76889860`, region `aws-us-east-2`, **expires 2026-11-22** (72h unclaimed).
- Object Storage + Functions are **not** available until the project is claimed, so product/category image uploads and the payment-jobs cron won't work yet. Everything else (menu, orders, auth, opening hours, re-order, printing, push wiring) works.
- To keep it permanently: `neon claim accept cold-boat-76889860` and sign in, then re-run `neon deploy` with the full `neon.ts` to enable Object Storage + Functions.
- To provision a fresh one later: temporarily reduce `neon.ts` to `defineConfig({ auth: true })`, run `neon claim create --env-pull`, then restore `neon.ts`.

## Environment

`.env` (gitignored) holds the pulled Neon vars (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`) plus locally generated app secrets (`NUXT_SESSION_PASSWORD`, `APP_ENCRYPTION_KEY`), `APP_BASE_URL=http://localhost:3000`, and `INVITE_REQUIRE_VERIFIED_EMAIL=false` for local.

Regenerate secrets if needed:

```bash
openssl rand -base64 48   # NUXT_SESSION_PASSWORD
openssl rand -base64 32   # APP_ENCRYPTION_KEY (AES-256-GCM, exactly 32 bytes)
```

## Corporate proxy

The Neon driver connects over a WebSocket, which Node does not route through `HTTPS_PROXY` automatically. Two additions tunnel it through the proxy, and both are **no-ops when no proxy env is set** (normal production):

- `server/plugins/neon-proxy.ts` — configures the app's Neon driver at boot.
- `scripts/migrate-proxied.mjs` — proxy-aware migration runner (`npm run db:migrate:proxied`).

If you move off the corporate network, unset the proxy vars (or they simply stop being used) and `npm run db:migrate` (drizzle-kit) also works.

## Run

```bash
nvm use 24

# 1. Apply migrations (0000–0008) — proxy-aware
npm run db:migrate:proxied

# 2. Dev server
npm run dev            # http://localhost:3000

# or a production build + preview
npm run build
node .output/server/index.mjs
```

Smoke checks:

```bash
curl http://localhost:3000/api/health                              # {"status":"ok"}
curl http://localhost:3000/api/public/stores/does-not-exist/menu   # 404 NOT_FOUND → DB reachable
```

Then open http://localhost:3000 → sign up → create a store → add menu → the customer link is `/s/<slug>`.

## Optional features

- **Google Analytics:** set `NUXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXX` before building/running.
- **Web Push:** `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
- **Tests that hit the DB:** `.env` already sets `ZENO_TEST_DB=1` and `NEON_BRANCH`; run `npm run test:integration` / `npm run test:api`. These run against the same branch — use a dedicated test branch (`neon checkout test --create`) before writing test data if you want isolation from dev data.
