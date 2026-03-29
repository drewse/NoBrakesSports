'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/utils'

interface Message {
  id: string
  sender_id: string
  content: string
  is_admin_sender: boolean
  created_at: string
}

interface Props {
  userId: string
  userName: string
  initialMessages: Message[]
}

export function ChatInterface({ userId, userName, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`chat:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${userId}`,
        },
        (payload) => {
          const msg = payload.new as Message
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev
            return [...prev, msg]
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  async function send() {
    const text = input.trim()
    if (!text || isPending) return
    setInput('')
    setError(null)

    startTransition(async () => {
      const supabase = createClient()
      const { error: err } = await supabase.from('chat_messages').insert({
        room_id: userId,
        sender_id: userId,
        content: text,
        is_admin_sender: false,
      })
      if (err) {
        setError(err.message)
        setInput(text)
      }
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-nb-800 border border-nb-700">
              <Send className="h-5 w-5 text-nb-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white mb-1">Start a conversation</p>
              <p className="text-xs text-nb-500 max-w-xs">
                Send a message to the No Brakes team. We typically respond within a few hours.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isMe = !msg.is_admin_sender
          const showDate =
            i === 0 ||
            new Date(msg.created_at).toDateString() !==
              new Date(messages[i - 1].created_at).toDateString()

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-nb-600 whitespace-nowrap">
                    {new Date(msg.created_at).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}

              <div className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  msg.is_admin_sender
                    ? 'bg-white text-nb-950'
                    : 'bg-nb-700 text-white'
                }`}>
                  {msg.is_admin_sender ? 'NB' : initials(userName)}
                </div>

                <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                  <div className="flex items-center gap-1.5">
                    {msg.is_admin_sender && (
                      <span className="text-[10px] font-semibold text-nb-300">No Brakes</span>
                    )}
                    {msg.is_admin_sender && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-nb-800 text-nb-500 font-semibold uppercase tracking-wider">Admin</span>
                    )}
                  </div>
                  <div className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    isMe
                      ? 'bg-white text-nb-950 rounded-tr-sm'
                      : 'bg-nb-800 text-white rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                  <span className="text-[9px] text-nb-600 px-1">
                    {formatRelativeTime(msg.created_at)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        {error && (
          <p className="text-[10px] text-red-400 mb-2 px-1">{error}</p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message No Brakes team…"
            rows={1}
            className="flex-1 rounded-xl bg-nb-800 border border-nb-700 text-white text-xs px-3.5 py-2.5 placeholder-nb-600 focus:outline-none focus:ring-1 focus:ring-nb-500 resize-none leading-relaxed"
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || isPending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-nb-950 hover:bg-nb-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />
            }
          </button>
        </div>
        <p className="text-[9px] text-nb-700 mt-1.5 px-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
