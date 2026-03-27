# No Brakes Sports

> Premium sports market analytics and intelligence platform.
> Track price movements, compare prediction markets, surface divergences — for informational purposes only.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase (Postgres + Auth + RLS) |
| Payments | Stripe Subscriptions |
| Email | Resend |
| Analytics | PostHog |
| Tables | TanStack Table v8 |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| State | Zustand (minimal) |
| Deployment | Vercel |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Fill in all values — see Environment Variables section below
```

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Copy your project URL and anon/service keys into `.env.local`
3. Run the migrations:

```bash
# Via Supabase CLI
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push

# Or paste migrations directly in Supabase Dashboard → SQL Editor
# Run: supabase/migrations/001_initial_schema.sql
# Then: supabase/migrations/002_rls_policies.sql
```

4. Seed demo data:

```bash
# In Supabase Dashboard → SQL Editor, paste and run:
# supabase/seeds/seed.sql
```

### 4. Set up Stripe

1. Create a Stripe account and get API keys
2. Create two products in Stripe Dashboard:
   - **Pro Monthly** — recurring, $50/month
   - **Pro Yearly** — recurring, $480/year
3. Copy price IDs into `.env.local`
4. Set up webhook (local):

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copy the webhook secret into STRIPE_WEBHOOK_SECRET
```

5. For production, add webhook in Stripe Dashboard:
   - URL: `https://your-domain.com/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`

### 5. Run locally

```bash
npm run dev
# App at http://localhost:3000
```

---

## Environment Variables

```bash
# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_MONTHLY_PRICE_ID=
STRIPE_PRO_YEARLY_PRICE_ID=

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@nobrakes.sports

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com

# Admin
ADMIN_EMAILS=admin@yourdomain.com
```

---

## Project Structure

```
app/
├── (auth)/          # Login, signup, forgot-password
├── (marketing)/     # Landing, pricing, legal pages
├── (app)/           # Authenticated app shell
│   ├── dashboard/   # Overview dashboard
│   ├── markets/     # Market data table
│   ├── line-movement/       # Historical movement
│   ├── prediction-markets/  # Prediction vs sportsbook
│   ├── alerts/      # User alerts management
│   ├── watchlist/   # Saved items
│   ├── history/     # Historical analytics
│   ├── account/     # Profile + billing
│   └── admin/       # Admin panel (admin-only)
├── api/
│   ├── auth/callback/       # Supabase auth callback
│   └── stripe/webhook/      # Stripe webhook handler
components/
├── ui/              # shadcn/ui primitives
├── layout/          # Sidebar, topbar
├── shared/          # StatCard, EmptyState, ProGate, Skeletons
├── dashboard/       # Dashboard-specific components
├── markets/         # Markets table + filters
├── line-movement/   # Chart + movement table
├── prediction-markets/
├── alerts/
└── watchlist/
lib/
├── supabase/        # client.ts, server.ts, middleware.ts
├── stripe/          # client.ts, actions.ts
├── email/           # resend.ts (email templates)
├── hooks/           # use-toast.ts
└── utils.ts         # Formatters, helpers
types/index.ts       # All TypeScript types
supabase/
├── migrations/      # Schema + RLS
└── seeds/           # Demo data
```

---

## Access Control

| Feature | Free | Pro |
|---|---|---|
| Market overview | Delayed (24h) | Real-time |
| Watchlist | 5 items | Unlimited |
| Line Movement | ✗ | ✓ |
| Prediction Markets | ✗ | ✓ |
| Alerts | ✗ | ✓ |
| Historical data | ✗ | ✓ |
| Advanced filters | ✗ | ✓ |
| Data export | ✗ | ✓ |

---

## Making a User Admin

In Supabase Dashboard → SQL Editor:

```sql
UPDATE profiles SET is_admin = TRUE WHERE email = 'admin@yourmail.com';
```

---

## Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard or via CLI:
vercel env add STRIPE_SECRET_KEY
# ... (repeat for all env vars)
```

**Stripe webhook for production:**
After deployment, add your production URL in Stripe Dashboard:
`https://your-domain.vercel.app/api/stripe/webhook`

---

## Data Model

Core tables: `profiles`, `sports`, `leagues`, `teams`, `events`, `market_sources`, `market_snapshots`, `prediction_market_snapshots`, `market_mappings`, `watchlists`, `watchlist_items`, `alerts`, `alert_triggers`, `notification_preferences`, `feature_flags`, `audit_logs`, `content_blocks`

Full schema in `supabase/migrations/001_initial_schema.sql`
RLS policies in `supabase/migrations/002_rls_policies.sql`

---

## Legal

This platform provides sports market data for **informational purposes only**.
It is not a sportsbook, betting service, or financial advisory platform.
No wagers are facilitated. No gambling recommendations are made.

See `/disclaimer`, `/terms`, and `/privacy` pages.

---

## Support

Email: support@nobrakes.sports
