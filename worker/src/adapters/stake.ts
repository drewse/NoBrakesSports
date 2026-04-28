/**
 * Stake.com — typed REST adapter via the SPA's GraphQL endpoint.
 *
 * Reconnaissance summary:
 *   - https://stake.com/_api/graphql is reachable from datacenter IPs
 *     ONCE Cloudflare cookies are present (cf_clearance + __cf_bm +
 *     _cfuvid). Without them, every path 403s.
 *   - Apollo server validates `operationName` against a fixed registry,
 *     so blind queries 400. The frontend ships full GraphQL documents.
 *   - The TournamentIndex query (this file's main entry) returns every
 *     fixture for a (sport, category, tournament) with one group's
 *     market attached. Calling 3× per tournament with group ∈
 *     {winner, Handicap, Total} gets us ML + spread + total in 9 calls
 *     per cycle.
 *
 * Auth strategy:
 *   - We rely on Playwright to settle CF cookies for us by loading
 *     stake.com/sports first. Once that completes, all subsequent
 *     POSTs reuse the page's context cookies — no manual cookie env
 *     management, no rotation work.
 *   - If CF refuses the Playwright session (datacenter IP flagged),
 *     fall back to PROXY_URL_US (PacketStream US). Mobile proxy is the
 *     last resort.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapedEvent, GameMarket } from '../lib/types.js'

interface TournamentTarget {
  sport: string         // GraphQL sport slug (basketball / baseball / ice-hockey)
  category: string      // GraphQL category slug (usa)
  tournament: string    // GraphQL tournament slug (nba / mlb / nhl)
  leagueSlug: string    // our canonical league slug (matches DB.leagues.slug)
  sportEnum: 'basketball' | 'baseball' | 'ice_hockey'
}

const TOURNAMENTS: TournamentTarget[] = [
  { sport: 'basketball', category: 'usa', tournament: 'nba', leagueSlug: 'nba', sportEnum: 'basketball' },
  { sport: 'baseball',   category: 'usa', tournament: 'mlb', leagueSlug: 'mlb', sportEnum: 'baseball' },
  { sport: 'ice-hockey', category: 'usa', tournament: 'nhl', leagueSlug: 'nhl', sportEnum: 'ice_hockey' },
]

// Group → canonical market_type the writer expects.
// The Stake frontend uses these group slugs verbatim; same string also
// keys their `allGroups` enum from the API.
const GROUPS: Array<{ group: string; marketType: 'moneyline' | 'spread' | 'total' }> = [
  { group: 'winner',   marketType: 'moneyline' },
  { group: 'Handicap', marketType: 'spread' },
  { group: 'Total',    marketType: 'total' },
]

// The full TournamentIndex GraphQL document captured from Stake's frontend.
// Apollo server matches on operationName + the document body, so this
// must be sent verbatim or the server returns "Unknown operation".
const TOURNAMENT_INDEX_QUERY = `query TournamentIndex($sport: String!, $category: String!, $tournament: String!, $group: String!, $limit: Int = 10) {
  slugTournament(sport: $sport, category: $category, tournament: $tournament) {
    id
    name
    slug
    activeFixtureCount: fixtureCount(type: active)
    liveFixtureCount: fixtureCount(type: live)
    popularFixtureCount: fixtureCount(type: popular)
    category {
      id
      name
      sport {
        id
        slug
        name
        templates(group: $group) {
          id
          name
          extId
        }
        allGroups {
          name
          translation
          rank
          id
        }
      }
    }
    fixtureList(type: active, limit: $limit) {
      ...FixturePreview
      ...UfcFrontRowSeat
      groups(groups: [$group], status: [active, suspended, deactivated]) {
        ...SportGroupTemplates
      }
    }
  }
}

fragment FixturePreview on SportFixture {
  id
  ...SportFixtureLiveStreamExists
  ...FixtureOptionsSameGameMultiButton_SportFixture
  status
  slug
  name
  provider
  marketCount(status: [active, suspended])
  extId
  liveWidgetUrl
  widgetUrl
  data {
    __typename
    ...SportFixtureDataMatch
    ...SportFixtureDataOutright
  }
  tournament {
    ...TournamentTreeNested
  }
  eventStatus {
    ...SportFixtureEventStatus
    ...EsportFixtureEventStatus
  }
}

fragment SportFixtureLiveStreamExists on SportFixture {
  id
  betradarStream { exists }
  imgArenaStream { exists }
  abiosStream { exists stream { startTime id } }
  geniussportsStream(deliveryType: hls) { exists }
  statsPerformStream(getData: false) { isAvailable geoBlocked }
  liveStream { data { isAvailable } }
}

fragment FixtureOptionsSameGameMultiButton_SportFixture on SportFixture {
  sgmAvailable: customBetAvailable
  swish: swishGame {
    sport: swishSport {
      sgmAvailable: customBetAvailable
      sgmLiveAvailable: liveCustomBetAvailable
    }
  }
}

fragment SportFixtureDataMatch on SportFixtureDataMatch {
  startTime
  competitors { ...SportFixtureCompetitor }
  teams { name qualifier }
  tvChannels { language name streamUrl }
  __typename
}

fragment SportFixtureCompetitor on SportFixtureCompetitor {
  name
  defaultName
  extId
  countryCode
  abbreviation
  iconPath
}

fragment SportFixtureDataOutright on SportFixtureDataOutright {
  name
  startTime
  endTime
  __typename
}

fragment TournamentTreeNested on SportTournament {
  id
  name
  slug
  category {
    ...CategoryTreeNested
    cashoutEnabled
  }
}

fragment CategoryTreeNested on SportCategory {
  id
  name
  slug
  sport { id name slug }
}

fragment SportFixtureEventStatus on SportFixtureEventStatusData {
  __typename
  homeScore
  awayScore
  matchStatus
  clock { matchTime remainingTime }
  periodScores { homeScore awayScore matchStatus }
  currentTeamServing
  homeGameScore
  awayGameScore
  statistic {
    yellowCards { away home }
    redCards { away home }
    corners { home away }
  }
}

fragment EsportFixtureEventStatus on EsportFixtureEventStatus {
  matchStatus
  homeScore
  awayScore
  scoreboard {
    homeGold awayGold homeGoals awayGoals homeKills awayKills gameTime
    homeDestroyedTowers awayDestroyedTurrets currentRound currentCtTeam
    currentDefTeam time awayWonRounds homeWonRounds remainingGameTime
  }
  periodScores {
    type number awayGoals awayKills awayScore homeGoals homeKills homeScore
    awayWonRounds homeWonRounds matchStatus
  }
  __typename
}

fragment UfcFrontRowSeat on SportFixture {
  frontRowSeatFight { fightId }
  tournament { frontRowSeatEvent { identifier } }
}

fragment SportGroupTemplates on SportGroup {
  ...SportGroup
  templates(limit: 10, includeEmpty: true) {
    ...SportGroupTemplate
    markets(limit: 1) {
      ...SportMarket
      outcomes { ...SportMarketOutcome }
    }
  }
}

fragment SportGroup on SportGroup { name translation rank }
fragment SportGroupTemplate on SportGroupTemplate { extId rank name }
fragment SportMarket on SportMarket {
  id name status extId specifiers customBetAvailable provider
}
fragment SportMarketOutcome on SportMarketOutcome {
  __typename id active odds name customBetAvailable
}`

const HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/json',
  'origin': 'https://stake.com',
  'referer': 'https://stake.com/sports/basketball/usa/nba',
  'x-language': 'en',
  'x-operation-name': 'TournamentIndex',
  'x-operation-type': 'query',
}

function decimalToAmerican(dec: number): number | null {
  if (!isFinite(dec) || dec <= 1) return null
  if (dec >= 2) return Math.round((dec - 1) * 100)
  return Math.round(-100 / (dec - 1))
}

function parseStartTime(raw: string | null | undefined): string {
  if (!raw) return ''
  const d = new Date(raw)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

interface StakeOutcome { id: string; active: boolean; odds: number; name: string }
interface StakeMarket { id: string; name: string; status: string; outcomes?: StakeOutcome[] }
interface StakeFixture {
  id: string
  status: string
  name: string
  data?: {
    __typename?: string
    startTime?: string
    competitors?: Array<{ name: string; abbreviation?: string; defaultName?: string }>
    teams?: Array<{ name: string; qualifier: 'home' | 'away' }>
  }
  groups?: Array<{
    name: string
    templates?: Array<{ name: string; markets?: StakeMarket[] }>
  }>
}

/**
 * Parse a Handicap outcome name like "Oklahoma City Thunder (-8.5)" or
 * "Phoenix Suns (+8.5)" into { team, line }. Returns null if the format
 * doesn't match — keeps the parser robust to Stake adding new shapes.
 */
function parseSpreadOutcome(name: string): { team: string; line: number } | null {
  const m = name.match(/^(.+?)\s*\(([+\-]?\d+(?:\.\d+)?)\)\s*$/)
  if (!m) return null
  const line = parseFloat(m[2])
  if (!isFinite(line)) return null
  return { team: m[1].trim(), line }
}

/** Parse "Over 259.5" / "Under 259.5" into { side, line }. */
function parseTotalOutcome(name: string): { side: 'over' | 'under'; line: number } | null {
  const m = name.match(/^(over|under)\s+(\d+(?:\.\d+)?)\s*$/i)
  if (!m) return null
  const line = parseFloat(m[2])
  if (!isFinite(line)) return null
  return { side: m[1].toLowerCase() as 'over' | 'under', line }
}

/** Build (or return) the in-progress ScrapedEvent for this fixture. */
function ensureEvent(
  byId: Map<string, ScrapedEvent>,
  fx: StakeFixture,
  target: TournamentTarget,
): ScrapedEvent | null {
  if (byId.has(fx.id)) return byId.get(fx.id)!
  const teams = fx.data?.teams ?? []
  const home = teams.find(t => t.qualifier === 'home')?.name
  const away = teams.find(t => t.qualifier === 'away')?.name
  const startTime = parseStartTime(fx.data?.startTime)
  if (!home || !away || !startTime) return null
  const ev: ScrapedEvent = {
    event: {
      externalId: fx.id,
      homeTeam: home,
      awayTeam: away,
      startTime,
      leagueSlug: target.leagueSlug,
      sport: target.sportEnum,
    },
    gameMarkets: [],
    props: [],
  }
  byId.set(fx.id, ev)
  return ev
}

/** Walk a fixture's groups[].templates[].markets[] and emit one
 *  GameMarket per fixture per group. Stake ships only the requested
 *  group's data per call, so each call adds exactly one market type. */
function applyGroupMarkets(
  ev: ScrapedEvent,
  fx: StakeFixture,
  marketType: 'moneyline' | 'spread' | 'total',
  homeName: string,
  awayName: string,
): void {
  const groups = fx.groups ?? []
  if (groups.length === 0) return
  const market = groups[0].templates?.[0]?.markets?.[0]
  if (!market || market.status !== 'active') return
  const outs = market.outcomes ?? []
  if (outs.length < 2) return

  if (marketType === 'moneyline') {
    let homePrice: number | null = null
    let awayPrice: number | null = null
    let drawPrice: number | null = null
    for (const o of outs) {
      if (!o.active) continue
      const american = decimalToAmerican(o.odds)
      if (american == null) continue
      const n = (o.name ?? '').trim()
      if (n.toLowerCase() === 'draw') { drawPrice = american; continue }
      if (n === homeName) homePrice = american
      else if (n === awayName) awayPrice = american
    }
    if (homePrice != null || awayPrice != null) {
      ev.gameMarkets.push({
        marketType: 'moneyline',
        homePrice, awayPrice, drawPrice,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
      })
    }
    return
  }

  if (marketType === 'spread') {
    let homePrice: number | null = null
    let awayPrice: number | null = null
    let homeLine: number | null = null
    for (const o of outs) {
      if (!o.active) continue
      const american = decimalToAmerican(o.odds)
      if (american == null) continue
      const parsed = parseSpreadOutcome(o.name)
      if (!parsed) continue
      if (parsed.team === homeName) { homePrice = american; homeLine = parsed.line }
      else if (parsed.team === awayName) { awayPrice = american }
    }
    if (homePrice != null || awayPrice != null) {
      ev.gameMarkets.push({
        marketType: 'spread',
        homePrice, awayPrice, drawPrice: null,
        spreadValue: homeLine,
        totalValue: null, overPrice: null, underPrice: null,
      })
    }
    return
  }

  if (marketType === 'total') {
    let overPrice: number | null = null
    let underPrice: number | null = null
    let totalLine: number | null = null
    for (const o of outs) {
      if (!o.active) continue
      const american = decimalToAmerican(o.odds)
      if (american == null) continue
      const parsed = parseTotalOutcome(o.name)
      if (!parsed) continue
      if (parsed.side === 'over')  { overPrice = american;  totalLine = parsed.line }
      else                          { underPrice = american; if (totalLine == null) totalLine = parsed.line }
    }
    if (overPrice != null || underPrice != null) {
      ev.gameMarkets.push({
        marketType: 'total',
        homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
        totalValue: totalLine,
        overPrice, underPrice,
      })
    }
  }
}

export const stakeAdapter: BookAdapter = {
  slug: 'stake',
  name: 'Stake.com',
  needsBrowser: true,
  pollIntervalSec: 600,  // 10 min — direct GraphQL is cheap

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const eventsByFixtureId = new Map<string, ScrapedEvent>()

      // 1. Land on the sports root so Cloudflare's JS challenge can run
      //    and set cf_clearance / __cf_bm / _cfuvid into the context.
      try {
        const seed = await page.goto('https://stake.com/sports', { waitUntil: 'domcontentloaded', timeout: 45_000 })
        if (!seed || seed.status() === 403) {
          errors.push(`seed 403 — CF blocked the Chromium session (Railway IP may be flagged)`)
          return { events: [], errors }
        }
      } catch (e: any) {
        errors.push(`seed nav: ${e?.message ?? String(e)}`)
        return { events: [], errors }
      }
      // Give Apollo's bootstrap requests a beat to settle.
      await page.waitForTimeout(2_500)

      const reqCtx = page.context().request

      // 2. For each (tournament, group), POST TournamentIndex and
      //    accumulate fixtures + markets into eventsByFixtureId.
      for (const t of TOURNAMENTS) {
        if (signal.aborted) break
        for (const { group, marketType } of GROUPS) {
          if (signal.aborted) break
          try {
            const resp = await reqCtx.post('https://stake.com/_api/graphql', {
              headers: {
                ...HEADERS,
                referer: `https://stake.com/sports/${t.sport}/${t.category}/${t.tournament}`,
              },
              data: {
                operationName: 'TournamentIndex',
                query: TOURNAMENT_INDEX_QUERY,
                variables: {
                  sport: t.sport,
                  category: t.category,
                  tournament: t.tournament,
                  group,
                  limit: 50,
                },
              },
              timeout: 20_000,
            })
            if (resp.status() !== 200) {
              errors.push(`${t.leagueSlug}/${group} HTTP ${resp.status()}`)
              continue
            }
            const json = await resp.json() as any
            if (json?.errors) {
              errors.push(`${t.leagueSlug}/${group} gql: ${JSON.stringify(json.errors).slice(0, 200)}`)
              continue
            }
            const fixtures: StakeFixture[] = json?.data?.slugTournament?.fixtureList ?? []
            for (const fx of fixtures) {
              // Only "active" (= upcoming, accepting bets). Skip "live"
              // (in-progress) and any other status — we don't track
              // live odds anywhere downstream.
              if (fx.status !== 'active') continue
              const ev = ensureEvent(eventsByFixtureId, fx, t)
              if (!ev) continue
              applyGroupMarkets(ev, fx, marketType, ev.event.homeTeam, ev.event.awayTeam)
            }
          } catch (e: any) {
            errors.push(`${t.leagueSlug}/${group} threw: ${e?.message ?? String(e)}`)
          }
        }
      }

      const events = [...eventsByFixtureId.values()].filter(e => e.gameMarkets.length > 0)
      log.info('stake scrape summary', {
        events: events.length,
        gameMarkets: events.reduce((s, e) => s + e.gameMarkets.length, 0),
        errors: errors.length,
      })
      return { events, errors }
    }, { useProxy: false })
  },
}
