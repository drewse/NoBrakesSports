/**
 * Shared Entain CDS adapter logic for BetMGM, bwin, partypoker.
 *
 * All three use the same API structure, access ID, and fixture IDs.
 * Only the domain and Referer/Origin headers differ.
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'

// Each Entain operator has its own access ID (they do NOT share one)
const ENTAIN_ACCESS_IDS: Record<string, string> = {
  'www.on.betmgm.ca':       'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy',
  'www.on.bwin.ca':         'ODQwNmFkZWItY2NlNS00OGE3LWI4NzktOGE4Njc0NDM5Y2U5',
  'www.on.partysports.ca':  'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy', // TODO: get real partypoker access ID
}

// Fallback for unknown domains
const DEFAULT_ACCESS_ID = 'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy'

export interface EntainConfig {
  domain: string  // e.g. 'www.on.betmgm.ca'
  slug: string    // e.g. 'betmgm'
}

export interface EntainEvent {
  fixtureId: string
  homeName: string
  awayName: string
  startTime: string
  leagueSlug: string
}

export interface EntainGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface EntainResult {
  event: EntainEvent
  gameMarkets: EntainGameMarket[]
  props: NormalizedProp[]
}

export const ENTAIN_LEAGUES: { sportId: number; competitionId: number; leagueSlug: string; name: string }[] = [
  // Basketball
  { sportId: 7,  competitionId: 6004,   leagueSlug: 'nba',            name: 'NBA' },
  // Baseball
  { sportId: 23, competitionId: 75,     leagueSlug: 'mlb',            name: 'MLB' },
  // Hockey
  { sportId: 12, competitionId: 34,     leagueSlug: 'nhl',            name: 'NHL' },
  // Soccer
  { sportId: 4,  competitionId: 101409, leagueSlug: 'epl',            name: 'EPL' },
  { sportId: 4,  competitionId: 102829, leagueSlug: 'laliga',         name: 'La Liga' },
  { sportId: 4,  competitionId: 102842, leagueSlug: 'bundesliga',     name: 'Bundesliga' },
  { sportId: 4,  competitionId: 102846, leagueSlug: 'seria_a',        name: 'Serie A' },
  { sportId: 4,  competitionId: 102843, leagueSlug: 'ligue_one',      name: 'Ligue 1' },
  { sportId: 4,  competitionId: 104417, leagueSlug: 'mls',            name: 'MLS' },
  { sportId: 4,  competitionId: 102375, leagueSlug: 'liga_mx',        name: 'Liga MX' },
]

const PROP_MAP: Record<string, string> = {
  // Basketball — simple stats
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  'three pointers': 'player_threes',
  '3-point field goals': 'player_threes',
  'blocks': 'player_blocks',
  'steals': 'player_steals',
  'turnovers': 'player_turnovers',
  // Basketball — combos
  'total points, rebounds and assists': 'player_pts_reb_ast',
  'total points and rebounds': 'player_pts_reb',
  'total points and assists': 'player_pts_ast',
  'total assists and rebounds': 'player_ast_reb',
  'pts + rebs + asts': 'player_pts_reb_ast',
  'pts + rebs': 'player_pts_reb',
  'pts + asts': 'player_pts_ast',
  'rebs + asts': 'player_ast_reb',
  // Baseball
  'hits': 'player_hits',
  'hits allowed': 'player_hits_allowed',
  'home runs': 'player_home_runs',
  'rbis': 'player_rbis',
  'runs batted in': 'player_rbis',
  'strikeouts': 'player_strikeouts_p',
  'pitcher strikeouts': 'player_strikeouts_p',
  'earned runs': 'player_earned_runs',
  'earned runs allowed': 'player_earned_runs',
  'total bases': 'player_total_bases',
  'runs': 'player_runs',
  'runs scored': 'player_runs',
  'stolen bases': 'player_stolen_bases',
  'walks': 'player_walks',
  'outs': 'pitcher_outs',
  'outs recorded': 'pitcher_outs',
  // Hockey
  'goals': 'player_goals',
  'goals scored': 'player_goals',
  'hockey assists': 'player_hockey_assists',
  'hockey points': 'player_hockey_points',
  'shots on goal': 'player_shots_on_goal',
  'saves': 'player_saves',
  'power play points': 'player_power_play_pts',
  // Soccer
  'shots on target': 'player_shots_target',
}

function parsePlayerName(marketName: string): { playerName: string; statType: string } | null {
  // "Other" format: "De'Aaron Fox - Points"
  const dashMatch = marketName.match(/^(.+?)\s*-\s*(.+)$/)
  if (dashMatch) return { playerName: dashMatch[1].trim(), statType: dashMatch[2].trim().toLowerCase() }
  // "Player specials" format: "Victor Wembanyama (SAS) : Blocks"
  // Also handles: "Victor Wembanyama (SAS): Total points and rebounds"
  const colonMatch = marketName.match(/^(.+?)\s*\([A-Za-z]+\)\s*:?\s*(.+)$/)
  if (colonMatch) return { playerName: colonMatch[1].trim(), statType: colonMatch[2].trim().toLowerCase() }
  return null
}

function makeHeaders(config: EntainConfig): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': `https://${config.domain}/`,
    'Origin': `https://${config.domain}`,
  }
}

export async function scrapeEntain(config: EntainConfig, signal?: AbortSignal): Promise<EntainResult[]> {
  const BASE = `https://${config.domain}/cds-api/bettingoffer`
  const accessId = ENTAIN_ACCESS_IDS[config.domain] ?? DEFAULT_ACCESS_ID
  const COMMON = `x-bwin-accessid=${accessId}&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario`
  const HEADERS = makeHeaders(config)
  const results: EntainResult[] = []

  // Fetch fixture lists in parallel.
  //
  // Using state=Upcoming (was: state=Latest). Verified live against BetMGM:
  //   state=Latest    → 14 NBA fixtures, MISSING Tor/Cle + Phi/Bos, padded
  //                     with 9 unparseable June "? vs ?" futures rows.
  //   state=Upcoming  →  7 NBA fixtures, all the real upcoming games with
  //                     proper team names (incl. Tor/Cle + Phi/Bos), no
  //                     futures noise.
  // Same observation applies to bwin / partypoker since they share this
  // scrapeEntain code path.
  const leagueFixtures = await Promise.all(
    ENTAIN_LEAGUES.map(async (league) => {
      try {
        const resp = await fetch(`${BASE}/fixtures?${COMMON}&state=Upcoming&sportIds=${league.sportId}&take=200`, {
          headers: HEADERS, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
        })
        if (!resp.ok) return { league, fixtures: [] }
        const data = await resp.json()
        const fixtures = (data.fixtures ?? []).filter((f: any) =>
          f.competition?.id === league.competitionId && !f.isOutright && !f.isLive
        )
        return { league, fixtures }
      } catch {
        return { league, fixtures: [] }
      }
    })
  )

  // Fetch fixture details with concurrency limit
  const MAX_CONCURRENT = 5
  for (const { league, fixtures } of leagueFixtures) {
    for (let i = 0; i < fixtures.length; i += MAX_CONCURRENT) {
      if (signal?.aborted) break
      const batch = fixtures.slice(i, i + MAX_CONCURRENT)
      const batchResults = await Promise.all(
        batch.map(async (fixture: any) => {
          try {
            const resp = await fetch(
              `${BASE}/fixture-view?${COMMON}&offerMapping=All&fixtureIds=${fixture.id}&state=Latest&firstMarketGroupOnly=false`,
              { headers: HEADERS, signal: AbortSignal.timeout(10000) }
            )
            if (!resp.ok) return null
            const data = await resp.json()
            return parseFixture(data, league.leagueSlug)
          } catch {
            return null
          }
        })
      )
      for (const r of batchResults) {
        if (r) results.push(r)
      }
    }
  }

  return results
}

function parseFixture(data: any, leagueSlug: string): EntainResult | null {
  const fixture = data?.fixture
  if (!fixture) return null

  const participants = fixture.participants ?? []
  const homeTeam = participants.find((p: any) => p.properties?.type === 'HomeTeam')
  const awayTeam = participants.find((p: any) => p.properties?.type === 'AwayTeam')
  const homeName = homeTeam?.name?.value ?? participants[1]?.name?.value ?? ''
  const awayName = awayTeam?.name?.value ?? participants[0]?.name?.value ?? ''
  if (!homeName || !awayName) return null

  const event: EntainEvent = {
    fixtureId: String(fixture.id), homeName, awayName,
    startTime: fixture.startDate ?? '', leagueSlug,
  }

  const optionMarkets = fixture.optionMarkets ?? []
  const gameMarkets: EntainGameMarket[] = []
  const props: NormalizedProp[] = []

  for (const market of optionMarkets) {
    if (market.status !== 'Visible') continue
    const catName = market.templateCategory?.name?.value ?? market.name?.value ?? ''
    const options = market.options ?? []

    // ── Game-level markets ──
    if (catName === 'Moneyline' && market.isMain !== false) {
      const homeOpt = options.find((o: any) => o.sourceName?.value === '2' || o.name?.value?.includes(homeName.split(' ').pop()))
      const awayOpt = options.find((o: any) => o.sourceName?.value === '1' || o.name?.value?.includes(awayName.split(' ').pop()))
      const drawOpt = options.find((o: any) => o.name?.value === 'Draw')
      gameMarkets.push({
        marketType: 'moneyline',
        homePrice: homeOpt?.price?.americanOdds ?? null,
        awayPrice: awayOpt?.price?.americanOdds ?? null,
        drawPrice: drawOpt?.price?.americanOdds ?? null,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
      })
    } else if (catName === 'Spread' && market.isMain !== false && !gameMarkets.some(gm => gm.marketType === 'spread')) {
      if (options.length >= 2) {
        const opt1 = options[0], opt2 = options[1]
        const homeOpt = opt1.name?.value?.includes(homeName.split(' ').pop()) ? opt1 : opt2
        const awayOpt = homeOpt === opt1 ? opt2 : opt1
        // Signed spread from home team's perspective (home -1.5 vs home +1.5).
        const spreadVal = parseFloat(homeOpt?.attr ?? '0')
        gameMarkets.push({
          marketType: 'spread',
          homePrice: homeOpt?.price?.americanOdds ?? null,
          awayPrice: awayOpt?.price?.americanOdds ?? null,
          drawPrice: null, spreadValue: spreadVal,
          totalValue: null, overPrice: null, underPrice: null,
        })
      }
    } else if ((catName === 'Total Hits' || catName === 'Total Game Hits' || (market.name?.value ?? '').toLowerCase().startsWith('total hits')) && options.length === 2) {
      // Game-level Total Hits — store as prop with player='Game'
      const overOpt = options.find((o: any) => o.totalsPrefix === 'Over' || (o.name?.value ?? '').toLowerCase().startsWith('over'))
      const underOpt = options.find((o: any) => o.totalsPrefix === 'Under' || (o.name?.value ?? '').toLowerCase().startsWith('under'))
      const totalVal = parseFloat(market.attr ?? '0')
      if (totalVal > 0 && (overOpt || underOpt)) {
        props.push({
          propCategory: 'game_total_hits',
          playerName: 'Game',
          lineValue: totalVal,
          overPrice: overOpt?.price?.americanOdds ?? null,
          underPrice: underOpt?.price?.americanOdds ?? null,
          yesPrice: null, noPrice: null, isBinary: false,
        })
      }
    } else if (catName === 'Totals' && market.isMain !== false && !gameMarkets.some(gm => gm.marketType === 'total')) {
      // market.isMain filters out alt totals — without it, if the Entain feed
      // orders an alt (e.g. Under 15.5 at +1850) before the main line, the
      // guard below would lock in the alt and block the real main from ever
      // writing, producing nonsense +EV/arb against other books' main totals.
      const overOpt = options.find((o: any) => o.totalsPrefix === 'Over')
      const underOpt = options.find((o: any) => o.totalsPrefix === 'Under')
      const totalVal = parseFloat(market.attr ?? '0')
      if (totalVal > 0) {
        gameMarkets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: totalVal,
          overPrice: overOpt?.price?.americanOdds ?? null,
          underPrice: underOpt?.price?.americanOdds ?? null,
        })
      }
    }

    // ── Player props ──
    if (options.length === 2 && market.attr != null) {
      const marketName = market.name?.value ?? ''
      const parsed = parsePlayerName(marketName)

      // Detect combo stat from the market name itself. Entain sometimes
      // files combo markets ("Rebounds + Assists - LeBron James",
      // "Jayson Tatum - Points + Rebounds + Assists") inside a single-stat
      // category tab, so relying on catName alone mis-classifies them as
      // the plain single stat. Check the market name for " + " combos first.
      const comboFromName = (name: string): string | null => {
        const lower = name.toLowerCase()
        if (!lower.includes('+')) return null
        const hasPts = /\bpoints?\b|\bpts\b/.test(lower)
        const hasReb = /\brebounds?\b|\brebs?\b/.test(lower)
        const hasAst = /\bassists?\b|\basts?\b/.test(lower)
        if (hasPts && hasReb && hasAst) return 'player_pts_reb_ast'
        if (hasPts && hasReb) return 'player_pts_reb'
        if (hasPts && hasAst) return 'player_pts_ast'
        if (hasReb && hasAst) return 'player_ast_reb'
        const hasStl = /\bsteals?\b/.test(lower)
        const hasBlk = /\bblocks?\b/.test(lower)
        if (hasStl && hasBlk) return 'player_steals_blocks'
        return null
      }

      // Extract player name from a market name that's "Stat Combo - Player"
      // or "Player - Stat Combo" by picking the side without stat keywords.
      const extractPlayerFromCombo = (name: string): string => {
        const dashIdx = name.lastIndexOf(' - ')
        const candidates = dashIdx > 0 ? [name.slice(0, dashIdx), name.slice(dashIdx + 3)] : [name]
        const isStatSide = (s: string) => /\+|points?|rebounds?|assists?|steals?|blocks?|pts|rebs|asts/i.test(s)
        const playerSide = candidates.find(s => !isStatSide(s)) ?? candidates[candidates.length - 1]
        return playerSide.replace(/\s*\([A-Z]{2,5}\)\s*$/, '').trim()
      }

      let category: string | undefined
      let playerName: string | undefined

      // 1) Combo-name detection overrides everything — fixes single-stat
      //    categories that contain combo markets.
      const comboCat = comboFromName(marketName)
      if (comboCat) {
        category = comboCat
        playerName = extractPlayerFromCombo(marketName)
      } else if (parsed) {
        category = PROP_MAP[parsed.statType]
        playerName = parsed.playerName
      } else if (catName) {
        // Try to extract stat from category name: "Player Steals" → "steals"
        const catLower = catName.toLowerCase()
          .replace(/^player\s+/, '')  // "Player Steals" → "steals"
          .replace(/^total\s+/, '')   // "Total Steals" → "steals"
          .trim()
        category = PROP_MAP[catLower]
        // Market name is the player name (possibly with team abbreviation)
        playerName = marketName
          .replace(/\s*\([A-Z]{2,5}\)\s*$/, '')  // strip "(SAS)"
          .trim()
      }
      if (category && playerName) {
          const lineValue = parseFloat(market.attr)
          if (!isNaN(lineValue)) {
            let overPrice: number | null = null
            let underPrice: number | null = null
            for (const o of options) {
              const name = (o.name?.value ?? '').toLowerCase()
              if (o.totalsPrefix === 'Over' || name.startsWith('over')) overPrice = o.price?.americanOdds ?? null
              else if (o.totalsPrefix === 'Under' || name.startsWith('under')) underPrice = o.price?.americanOdds ?? null
            }
            // Fallback: Entain consistently puts Over first, Under second
            // for O/U player props (steals, blocks, etc.) where options lack
            // totalsPrefix and names don't start with "over"/"under".
            if (overPrice == null && underPrice == null && options.length === 2) {
              overPrice = options[0]?.price?.americanOdds ?? null
              underPrice = options[1]?.price?.americanOdds ?? null
            }
            if (overPrice != null || underPrice != null) {
              props.push({
                propCategory: category,
                playerName: normalizePlayerName(playerName),
                lineValue, overPrice, underPrice,
                yesPrice: null, noPrice: null, isBinary: false,
              })
            }
          }
      }
    }
  }

  if (gameMarkets.length === 0 && props.length === 0) return null
  return { event, gameMarkets, props }
}
