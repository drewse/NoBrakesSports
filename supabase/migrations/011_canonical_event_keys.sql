-- ── 011_canonical_event_keys.sql ─────────────────────────────────────────────
--
-- Root cause of duplicate events in the Markets tab:
--   Each sportsbook adapter used its own source-specific external_id format
--   (e.g. "pinnacle:12345678", "betrivers_on:87654321") for the same real game.
--   This caused multiple events table rows for "Toronto Raptors vs Miami Heat",
--   one per source — showing duplicates in the UI.
--
-- Fix (in code): canonicalEventKey() now produces a cross-source identity:
--   "{league}:{YYYY-MM-DD}:{home team}:{away team}"
--   e.g. "nba:2026-04-09:toronto raptors:miami heat"
--
-- All sportsbooks describing the same game now upsert to the SAME events row.
--
-- This migration cleans up old source-specific event rows that are now orphaned.
-- Safe to run: orphaned events have no associated market_snapshots after the
-- code change goes live (new snapshots reference canonical event IDs only).
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Delete events whose external_id still uses the old "source:id" format.
-- Pattern: starts with known source slugs followed by a colon.
-- Canonical keys look like "nba:2026-04-09:..." — never start with a sportsbook slug.
DELETE FROM events
WHERE external_id ~ '^(pinnacle|betrivers_on|betrivers|sports_interaction|pointsbet_on|bet365|fanduel|draftkings|betmgm|caesars|bet99|betway|betvictor|northstarbets|proline|888sport|bwin|betano|leovegas|tonybet|casumo|ballybet|partypoker|jackpotbet|thescore):'
  AND external_id NOT LIKE '%:%:%:%'; -- canonical keys have at least 4 colons (league:date:home:away)
