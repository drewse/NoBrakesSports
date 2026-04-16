/**
 * BetMGM Ontario adapter — Entain CDS at www.on.betmgm.ca
 */
import { scrapeEntain, type EntainResult } from './entain-shared'

export type MGMResult = EntainResult
export type { EntainEvent as MGMEvent, EntainGameMarket as MGMGameMarket } from './entain-shared'

export async function scrapeBetMGM(signal?: AbortSignal): Promise<MGMResult[]> {
  return scrapeEntain({ domain: 'www.on.betmgm.ca', slug: 'betmgm' }, signal)
}
