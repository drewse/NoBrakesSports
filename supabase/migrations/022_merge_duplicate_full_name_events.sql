-- Merge duplicate event rows that have the same league + date + title
-- but different external_ids. These appeared because
-- canonicalEventKey() was implemented inconsistently between worker
-- (raw startTime.slice(0,10)) and Vercel (new Date().toISOString()).
-- When an adapter sent startTime in a format the two implementations
-- parse differently (e.g. "04/24/2026 18:40" vs ISO), worker and
-- Vercel computed different external_ids for the same game and both
-- passed the unique constraint — two rows per game.
--
-- Both canonical key implementations are now aligned; this migration
-- cleans the historical duplicates.
--
-- Strategy: group events by (league_id, start_time::date, title).
-- Within each group, keep the row with the most current_market_odds
-- entries (most sources = richer data). Delete the rest. ON DELETE
-- CASCADE clears associated current_market_odds / market_snapshots /
-- prop_odds / prediction_market_snapshots rows on the losers — the
-- winning row's rows are untouched.
--
-- Scope: only upcoming / recent events (last 7 days forward) to avoid
-- churning archived history. Safe to re-run.

BEGIN;

WITH source_counts AS (
  SELECT
    e.id,
    e.league_id,
    e.start_time::date AS event_date,
    e.title,
    COALESCE((
      SELECT COUNT(DISTINCT source_id)
      FROM current_market_odds cmo
      WHERE cmo.event_id = e.id
    ), 0) AS source_count
  FROM events e
  WHERE e.start_time > NOW() - INTERVAL '2 days'
    AND e.start_time < NOW() + INTERVAL '14 days'
),
duplicate_groups AS (
  SELECT league_id, event_date, title, COUNT(*) AS group_size
  FROM source_counts
  GROUP BY league_id, event_date, title
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    sc.id,
    sc.source_count,
    ROW_NUMBER() OVER (
      PARTITION BY sc.league_id, sc.event_date, sc.title
      -- Prefer rows with more sources; tiebreak on ID to be deterministic.
      ORDER BY sc.source_count DESC, sc.id
    ) AS rank
  FROM source_counts sc
  JOIN duplicate_groups dg
    ON dg.league_id = sc.league_id
   AND dg.event_date = sc.event_date
   AND dg.title = sc.title
)
DELETE FROM events
WHERE id IN (SELECT id FROM ranked WHERE rank > 1);

COMMIT;
