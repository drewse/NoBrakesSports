/**
 * Discord webhook alerts for arbitrage and +EV opportunities.
 *
 * Set DISCORD_WEBHOOK_URL in environment variables.
 * Sends rich embeds with opportunity details.
 */

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

interface ArbAlert {
  type: 'arb'
  eventTitle: string
  league: string
  market: string
  sideA: { label: string; price: number; source: string }
  sideB: { label: string; price: number; source: string }
  profitPct: number
}

interface EvAlert {
  type: 'ev'
  eventTitle: string
  league: string
  outcomeLabel: string
  bestPrice: number
  bestSource: string
  evPct: number
  fairProb: number
  kellyPct: number
}

type Alert = ArbAlert | EvAlert

// Track recently sent alerts to avoid spam (in-memory, resets on cold start)
const sentAlerts = new Set<string>()
const ALERT_TTL = 30 * 60 * 1000 // 30 min — don't re-send same alert within this window

function alertKey(alert: Alert): string {
  if (alert.type === 'arb') {
    return `arb:${alert.eventTitle}:${alert.market}:${Math.round(alert.profitPct * 10)}`
  }
  return `ev:${alert.eventTitle}:${alert.outcomeLabel}:${Math.round(alert.evPct * 10)}`
}

function formatOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`
}

async function sendDiscordEmbed(embeds: any[]): Promise<void> {
  if (!WEBHOOK_URL) return

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds }),
    })
  } catch (e) {
    console.error('Discord webhook error:', e)
  }
}

export async function sendArbAlert(alert: ArbAlert): Promise<void> {
  if (!WEBHOOK_URL) return

  const key = alertKey(alert)
  if (sentAlerts.has(key)) return
  sentAlerts.add(key)
  setTimeout(() => sentAlerts.delete(key), ALERT_TTL)

  await sendDiscordEmbed([{
    title: `🔄 Arb: ${alert.profitPct.toFixed(2)}% Profit`,
    color: 0x00ff88,
    fields: [
      { name: 'Event', value: alert.eventTitle, inline: true },
      { name: 'League', value: alert.league, inline: true },
      { name: 'Market', value: alert.market, inline: true },
      { name: alert.sideA.label, value: `**${formatOdds(alert.sideA.price)}** @ ${alert.sideA.source}`, inline: true },
      { name: alert.sideB.label, value: `**${formatOdds(alert.sideB.price)}** @ ${alert.sideB.source}`, inline: true },
      { name: 'Profit', value: `**${alert.profitPct.toFixed(2)}%**`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NoBrakes Sports' },
  }])
}

export async function sendEvAlert(alert: EvAlert): Promise<void> {
  if (!WEBHOOK_URL) return

  const key = alertKey(alert)
  if (sentAlerts.has(key)) return
  sentAlerts.add(key)
  setTimeout(() => sentAlerts.delete(key), ALERT_TTL)

  await sendDiscordEmbed([{
    title: `⚡ +EV: ${alert.evPct.toFixed(1)}% Edge`,
    color: alert.evPct >= 5 ? 0xffd700 : alert.evPct >= 2 ? 0x00ff88 : 0x88ccff,
    fields: [
      { name: 'Event', value: alert.eventTitle, inline: true },
      { name: 'League', value: alert.league, inline: true },
      { name: 'Outcome', value: alert.outcomeLabel, inline: false },
      { name: 'Best Price', value: `**${formatOdds(alert.bestPrice)}** @ ${alert.bestSource}`, inline: true },
      { name: 'EV %', value: `**+${alert.evPct.toFixed(2)}%**`, inline: true },
      { name: 'Fair Prob', value: `${(alert.fairProb * 100).toFixed(1)}%`, inline: true },
      { name: 'Kelly (¼)', value: `${alert.kellyPct.toFixed(1)}%`, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NoBrakes Sports' },
  }])
}

/**
 * Send batch alerts for multiple opportunities.
 * Filters out duplicates and respects rate limits.
 */
export async function sendBatchAlerts(alerts: Alert[]): Promise<number> {
  if (!WEBHOOK_URL) return 0

  let sent = 0
  for (const alert of alerts) {
    const key = alertKey(alert)
    if (sentAlerts.has(key)) continue

    if (alert.type === 'arb') {
      await sendArbAlert(alert)
    } else {
      await sendEvAlert(alert)
    }
    sent++

    // Rate limit: max 5 alerts per batch to avoid Discord throttling
    if (sent >= 5) break
  }
  return sent
}
