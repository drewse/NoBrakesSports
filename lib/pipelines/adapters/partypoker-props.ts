/**
 * partypoker/partysports Ontario adapter — Entain CDS at www.on.partysports.ca
 */
import { scrapeEntain, type EntainResult } from './entain-shared'

export type PPResult = EntainResult
export type { EntainEvent as PPEvent, EntainGameMarket as PPGameMarket } from './entain-shared'

export async function scrapePartypoker(signal?: AbortSignal): Promise<PPResult[]> {
  return scrapeEntain({ domain: 'www.on.partysports.ca', slug: 'partypoker' }, signal)
}
