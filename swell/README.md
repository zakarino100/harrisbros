# Swell — Lead Command

> Multi-tenant lead dashboard for Blue Ocean clients. One Replit deploy, every client gets their own subdomain on `nopressurelaunch.com`.

## Architecture

- **Server**: Express + better-sqlite3 (SQLite, WAL mode)
- **Client**: React 18 + Vite + Tailwind v4
- **Auth**: Per-tenant cookie (HMAC over tenant id + password hash)
- **Routing**: `<tenant>.nopressurelaunch.com` → `tenantMiddleware` resolves from `req.hostname`

```
nopressurelaunch.com               → "open this from your client subdomain" landing
swell.nopressurelaunch.com         → reserved (admin, future)
harrisbrosads.nopressurelaunch.com → tenant: harris_bros
mackwash.nopressurelaunch.com      → tenant: mackwash
<new>.nopressurelaunch.com         → add SWELL_TENANTS=...,<NEW_PREFIX> + env vars, redeploy
```

## Adding a new tenant

1. Choose a prefix (e.g. `ACME_WASH`) and a slug (e.g. `acme`)
2. Add the prefix to `SWELL_TENANTS=HARRIS_BROS,MACKWASH,ACME_WASH`
3. Add their env vars (see `.env.example`):
   - `ACME_WASH_NAME`, `ACME_WASH_SLUG`, `ACME_WASH_PASSWORD`, `ACME_WASH_CONTACT_PHONE`, `ACME_WASH_FB_FORM_IDS`, `ACME_WASH_FB_PAGE_TOKEN`, etc.
4. Point `acme.nopressurelaunch.com` (CNAME) at the Replit deploy
5. Redeploy — the seed runs on boot and creates the tenant
6. Subscribe the tenant's FB Page to `https://swell.nopressurelaunch.com/api/facebook/webhook` with the `leadgen` field, using the single shared `FACEBOOK_WEBHOOK_VERIFY_TOKEN`

## Local dev

```bash
npm install
cp .env.example .env   # edit values
npm run dev            # starts server on :3000 + Vite dev server on :5173
```

In dev, set `X-Tenant-Slug: harrisbrosads` (or `mackwash`) header on requests
since `localhost` doesn't have a tenant subdomain.

## Endpoints

### Public (per-tenant from req.hostname)
- `GET  /api/health` — global, no tenant
- `GET  /api/me` — tenant info + auth status
- `GET  /login` — tenant login page (server-rendered fallback)
- `POST /login` — `{ password }` → sets cookie
- `POST /logout` — clears cookie

### Webhooks (shared, multi-tenant routing inside)
- `GET  /api/facebook/webhook` — Meta verify handshake
- `POST /api/facebook/webhook` — Meta lead delivery; routes by `form_id` → tenant

### Authenticated (tenant-scoped)
- `GET   /api/leads`
- `GET   /api/leads/:id`
- `PATCH /api/leads/:id` — `{ status?, notes? }`
- `GET   /api/dashboard/kpis`

## Deploy

Replit: just push and click Publish.

The deploy container runs `npm install && npm run build`, then
`node dist/server/index.js`. The SQLite DB file lives at `./data/swell.db`
(persistent on Replit). On first boot, the seed creates tenants from env vars.

## Branding

Default theme: black + gold (`#0a0a0a` / `#fbbf24`) to match
nopressurelaunch.com. Each tenant can override `<PREFIX>_BRAND_COLOR` to
make their dashboard pop in their own color.

---

Built fast on 2026-05-01. Refactor of `harris-bros-leads/` into multi-tenant.
