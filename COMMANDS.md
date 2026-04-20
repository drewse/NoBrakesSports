# Admin SQL Commands

Common SQL snippets for managing the NoBrakes Sports database. Run these in
the **Supabase SQL Editor** (Dashboard → SQL Editor → New query).

Schema reference:
- `profiles.subscription_tier` — enum `'free' | 'pro'`
- `profiles.subscription_status` — enum `'active' | 'past_due' | 'canceled' | 'unpaid' | 'trialing' | 'incomplete' | 'incomplete_expired'`
- `profiles.is_admin` — boolean
- Pro gate requires: `subscription_tier = 'pro'` AND `subscription_status = 'active'`

---

## 1. Grant Pro access to a user (free lifetime Pro)

### By email
```sql
UPDATE profiles
SET subscription_tier = 'pro',
    subscription_status = 'active',
    subscription_period_end = NOW() + INTERVAL '100 years',
    updated_at = NOW()
WHERE email = 'user@example.com';
```

### By user ID
```sql
UPDATE profiles
SET subscription_tier = 'pro',
    subscription_status = 'active',
    subscription_period_end = NOW() + INTERVAL '100 years',
    updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';
```

### Grant Pro to multiple users
```sql
UPDATE profiles
SET subscription_tier = 'pro',
    subscription_status = 'active',
    subscription_period_end = NOW() + INTERVAL '1 year',
    updated_at = NOW()
WHERE email IN (
  'friend1@example.com',
  'friend2@example.com',
  'friend3@example.com'
);
```

### Grant Pro for a limited trial (30 days)
```sql
UPDATE profiles
SET subscription_tier = 'pro',
    subscription_status = 'trialing',
    trial_end = NOW() + INTERVAL '30 days',
    subscription_period_end = NOW() + INTERVAL '30 days',
    updated_at = NOW()
WHERE email = 'user@example.com';
```

---

## 2. Revoke Pro access

```sql
UPDATE profiles
SET subscription_tier = 'free',
    subscription_status = 'canceled',
    subscription_period_end = NULL,
    updated_at = NOW()
WHERE email = 'user@example.com';
```

---

## 3. Make a user an admin

```sql
UPDATE profiles
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'user@example.com';
```

Revoke admin:
```sql
UPDATE profiles
SET is_admin = FALSE, updated_at = NOW()
WHERE email = 'user@example.com';
```

---

## 4. List / inspect users

### All Pro users
```sql
SELECT id, email, full_name, subscription_tier, subscription_status,
       subscription_period_end, created_at
FROM profiles
WHERE subscription_tier = 'pro' AND subscription_status = 'active'
ORDER BY created_at DESC;
```

### Recent signups
```sql
SELECT id, email, full_name, subscription_tier, created_at
FROM profiles
ORDER BY created_at DESC
LIMIT 50;
```

### Find a user by partial email
```sql
SELECT id, email, subscription_tier, subscription_status, is_admin
FROM profiles
WHERE email ILIKE '%partial%';
```

### Count users by tier
```sql
SELECT subscription_tier, subscription_status, COUNT(*) AS n
FROM profiles
GROUP BY subscription_tier, subscription_status
ORDER BY n DESC;
```

---

## 5. Delete a user (GDPR / account deletion)

Deletes both `auth.users` (auto-cascades to `profiles`) and any app-side data.

```sql
-- Option A: delete the auth user (cascades to profiles via FK)
DELETE FROM auth.users WHERE email = 'user@example.com';

-- Option B: delete only the profile row (keeps auth login)
DELETE FROM profiles WHERE email = 'user@example.com';
```

---

## 6. Reset / clean prop_odds for a specific book

Useful when a book returns bad data (e.g., swapped Over/Under). Delete the
rows, and the next cron will re-insert fresh.

```sql
-- Delete all prop_odds for a source (by slug)
DELETE FROM prop_odds
WHERE source_id = (SELECT id FROM market_sources WHERE slug = 'betway');

-- Delete a specific prop category for a book
DELETE FROM prop_odds
WHERE source_id = (SELECT id FROM market_sources WHERE slug = 'betway')
  AND prop_category = 'player_blocks';

-- Delete props older than N hours across all books
DELETE FROM prop_odds
WHERE snapshot_time < NOW() - INTERVAL '4 hours';
```

---

## 7. Reset / clean current_market_odds

```sql
-- Delete game lines for a specific book
DELETE FROM current_market_odds
WHERE source_id = (SELECT id FROM market_sources WHERE slug = 'draftkings');

-- Delete all game lines older than N hours
DELETE FROM current_market_odds
WHERE snapshot_time < NOW() - INTERVAL '6 hours';
```

---

## 8. Find and merge duplicate events

When two adapters create separate events for the same real-world game.

```sql
-- Find likely duplicates: same league, same day, similar team names
SELECT e1.id AS id1, e1.title AS title1,
       e2.id AS id2, e2.title AS title2,
       e1.start_time
FROM events e1
JOIN events e2 ON e1.league_id = e2.league_id
  AND e1.id < e2.id
  AND ABS(EXTRACT(EPOCH FROM (e1.start_time - e2.start_time))) < 14400 -- within 4 hours
ORDER BY e1.start_time;

-- Merge: move all odds from duplicate to canonical, then delete duplicate
-- Replace the UUIDs below with the actual canonical + duplicate IDs.
BEGIN;
  UPDATE current_market_odds SET event_id = '<canonical>' WHERE event_id = '<duplicate>';
  UPDATE prop_odds             SET event_id = '<canonical>' WHERE event_id = '<duplicate>';
  UPDATE market_snapshots      SET event_id = '<canonical>' WHERE event_id = '<duplicate>';
  DELETE FROM events WHERE id = '<duplicate>';
COMMIT;
```

---

## 9. Inspect market sources (books)

### List all sources
```sql
SELECT id, slug, name, is_active
FROM market_sources
ORDER BY name;
```

### Toggle a book on/off
```sql
UPDATE market_sources SET is_active = FALSE WHERE slug = 'pointsbet_on';
UPDATE market_sources SET is_active = TRUE  WHERE slug = 'betway';
```

### Count props per book (last 4 hours)
```sql
SELECT ms.slug, ms.name, COUNT(*) AS prop_count
FROM prop_odds p
JOIN market_sources ms ON ms.id = p.source_id
WHERE p.snapshot_time > NOW() - INTERVAL '4 hours'
GROUP BY ms.slug, ms.name
ORDER BY prop_count DESC;
```

### Count game markets per book (last 4 hours)
```sql
SELECT ms.slug, ms.name, COUNT(*) AS n
FROM current_market_odds c
JOIN market_sources ms ON ms.id = c.source_id
WHERE c.snapshot_time > NOW() - INTERVAL '4 hours'
GROUP BY ms.slug, ms.name
ORDER BY n DESC;
```

---

## 10. Pipeline health / sync status

```sql
SELECT slug, status, last_checked_at, last_success_at, consecutive_failures
FROM data_pipelines
ORDER BY slug;

-- Reset a stuck pipeline
UPDATE data_pipelines
SET status = 'healthy', consecutive_failures = 0, circuit_open_at = NULL
WHERE slug = 'pointsbet_on';
```

---

## 11. Search for a specific player's props

```sql
SELECT ms.slug, p.prop_category, p.player_name, p.line_value,
       p.over_price, p.under_price, p.snapshot_time
FROM prop_odds p
JOIN market_sources ms ON ms.id = p.source_id
WHERE p.player_name ILIKE '%lebron%'
ORDER BY ms.slug, p.prop_category, p.line_value;
```

---

## 12. Clear all opportunities / reset caches

```sql
-- Clear prop history (keeps current_market_odds)
TRUNCATE prop_snapshots;

-- Clear market history
TRUNCATE market_snapshots;

-- Nuclear: wipe ALL odds data (will repopulate from next cron)
TRUNCATE prop_odds, current_market_odds, prop_snapshots, market_snapshots;
```

---

## 13. Stripe sync helpers

After Stripe webhook processes a subscription change, these sync the DB.

### Manually mark a Stripe subscription as active
```sql
UPDATE profiles
SET subscription_tier = 'pro',
    subscription_status = 'active',
    stripe_customer_id = 'cus_XXXXX',
    subscription_id = 'sub_XXXXX',
    subscription_period_end = '2027-01-01 00:00:00+00',
    updated_at = NOW()
WHERE email = 'user@example.com';
```

---

## 14. Useful read-only admin queries

### Top 20 events by number of books quoting them
```sql
SELECT e.title, COUNT(DISTINCT c.source_id) AS book_count
FROM events e
JOIN current_market_odds c ON c.event_id = e.id
WHERE e.start_time > NOW()
  AND c.snapshot_time > NOW() - INTERVAL '1 hour'
GROUP BY e.id, e.title
ORDER BY book_count DESC
LIMIT 20;
```

### Recent prop_odds activity
```sql
SELECT DATE_TRUNC('minute', snapshot_time) AS minute, COUNT(*) AS rows
FROM prop_odds
WHERE snapshot_time > NOW() - INTERVAL '30 minutes'
GROUP BY minute
ORDER BY minute DESC;
```

---

## Safety notes

- **Always `BEGIN;` before destructive operations**; `ROLLBACK;` if unsure, `COMMIT;` if correct.
- Never `DROP TABLE` or `TRUNCATE profiles` without a backup — user data is in `profiles`.
- `auth.users` deletion cascades to `profiles` — deleting an auth user permanently removes the account.
- Pro grants via SQL bypass Stripe — if the user later subscribes via Stripe, the webhook will overwrite these values.
