-- ============================================================
-- Migration 032: Strip "[discovery]" suffix from BetMGM market_sources name
-- ============================================================
--
-- BetMGM was registered in market_sources with the display name
-- "BetMGM (Ontario) [discovery]" back when the worker adapter was
-- still a passive-capture pass. The adapter has long since promoted
-- to a full parser (game lines + 1400+ props per cycle), but the
-- DB row name was never updated, so the /arbitrage and /top-lines
-- pages render the source label with the trailing "[discovery]"
-- text and our book-logo / book-url lookups don't match.
--
-- Strip the suffix here. Defensive: also covers any other book that
-- accidentally landed with the same suffix.

UPDATE market_sources
   SET name = regexp_replace(name, '\s*\[discovery\]\s*$', '', 'i')
 WHERE name ~* '\s*\[discovery\]\s*$';
