import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Toaster } from '@/components/ui/toaster'
import { PostHogProvider } from '@/components/shared/posthog-provider'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'No Brakes Sports — Market Intelligence Platform',
    template: '%s | No Brakes Sports',
  },
  description:
    'Premium sports market analytics. Track price movements, compare sources, and surface insights across all major markets.',
  keywords: [
    'sports analytics',
    'market intelligence',
    'sports data',
    'line movement',
    'prediction markets',
    'sports research',
  ],
  authors: [{ name: 'No Brakes Sports' }],
  creator: 'No Brakes Sports',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    title: 'No Brakes Sports — Market Intelligence Platform',
    description: 'Premium sports market analytics and price movement tracking.',
    siteName: 'No Brakes Sports',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'No Brakes Sports',
    description: 'Premium sports market analytics.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-nb-950 font-sans antialiased">
        <PostHogProvider>
          {children}
          <Toaster />
        </PostHogProvider>
      </body>
    </html>
  )
}
