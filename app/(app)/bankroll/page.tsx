import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BankrollClient } from './bankroll-client'

export const metadata = { title: 'Bankroll' }

export default async function BankrollPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <BankrollClient />
}
