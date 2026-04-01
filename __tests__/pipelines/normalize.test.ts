import { describe, it, expect } from 'vitest'
import {
  americanToImplied,
  impliedToAmerican,
  decimalToAmerican,
  detectMarketShape,
  isPregame,
  normalizeEvent,
  normalizeOutcome,
  normalizeMarket,
  computeOverround,
  looksLikeThreeWayOdds,
} from '@/lib/pipelines/normalize'

describe('americanToImplied', () => {
  it('converts favourite correctly', () => {
    expect(americanToImplied(-110)).toBeCloseTo(0.5238, 3)
  })

  it('converts underdog correctly', () => {
    expect(americanToImplied(150)).toBeCloseTo(0.4000, 3)
  })

  it('even money is 0.5', () => {
    expect(americanToImplied(100)).toBeCloseTo(0.5, 3)
    expect(americanToImplied(-100)).toBeCloseTo(0.5, 3)
  })

  it('heavy favourite approaches 1', () => {
    const p = americanToImplied(-1000)
    expect(p).toBeGreaterThan(0.9)
    expect(p).toBeLessThan(1)
  })

  it('heavy underdog approaches 0', () => {
    const p = americanToImplied(5000)
    expect(p).toBeLessThan(0.05)
    expect(p).toBeGreaterThan(0)
  })
})

describe('impliedToAmerican', () => {
  it('converts favourite probability', () => {
    expect(impliedToAmerican(0.5238)).toBeCloseTo(-110, 0)
  })

  it('converts underdog probability', () => {
    expect(impliedToAmerican(0.4)).toBeCloseTo(150, 0)
  })

  it('throws on out-of-range probability', () => {
    expect(() => impliedToAmerican(0)).toThrow(RangeError)
    expect(() => impliedToAmerican(1)).toThrow(RangeError)
    expect(() => impliedToAmerican(-0.1)).toThrow(RangeError)
  })
})

describe('decimalToAmerican', () => {
  it('converts decimal >= 2 (underdog)', () => {
    expect(decimalToAmerican(2.5)).toBe(150)
  })

  it('converts decimal < 2 (favourite)', () => {
    expect(decimalToAmerican(1.909)).toBeCloseTo(-110, 0)
  })

  it('throws for decimal <= 1', () => {
    expect(() => decimalToAmerican(1)).toThrow(RangeError)
    expect(() => decimalToAmerican(0.5)).toThrow(RangeError)
  })
})

describe('detectMarketShape', () => {
  it('returns 3way for soccer moneylines', () => {
    expect(detectMarketShape('epl', 'moneyline')).toBe('3way')
    expect(detectMarketShape('mls', 'moneyline')).toBe('3way')
    expect(detectMarketShape('bundesliga', 'moneyline')).toBe('3way')
  })

  it('returns 2way for soccer spread / total', () => {
    expect(detectMarketShape('epl', 'spread')).toBe('2way')
    expect(detectMarketShape('epl', 'total')).toBe('2way')
  })

  it('returns 2way for non-soccer leagues', () => {
    expect(detectMarketShape('nba', 'moneyline')).toBe('2way')
    expect(detectMarketShape('nhl', 'moneyline')).toBe('2way')
    expect(detectMarketShape('nfl', 'moneyline')).toBe('2way')
  })

  it('returns 2way when league is null', () => {
    expect(detectMarketShape(null, 'moneyline')).toBe('2way')
  })
})

describe('isPregame', () => {
  it('returns true for future events', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect(isPregame(future)).toBe(true)
  })

  it('returns false for old events', () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(isPregame(past)).toBe(false)
  })

  it('returns true within the grace window', () => {
    const justStarted = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(isPregame(justStarted, 15 * 60 * 1000)).toBe(true)
  })

  it('returns false past the grace window', () => {
    const longAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    expect(isPregame(longAgo, 15 * 60 * 1000)).toBe(false)
  })
})

describe('normalizeEvent', () => {
  const raw = {
    externalId: 'ext-001',
    homeTeam: '  Toronto Raptors ',
    awayTeam: 'Golden State Warriors',
    startTime: '2026-04-10T20:00:00Z',
    leagueSlug: 'NBA',
    sourceSlug: 'fanduel',
  }

  it('builds title as Home vs Away', () => {
    const ev = normalizeEvent(raw)
    expect(ev.title).toBe('Toronto Raptors vs Golden State Warriors')
  })

  it('trims team names', () => {
    const ev = normalizeEvent(raw)
    expect(ev.homeTeam).toBe('Toronto Raptors')
  })

  it('lowercases leagueSlug', () => {
    const ev = normalizeEvent(raw)
    expect(ev.leagueSlug).toBe('nba')
  })

  it('defaults status to scheduled', () => {
    const ev = normalizeEvent(raw)
    expect(ev.status).toBe('scheduled')
  })

  it('maps status variants', () => {
    expect(normalizeEvent({ ...raw, status: 'finished' }).status).toBe('final')
    expect(normalizeEvent({ ...raw, status: 'inprogress' }).status).toBe('live')
    expect(normalizeEvent({ ...raw, status: 'postponed' }).status).toBe('cancelled')
  })
})

describe('normalizeOutcome', () => {
  it('maps side variants correctly', () => {
    expect(normalizeOutcome({ side: 'W1', label: 'Home', price: -110 }).side).toBe('home')
    expect(normalizeOutcome({ side: 'W2', label: 'Away', price: 110 }).side).toBe('away')
    expect(normalizeOutcome({ side: 'X', label: 'Draw', price: 280 }).side).toBe('draw')
    expect(normalizeOutcome({ side: 'O', label: 'Over', price: -110 }).side).toBe('over')
    expect(normalizeOutcome({ side: 'U', label: 'Under', price: -110 }).side).toBe('under')
  })

  it('computes impliedProb from American price', () => {
    const outcome = normalizeOutcome({ side: 'home', label: 'Home', price: -110 })
    expect(outcome.impliedProb).toBeCloseTo(0.5238, 3)
  })

  it('trims labels', () => {
    const outcome = normalizeOutcome({ side: 'home', label: '  Home  ', price: -110 })
    expect(outcome.label).toBe('Home')
  })
})

describe('normalizeMarket', () => {
  const rawMarket = {
    eventId: 'ev-001',
    marketType: 'h2h',
    leagueSlug: 'nba',
    outcomes: [
      { side: 'home', label: 'Lakers', price: -150 },
      { side: 'away', label: 'Celtics', price: 130 },
    ],
    sourceSlug: 'draftkings',
  }

  it('normalizes marketType h2h to moneyline', () => {
    expect(normalizeMarket(rawMarket).marketType).toBe('moneyline')
  })

  it('detects 2way shape for NBA', () => {
    expect(normalizeMarket(rawMarket).shape).toBe('2way')
  })

  it('detects 3way shape for soccer', () => {
    const market = normalizeMarket({ ...rawMarket, leagueSlug: 'epl', marketType: 'moneyline' })
    expect(market.shape).toBe('3way')
  })

  it('normalizes all outcomes', () => {
    const market = normalizeMarket(rawMarket)
    expect(market.outcomes).toHaveLength(2)
    expect(market.outcomes[0].impliedProb).toBeGreaterThan(0)
  })

  it('sets capturedAt to a valid ISO string if not provided', () => {
    const market = normalizeMarket(rawMarket)
    expect(() => new Date(market.capturedAt)).not.toThrow()
  })
})

describe('computeOverround', () => {
  it('standard -110 / -110 line is around 1.047', () => {
    expect(computeOverround([-110, -110])).toBeCloseTo(1.0476, 3)
  })

  it('fair 50/50 line has overround = 1.0', () => {
    expect(computeOverround([100, -100])).toBeCloseTo(1.0, 3)
  })
})

describe('looksLikeThreeWayOdds', () => {
  it('returns true when combined implied is below 0.85 (1X2 odds)', () => {
    // Columbus Blue Jackets +112 / Boston Bruins +220 — the real bug scenario
    expect(looksLikeThreeWayOdds(112, 220)).toBe(true)
  })

  it('returns false for normal 2-way moneyline odds', () => {
    expect(looksLikeThreeWayOdds(-150, 130)).toBe(false)
  })

  it('returns false for even-money 2-way', () => {
    expect(looksLikeThreeWayOdds(-110, -110)).toBe(false)
  })
})
