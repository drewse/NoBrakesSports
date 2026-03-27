'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Bookmark, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/shared/empty-state'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/hooks/use-toast'
import { formatDateTime } from '@/lib/utils'
import type { Watchlist, League, Team } from '@/types'

interface Props {
  watchlists: Watchlist[]
  leagues: League[]
  teams: Team[]
  isPro: boolean
  userId: string
}

export function WatchlistView({ watchlists, leagues, teams, isPro }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [addType, setAddType] = useState<'league' | 'team'>('league')
  const [selectedId, setSelectedId] = useState('')
  const [adding, setAdding] = useState(false)

  const defaultWatchlist = watchlists.find((w) => w.is_default) ?? watchlists[0]
  const allItems: any[] = (defaultWatchlist as any)?.items ?? []
  const atLimit = !isPro && allItems.length >= 5

  const addItem = async () => {
    if (!selectedId || !defaultWatchlist) return
    setAdding(true)
    try {
      const supabase = createClient()
      const payload: Record<string, string> = { watchlist_id: defaultWatchlist.id }
      if (addType === 'league') payload.league_id = selectedId
      if (addType === 'team') payload.team_id = selectedId

      const { error } = await supabase.from('watchlist_items').insert(payload)
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return }
      toast({ title: 'Added to watchlist' })
      setSelectedId('')
      router.refresh()
    } finally { setAdding(false) }
  }

  const removeItem = async (itemId: string) => {
    const supabase = createClient()
    await supabase.from('watchlist_items').delete().eq('id', itemId)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* Add item */}
      {!atLimit ? (
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <CardTitle>Add to Watchlist</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <span className="text-xs text-nb-400">Type</span>
                <Select value={addType} onValueChange={(v) => setAddType(v as 'league' | 'team')}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="league">League</SelectItem>
                    <SelectItem value="team">Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1 min-w-[160px]">
                <span className="text-xs text-nb-400">Select {addType}</span>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`Choose ${addType}...`} /></SelectTrigger>
                  <SelectContent>
                    {addType === 'league' && leagues.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.abbreviation ?? l.name}</SelectItem>
                    ))}
                    {addType === 'team' && teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={addItem} disabled={!selectedId || adding}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border bg-nb-900 p-4 text-center">
          <p className="text-xs text-nb-400 mb-2">Free plan limit reached (5 items)</p>
          <Button asChild size="sm" variant="outline">
            <a href="/account/billing">Upgrade for unlimited</a>
          </Button>
        </div>
      )}

      {/* Items */}
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Saved Items</CardTitle>
            <span className="text-xs text-nb-400">{allItems.length} {!isPro && '/ 5'} items</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {allItems.length === 0 ? (
            <EmptyState icon={Bookmark} title="Nothing saved yet"
              description="Add teams, leagues, or events to track them here." />
          ) : (
            <div className="divide-y divide-border">
              {allItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3 hover:bg-nb-800/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    {item.team && (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{item.team.name}</p>
                        <Badge variant="muted" className="text-[10px]">Team</Badge>
                      </div>
                    )}
                    {item.league && (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{item.league.name}</p>
                        <Badge variant="muted" className="text-[10px]">League</Badge>
                      </div>
                    )}
                    {item.event && (
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white truncate">{item.event.title}</p>
                          <Badge variant="muted" className="text-[10px]">Event</Badge>
                        </div>
                        <p className="text-[10px] text-nb-500 mt-0.5">{formatDateTime(item.event.start_time)}</p>
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon-sm" className="shrink-0 ml-2"
                    onClick={() => removeItem(item.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-nb-400 hover:text-destructive transition-colors" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
