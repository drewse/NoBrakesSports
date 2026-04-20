# NoBrakes Worker — Playwright scraper for Cloudflare-protected books

Persistent Node.js worker that runs headless Chromium against sportsbooks we
can't hit from Vercel. Writes to the same Supabase tables as the main app
(`current_market_odds`, `prop_odds`) so the rest of the product "just works".

## Architecture

```
Railway (Pro plan)
└── Docker container (this folder)
    ├── Node 20 + TypeScript
    ├── Playwright + Chromium (from mcr.microsoft.com/playwright)
    ├── Scheduler runs each adapter on its own pollInterval
    ├── Shared BrowserContext pool → low memory
    └── Express /health endpoint (Railway healthcheck)
```

Each adapter is a **self-contained module** in `src/adapters/`. Adapters return
normalized events/markets/props — the shared `writer.ts` handles the rest
(source lookup, event matching, change detection, Supabase upsert).

## Layout

```
worker/
├── Dockerfile
├── railway.json
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── index.ts            — Boot, registers adapters
    ├── lib/
    │   ├── adapter.ts      — BookAdapter contract + scheduler + backoff
    │   ├── browser.ts      — Shared Chromium + context helpers
    │   ├── canonical.ts    — canonicalEventKey, hashes (mirrors app logic)
    │   ├── health-server.ts— /health endpoint for Railway probe
    │   ├── logger.ts       — JSON (prod) / pretty (dev) logger
    │   ├── supabase.ts     — Service-role client
    │   ├── types.ts        — Shared types (ScrapedEvent, GameMarket, etc.)
    │   └── writer.ts       — Upserts events / markets / props into Supabase
    └── adapters/
        └── pointsbet.ts    — Proof-of-concept adapter
```

## Local development

```bash
cd worker
cp .env.example .env
# Fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

npm install
# First time — install the Playwright browser binary:
npx playwright install chromium

npm run dev
# Starts in watch mode; logs to stdout in pretty format
```

Visit `http://localhost:8080/health` to see runner status.

To run only one adapter:
```bash
ENABLED_BOOKS=pointsbet_on npm run dev
```

## Deploy to Railway

### First-time setup

1. In Railway, create a **New Project → Empty Project**
2. Add a new service → **Deploy from GitHub** → select this repo
3. In the service settings:
   - **Root directory**: `worker`
   - **Build**: auto-detects `Dockerfile` (railway.json sets this)
   - **Start command**: leave blank (Dockerfile CMD handles it)

### Environment variables (Settings → Variables)

Required:
- `SUPABASE_URL` — e.g. `https://qxqxzexfmgqwwbfkfogt.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — the service role JWT (NOT the anon key)

Optional:
- `ENABLED_BOOKS` — comma-separated slugs, e.g. `pointsbet_on,bet365`.
  Omit to run every registered adapter.
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error` (default: `info`)
- `DEFAULT_POLL_INTERVAL` — seconds between scrapes (default: 60).
  Individual adapters override this via `pollIntervalSec`.

Railway auto-sets `PORT`.

### Healthcheck

Railway pings `/health` every 30s. Worker returns:
- **200 ok** if every adapter has succeeded within the last 15 minutes
- **503 degraded** otherwise (Railway restarts after `restartPolicyMaxRetries`
  failed probes per `railway.json`)

### Resource sizing

Playwright Chromium is memory-hungry. Starting point for Railway Pro:
- **1 vCPU, 2 GB RAM** works for 3-5 parallel adapters
- **2 vCPU, 4 GB RAM** works for 10+ adapters

Set these in Railway → Service → Settings → Resources.

## Adding a new adapter

1. Create `src/adapters/<book>.ts` exporting a `BookAdapter`:

    ```ts
    import type { BookAdapter } from '../lib/adapter.js'

    export const myBookAdapter: BookAdapter = {
      slug: 'my_book',          // must match market_sources.slug
      name: 'My Book',
      pollIntervalSec: 120,     // every 2 min
      needsBrowser: true,

      async scrape({ signal, log }) {
        // ... return { events: ScrapedEvent[], errors: string[] }
      },
    }
    ```

2. Register it in `src/index.ts`:

    ```ts
    import { myBookAdapter } from './adapters/my-book.js'
    const ALL_ADAPTERS: BookAdapter[] = [ pointsbetAdapter, myBookAdapter ]
    ```

3. Deploy — Railway auto-redeploys on push.

### Playwright patterns

Use the `withPage` helper for one-off scrapes:

```ts
import { withPage } from '../lib/browser.js'

await withPage(async (page) => {
  await page.goto('https://book.com/sports', { waitUntil: 'domcontentloaded' })
  // run fetches *inside the page* to reuse the browser's cookies/JS:
  const data = await page.evaluate(async (url: string) => {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    return r.json()
  }, 'https://api.book.com/events')
  // ...
})
```

Cloudflare-protected books: always visit a seed URL first so `__cf_bm`
and `cf_clearance` cookies get issued.

## Writer contract

Your adapter returns `ScrapedEvent[]`. The writer:

1. Creates the `market_sources` row if missing (using your `slug`/`name`)
2. For each event: matches by `canonicalEventKey` against the existing DB,
   or creates a new event row
3. Upserts game markets into `current_market_odds` (line_value=0, 0 conflict)
4. Upserts props into `prop_odds` using the same schema as Vercel adapters
5. Touches `data_pipelines.last_success_at` so the admin UI shows "healthy"

You don't need to manage event IDs or dedup — just normalize and return.

## Graceful shutdown

The worker handles `SIGTERM` (Railway's shutdown signal) — in-flight scrapes
are aborted, Chromium closes cleanly, health server stops. No half-written
rows.
