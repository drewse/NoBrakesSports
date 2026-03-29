import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChatInterface } from './chat-interface'

export const metadata = { title: 'Chat' }

export default async function ChatPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, sender_id, content, is_admin_sender, created_at')
    .eq('room_id', user.id)
    .order('created_at', { ascending: true })
    .limit(200)

  const userName = profile?.full_name ?? profile?.email?.split('@')[0] ?? 'You'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-nb-950 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white">
            <span className="text-nb-950 text-xs font-bold">NB</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">No Brakes Team</p>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] text-nb-400">Online · typically replies within a few hours</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat body — fills remaining height */}
      <div className="flex-1 min-h-0">
        <ChatInterface
          userId={user.id}
          userName={userName}
          initialMessages={messages ?? []}
        />
      </div>
    </div>
  )
}
