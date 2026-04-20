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

const PROP_CATEGORY_MAP: Record<string, string> = {
  // Basketball
  'player points':              'player_points',
  'player rebounds':            'player_rebounds',
  'player assists':             'player_assists',
  'player threes':              'player_threes',
  'player three pointers made': 'player_threes',
  'player steals':              'player_steals',
  'player blocks':              'player_blocks',
  'player turnovers':           'player_turnovers',
  'player points + rebounds + assists': 'player_pts_reb_ast',
  'player points + rebounds':   'player_pts_reb',
  'player points + assists':    'player_pts_ast',
  'player rebounds + assists':  'player_ast_reb',
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
  'player goals':               'player_goals',
  'player shots on goal':       'player_shots_on_goal',
  'player saves':               'player_saves',
  'skater points':              'player_hockey_points',
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
          // Try the three URL shapes PointsBet uses; first one that works wins.
          const detailCandidates = (key: string | number) => [
            `${BASE_V3}/events/${key}`,
            `${BASE_V3}/events/${key}/markets`,
            `https://api.on.pointsbet.com/api/v2/events/${key}`,
          ]

          const enriched = await Promise.all(events.map(async (ev: PBEvent) => {
            if (ev.isLive || !ev.homeTeam || !ev.awayTeam) return ev
            for (const url of detailCandidates(ev.key)) {
              try {
                const detail = await page.evaluate(async (u: string) => {
                  const r = await fetch(u, { headers: { Accept: 'application/json' } })
                  return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null }
                }, url)
                if (detail.ok && detail.body) {
                  const mkts = (detail.body as any).specialFixedOddsMarkets
                    ?? (detail.body as any).markets
                    ?? (detail.body as any).event?.specialFixedOddsMarkets
                  if (Array.isArray(mkts) && mkts.length > (ev.specialFixedOddsMarkets?.length ?? 0)) {
                    ev.specialFixedOddsMarkets = mkts
                    break
                  }
                }
              } catch { /* try next url */ }
            }
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
              if (outcomes.length === 0) continue

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
              if (outcomes.length !== 2) continue
              const propCategory = mapPropCategory(m.eventClass ?? '')
              if (!propCategory) {
                // Track for diagnostic logging below
                if (m.eventClass && m.eventClass.toLowerCase().includes('player')) {
                  unmappedClasses.add(m.eventClass)
                }
                continue
              }
              const overOut = outcomes.find(o =>
                (o.name ?? '').toLowerCase().startsWith('over') || (o.side ?? '').toLowerCase() === 'over'
              )
              const underOut = outcomes.find(o =>
                (o.name ?? '').toLowerCase().startsWith('under') || (o.side ?? '').toLowerCase() === 'under'
              )
              if (!overOut && !underOut) continue

              const playerName = parsePlayerName(m.name ?? '')
              if (!playerName) continue
              const lineValue = overOut?.points ?? underOut?.points ?? null
              if (lineValue == null) continue

              props.push({
                propCategory,
                playerName,
                lineValue,
                overPrice: overOut?.price ? decimalToAmerican(overOut.price) : null,
                underPrice: underOut?.price ? decimalToAmerican(underOut.price) : null,
                yesPrice: null, noPrice: null, isBinary: false,
              })
            }

            if (gameMarkets.length > 0 || props.length > 0) {
              scraped.push({ event, gameMarkets, props })
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
