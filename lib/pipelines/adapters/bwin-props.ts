/**
 * bwin Ontario adapter — Entain CDS at www.on.bwin.ca
 */
import { scrapeEntain, type EntainResult } from './entain-shared'

export type BWINResult = EntainResult
export type { EntainEvent as BWINEvent, EntainGameMarket as BWINGameMarket } from './entain-shared'

export async function scrapeBwin(signal?: AbortSignal): Promise<BWINResult[]> {
  return scrapeEntain({ domain: 'www.on.bwin.ca', slug: 'bwin' }, signal)
}
