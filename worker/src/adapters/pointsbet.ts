/**
 * PointsBet Ontario adapter (Playwright edition).
 *
 * Cloudflare blocks direct fetch + residential proxy from Vercel, so we
 * drive a real Chromium that visits on.pointsbet.ca once to earn a cf_bm
 * cookie, then calls the public JSON API from within the same browser
 * context. Same API paths as the legacy server adapter.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, NormalizedEvent, GameMarket, NormalizedProp, MarketType } from '../lib/types.js'

const BASE_V2 = 'https://api.on.pointsbet.com/api/v2'
const BASE_V3 = 'https://api.on.pointsbet.com/api/mes/v3'
const SEED_URL = 'https://on.pointsbet.ca/sports/basketball'

const SPORTS = ['basketball', 'baseball', 'icehockey', 'soccer'] as const

interface LeagueSlugMap { [competitionName: string]: { slug: string; sport: string } }

const LEAGUE_MAP: LeagueSlugMap = {
  'nba':                      { slug: 'nba',         sport: 'basketball' },
  'mlb':                      { slug: 'mlb',         sport: 'baseball'   },
  'nhl':                      { slug: 'nhl',         sport: 'ice_hockey' },
  'english premier league':   { slug: 'epl',         sport: 'soccer'     },
  'spanish la liga':          { slug: 'laliga',      sport: 'soccer'     },
  'german bundesliga':        { slug: 'bundesliga',  sport: 'soccer'     },
  'italian serie a':          { slug: 'seria_a',     sport: 'soccer'     },
  'french ligue 1':           { slug: 'ligue_one',   sport: 'soccer'     },
}

interface PBMarket {
  eventClass?: string
  name?: string
  outcomes?: Array<{
    name?: string
    side?: string
    price?: number
    points?: number
    isHidden?: boolean
    isOpenForBetting?: boolean
  }>
}

interface PBEvent {
  key: string | number
  homeTeam?: string
  awayTeam?: string
  startsAt?: string
  isLive?: boolean
  specialFixedOddsMarkets?: PBMarket[]
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

function mapMarketType(eventClass: string): MarketType | null {
  const c = eventClass.toLowerCase()
  if (c.includes('moneyline') && !c.includes('player') && !c.includes('batter') && !c.includes('pitcher')) return 'moneyline'
  if (c.includes('spread') && !c.includes('player')) return 'spread'
  if (c.includes('total') && !c.includes('player') && !c.includes('batter') && !c.includes('pitcher')) return 'total'
  return null
}

// Order matters: the mapPropCategory fuzzy-match returns the first key the
// eventClass string contains, so more specific keys MUST appear before shorter
// ones (e.g. 'player points + rebounds' before 'player points').
const PROP_CATEGORY_MAP: Record<string, string> = {
  // Basketball — combos first so they beat the single-stat prefixes
  'player pts + rebs + asts':   'player_pts_reb_ast',
  'player points + rebounds + assists': 'player_pts_reb_ast',
  'player points + rebounds':   'player_pts_reb',
  'player points + assists':    'player_pts_ast',
  'player rebounds + assists':  'player_ast_reb',
  // Basketball — singles
  'player 3-pointers made':     'player_threes',
  'player three pointers made': 'player_threes',
  'player threes':              'player_threes',
  'alternate threes':           'player_threes',
  'alternate points':           'player_points',
  'alternate rebounds':         'player_rebounds',
  'alternate assists':          'player_assists',
  'player points':              'player_points',
  'player rebounds':            'player_rebounds',
  'player assists':             'player_assists',
  'player steals':              'player_steals',
  'player blocks':              'player_blocks',
  'player turnovers':           'player_turnovers',
  // Baseball
  'batter hits':                'player_hits',
  'batter home runs':           'player_home_runs',
  'batter rbis':                'player_rbis',
  'batter runs':                'player_runs',
  'batter total bases':         'player_total_bases',
  'batter stolen bases':        'player_stolen_bases',
  'pitcher strikeouts':         'player_strikeouts_p',
  'pitcher earned runs':        'player_earned_runs',
  'pitcher outs':               'pitcher_outs',
  // Hockey
  'skater points':              'player_hockey_points',
  'player shots on goal':       'player_shots_on_goal',
  'player goals':               'player_goals',
  'player saves':               'player_saves',
  // Soccer
  'player shots on target':     'player_shots_target',
}

function mapPropCategory(eventClass: string): string | null {
  const lower = (eventClass || '').toLowerCase().trim()
  const direct = PROP_CATEGORY_MAP[lower]
  if (direct) return direct
  // Fuzzy containment
  for (const [key, cat] of Object.entries(PROP_CATEGORY_MAP)) {
    if (lower.includes(key)) return cat
  }
  return null
}

/**
 * PointsBet groups all player/line variants for a stat under a single market
 * (e.g. "Alternate Assists" with 25 outcomes covering multiple players × lines).
 * Each outcome's .name encodes player + side; .points is the numeric line.
 * Returns { player, side } or null if the outcome name doesn't match a known shape.
 */
function parseOutcomeShape(name: string): { player: string; side: 'over' | 'under' } | null {
  if (!name) return null
  // "Player Over 25.5 Points" / "Player Under 25.5 Points"
  let m = name.match(/^(.+?)\s+(Over|Under)\s+[\d.]+/i)
  if (m) return { player: m[1].trim(), side: m[2].toLowerCase() as 'over' | 'under' }
  // "Player Over 25.5" / "Player Under 25.5"
  m = name.match(/^(.+?)\s+(Over|Under)\s/i)
  if (m) return { player: m[1].trim(), side: m[2].toLowerCase() as 'over' | 'under' }
  // "Player To Get/Score/Record/Have/Make N+ <Stat>" → over-only threshold
  m = name.match(/^(.+?)\s+To\s+(?:Get|Score|Record|Have|Make|Throw|Hit)\s+\d+\+/i)
  if (m) return { player: m[1].trim(), side: 'over' }
  // "Player N+ <Stat>"
  m = name.match(/^(.+?)\s+\d+\+\s+/i)
  if (m) return { player: m[1].trim(), side: 'over' }
  return null
}

function parsePlayerName(marketName: string): string | null {
  // PointsBet markets: "Player Name — Stat" or "Player Name"
  const dash = marketName.match(/^(.+?)\s*[-—]\s*/)
  if (dash) return dash[1].trim()
  // Strip common stat suffixes
  const suffixes = [
    'points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'turnovers',
    'hits', 'home runs', 'rbis', 'runs', 'total bases', 'stolen bases',
    'strikeouts', 'earned runs', 'outs', 'saves', 'shots on goal', 'goals',
  ]
  const lower = marketName.toLowerCase()
  for (const s of suffixes) {
    if (lower.endsWith(s)) return marketName.slice(0, lower.length - s.length).trim()
  }
  return marketName.trim()
}

export const pointsbetAdapter: BookAdapter = {
  slug: 'pointsbet_on',
  name: 'PointsBet (Ontario)',
  pollIntervalSec: 120,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted before start'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []
      const propDrops = {
        noOutcomesOpen: 0,
        notTwoOutcomes: 0,
        unmappedCategory: 0,
        noOverUnder: 0,
        noPlayerName: 0,
        noLineValue: 0,
        kept: 0,
      }
      let propSample: any = null

      // 1. Visit once to earn CF clearance cookies
      log.debug('visiting seed url for cf_bm cookie')
      await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(2_000) // let cf_bm settle

      // 2. Fetch all competitions per sport
      const competitions: Array<{ key: string; name: string }> = []
      for (const sport of SPORTS) {
        if (signal.aborted) break
        try {
          const data = await page.evaluate(async (url: string) => {
            const r = await fetch(url, { headers: { Accept: 'application/json' } })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.json()
          }, `${BASE_V2}/sports/${sport}/competitions`)

          const locales = (data as any).locales ?? []
          for (const loc of locales) {
            for (const c of loc.competitions ?? []) {
              if (c.numberOfEvents && !String(c.name).toLowerCase().includes('futures')) {
                competitions.push({ key: c.key, name: c.name })
              }
            }
          }
        } catch (e: any) {
          errors.push(`competitions ${sport}: ${e.message}`)
        }
      }
      log.debug('competitions discovered', { count: competitions.length })

      // 3. Fetch events for each competition (batched)
      const BATCH = 8
      const unmappedClasses = new Set<string>()
      for (let i = 0; i < competitions.length; i += BATCH) {
        if (signal.aborted) break
        const batch = competitions.slice(i, i + BATCH)
        const batchResults = await Promise.allSettled(batch.map(async (comp) => {
          const info = LEAGUE_MAP[comp.name.toLowerCase()]
          if (!info) return null // unknown league — skip

          // Featured list gives game-level markets. For props, hit the per-event
          // endpoint which returns the full special markets catalog.
          const listData = await page.evaluate(async (url: string) => {
            const r = await fetch(url, { headers: { Accept: 'application/json' } })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.json()
          }, `${BASE_V3}/events/featured/competition/${comp.key}?page=1`)

          const events = (listData as any).events ?? []

          // For each event, enrich with props from the detail endpoint.
          // PointsBet loads the full specialFixedOddsMarkets (including player
          // props) from /v3/events/{key}.
          let diagnosed = false
          const enriched = await Promise.all(events.map(async (ev: PBEvent) => {
            if (ev.isLive || !ev.homeTeam || !ev.awayTeam) return ev
            const url = `${BASE_V3}/events/${ev.key}`
            try {
              const detail = await page.evaluate(async (u: string) => {
                const r = await fetch(u, { headers: { Accept: 'application/json' } })
                const text = r.ok ? await r.text() : null
                return { ok: r.ok, status: r.status, body: text }
              }, url)

              if (!detail.ok || !detail.body) return ev
              let parsed: any
              try { parsed = JSON.parse(detail.body) } catch { return ev }

              // PointsBet detail response has markets split across three arrays:
              // - fixedOddsMarkets: game-level (ML/spread/total)
              // - specialFixedOddsMarkets: props + alt lines
              // - markets: sometimes a combined list
              // Merge all three so we don't lose any eventClass coverage.
              const a = Array.isArray(parsed.fixedOddsMarkets) ? parsed.fixedOddsMarkets : []
              const b = Array.isArray(parsed.specialFixedOddsMarkets) ? parsed.specialFixedOddsMarkets : []
              const c = Array.isArray(parsed.markets) ? parsed.markets : []
              const combined = [...a, ...b, ...c]

              // Log the shape of the first event's response for diagnosis
              if (!diagnosed) {
                diagnosed = true
                log.info('detail response sample', {
                  url,
                  status: detail.status,
                  fixedOddsMarkets: a.length,
                  specialFixedOddsMarkets: b.length,
                  markets: c.length,
                  combined: combined.length,
                  firstEventClass: combined[0]?.eventClass ?? null,
                  sampleEventClasses: [...new Set(combined.slice(0, 20).map((m: any) => m.eventClass).filter(Boolean))],
                })
              }

              if (combined.length > 0) {
                ev.specialFixedOddsMarkets = combined
              }
            } catch { /* fall back to list-level markets */ }
            return ev
          }))

          return { info, events: enriched }
        }))

        for (const r of batchResults) {
          if (r.status !== 'fulfilled' || !r.value) continue
          const { info, events } = r.value
          for (const ev of events as PBEvent[]) {
            if (ev.isLive) continue
            if (!ev.homeTeam || !ev.awayTeam) continue

            const event: NormalizedEvent = {
              externalId: String(ev.key),
              homeTeam: ev.homeTeam,
              awayTeam: ev.awayTeam,
              startTime: ev.startsAt ?? '',
              leagueSlug: info.slug,
              sport: info.sport,
            }

            const gameMarkets: GameMarket[] = []
            const props: NormalizedProp[] = []

            for (const m of ev.specialFixedOddsMarkets ?? []) {
              const outcomes = (m.outcomes ?? []).filter(o => !o.isHidden && o.isOpenForBetting)
              const isPlayerClass = (m.eventClass ?? '').toLowerCase().includes('player')
                || (m.eventClass ?? '').toLowerCase().startsWith('alternate ')
                || (m.eventClass ?? '').toLowerCase().includes('batter')
                || (m.eventClass ?? '').toLowerCase().includes('pitcher')
              if (outcomes.length === 0) {
                if (isPlayerClass) propDrops.noOutcomesOpen++
                continue
              }

              // Game-level
              const gameType = mapMarketType(m.eventClass ?? '')
              if (gameType) {
                const home = outcomes.find(o => (o.side ?? '').toLowerCase() === 'home')
                const away = outcomes.find(o => (o.side ?? '').toLowerCase() === 'away')
                const over = outcomes.find(o => (o.name ?? '').toLowerCase().startsWith('over'))
                const under = outcomes.find(o => (o.name ?? '').toLowerCase().startsWith('under'))
                const draw = outcomes.find(o => (o.name ?? '').toLowerCase() === 'draw')

                if (gameType === 'moneyline') {
                  gameMarkets.push({
                    marketType: 'moneyline',
                    homePrice: home?.price ? decimalToAmerican(home.price) : null,
                    awayPrice: away?.price ? decimalToAmerican(away.price) : null,
                    drawPrice: draw?.price ? decimalToAmerican(draw.price) : null,
                    spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
                  })
                } else if (gameType === 'spread') {
                  gameMarkets.push({
                    marketType: 'spread',
                    homePrice: home?.price ? decimalToAmerican(home.price) : null,
                    awayPrice: away?.price ? decimalToAmerican(away.price) : null,
                    drawPrice: null,
                    spreadValue: home?.points != null ? Math.abs(home.points) : null,
                    totalValue: null, overPrice: null, underPrice: null,
                  })
                } else if (gameType === 'total') {
                  gameMarkets.push({
                    marketType: 'total',
                    homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
                    totalValue: over?.points ?? under?.points ?? null,
                    overPrice: over?.price ? decimalToAmerican(over.price) : null,
                    underPrice: under?.price ? decimalToAmerican(under.price) : null,
                  })
                }
                continue
              }

              // Player props
              if (!propSample && isPlayerClass) {
                propSample = {
                  eventClass: m.eventClass,
                  name: m.name,
                  outcomeCount: outcomes.length,
                  outcomes: outcomes.slice(0, 4).map(o => ({
                    name: o.name, side: o.side, points: o.points, price: o.price,
                  })),
                }
              }
              const propCategory = mapPropCategory(m.eventClass ?? '')
              if (!propCategory) {
                if (isPlayerClass) {
                  propDrops.unmappedCategory++
                  if (m.eventClass) unmappedClasses.add(m.eventClass)
                }
                continue
              }

              // PointsBet groups all players × lines under one market. Iterate
              // outcomes, parse (player, side) from the outcome name, and group
              // by (player, line) so over/under prices pair up.
              const groups = new Map<string, {
                player: string
                line: number
                over?: number
                under?: number
              }>()
              for (const o of outcomes) {
                const shape = parseOutcomeShape(o.name ?? '')
                if (!shape) {
                  propDrops.noPlayerName++
                  continue
                }
                const line = o.points
                if (line == null) {
                  propDrops.noLineValue++
                  continue
                }
                if (o.price == null) continue
                const key = `${shape.player}|${line}`
                const g = groups.get(key) ?? { player: shape.player, line }
                const american = decimalToAmerican(o.price)
                if (shape.side === 'over') g.over = american
                else g.under = american
                groups.set(key, g)
              }

              for (const g of groups.values()) {
                if (g.over == null && g.under == null) {
                  propDrops.noOverUnder++
                  continue
                }
                propDrops.kept++
                props.push({
                  propCategory,
                  playerName: g.player,
                  lineValue: g.line,
                  overPrice: g.over ?? null,
                  underPrice: g.under ?? null,
                  yesPrice: null, noPrice: null, isBinary: false,
                })
              }
            }

            // Dedup props across markets for this event. PB often exposes
            // the same (player, line) through BOTH a main "Over/Under" market
            // AND an "Alternate <stat>" market; if both pushed, the writer's
            // upsert kept whichever wrote last, sometimes overwriting a proper
            // two-sided row with a one-sided alt threshold. Prefer two-sided.
            const propByKey = new Map<string, NormalizedProp>()
            for (const p of props) {
              const k = `${p.propCategory}|${p.playerName}|${p.lineValue}`
              const existing = propByKey.get(k)
              if (!existing) { propByKey.set(k, p); continue }
              const existingBoth = existing.overPrice != null && existing.underPrice != null
              const newBoth = p.overPrice != null && p.underPrice != null
              if (newBoth && !existingBoth) propByKey.set(k, p)
            }
            const dedupedProps = [...propByKey.values()]

            if (gameMarkets.length > 0 || dedupedProps.length > 0) {
              scraped.push({ event, gameMarkets, props: dedupedProps })
            }
          }
        }
      }

      if (unmappedClasses.size > 0) {
        log.info('unmapped eventClasses (update PROP_CATEGORY_MAP)', {
          classes: [...unmappedClasses].slice(0, 30),
          total: unmappedClasses.size,
        })
      }

      log.info('prop parse counters', { ...propDrops, propSample })

      // Diagnostic summary
      const totalProps = scraped.reduce((s, r) => s + r.props.length, 0)
      const totalGameMkts = scraped.reduce((s, r) => s + r.gameMarkets.length, 0)
      const avgMarkets = scraped.length > 0
        ? scraped.reduce((s, r) => s + r.gameMarkets.length + r.props.length, 0) / scraped.length
        : 0
      log.info('scrape summary', {
        events: scraped.length,
        totalGameMkts,
        totalProps,
        avgMarketsPerEvent: +avgMarkets.toFixed(1),
      })

      return { events: scraped, errors }
    }, {
      extraHeaders: {
        'Referer': 'https://on.pointsbet.ca/',
        'Origin': 'https://on.pointsbet.ca',
      },
    })
  },
}
