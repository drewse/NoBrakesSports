// Temp: test Discord webhook is working
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
  if (!WEBHOOK_URL) {
    return NextResponse.json({ error: 'DISCORD_WEBHOOK_URL not set' }, { status: 500 })
  }

  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '✅ Discord Test',
          description: 'Testing webhook from Vercel',
          color: 0x00ff88,
          timestamp: new Date().toISOString(),
        }],
      }),
    })

    return NextResponse.json({
      webhookSet: true,
      webhookUrl: WEBHOOK_URL.slice(0, 50) + '...',
      status: resp.status,
      ok: resp.ok,
      body: resp.ok ? 'sent' : await resp.text(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
