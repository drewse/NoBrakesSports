'use client'

import Image from 'next/image'
import { useState } from 'react'

// ── Brand config per sportsbook ──────────────────────────────────────────────
// Books with a PNG in /public/books/{slug}.png will show the real logo.
// All others fall back to a colored abbreviation icon.

interface BookConfig {
  abbrev: string
  bg: string      // tailwind bg class (fallback only)
  text: string    // tailwind text class (fallback only)
  hasLogo?: boolean  // true if /public/books/{slug}.png exists
  logoSlug?: string  // use a different slug's PNG (e.g. betrivers_on → betrivers)
}

const BOOK_CONFIG: Record<string, BookConfig> = {
  draftkings:          { abbrev: 'DK',  bg: 'bg-[#53d337]',      text: 'text-black',        hasLogo: true },
  fanduel:             { abbrev: 'FD',  bg: 'bg-[#1493ff]',      text: 'text-white',        hasLogo: true },
  betmgm:              { abbrev: 'MG',  bg: 'bg-[#c5a44e]',      text: 'text-black',        hasLogo: true },
  caesars:             { abbrev: 'CZ',  bg: 'bg-[#0a3a2a]',      text: 'text-[#c5a44e]',   hasLogo: true },
  betrivers:           { abbrev: 'BR',  bg: 'bg-[#1a56db]',      text: 'text-white',        hasLogo: true },
  betrivers_on:        { abbrev: 'BR',  bg: 'bg-[#1a56db]',      text: 'text-white',        hasLogo: true, logoSlug: 'betrivers' },
  bet365:              { abbrev: '365', bg: 'bg-[#027b5b]',      text: 'text-[#ffdf1b]',    hasLogo: true },
  pinnacle:            { abbrev: 'PN',  bg: 'bg-[#d32f2f]',      text: 'text-white',        hasLogo: true },
  sports_interaction:  { abbrev: 'SI',  bg: 'bg-[#ffcc00]',      text: 'text-black',        hasLogo: true },
  thescore:            { abbrev: 'SC',  bg: 'bg-[#5c16c5]',      text: 'text-white',        hasLogo: true },
  pointsbet_on:        { abbrev: 'PB',  bg: 'bg-[#e63946]',      text: 'text-white',        hasLogo: true },
  pointsbet:           { abbrev: 'PB',  bg: 'bg-[#e63946]',      text: 'text-white',        hasLogo: true, logoSlug: 'pointsbet_on' },
  betway:              { abbrev: 'BW',  bg: 'bg-[#2d2d2d]',      text: 'text-white',        hasLogo: true },
  betvictor:           { abbrev: 'BV',  bg: 'bg-[#cc0000]',      text: 'text-white',        hasLogo: true },
  bet99:               { abbrev: '99',  bg: 'bg-[#1a1a1a]',      text: 'text-[#f5c518]',   hasLogo: true },
  unibet:              { abbrev: 'UB',  bg: 'bg-[#147b45]',      text: 'text-white' },
  northstarbets:       { abbrev: 'NS',  bg: 'bg-[#1e3a5f]',      text: 'text-white',        hasLogo: true },
  proline:             { abbrev: 'PL',  bg: 'bg-[#003da5]',      text: 'text-white',        hasLogo: true },
  '888sport':          { abbrev: '888', bg: 'bg-[#1e1e1e]',      text: 'text-[#ff8800]' },
  bwin:                { abbrev: 'BW',  bg: 'bg-[#ffcc00]',      text: 'text-black' },
  betano:              { abbrev: 'BN',  bg: 'bg-[#ff6b00]',      text: 'text-white' },
  leovegas:            { abbrev: 'LV',  bg: 'bg-[#ff6600]',      text: 'text-white' },
  tonybet:             { abbrev: 'TB',  bg: 'bg-[#1a1a2e]',      text: 'text-[#00d4ff]' },
  casumo:              { abbrev: 'CA',  bg: 'bg-[#7b2d8e]',      text: 'text-white' },
  ballybet:            { abbrev: 'BB',  bg: 'bg-[#e31837]',      text: 'text-white' },
  partypoker:          { abbrev: 'PP',  bg: 'bg-[#ff6600]',      text: 'text-white' },
  jackpotbet:          { abbrev: 'JB',  bg: 'bg-[#ffd700]',      text: 'text-black' },
  polymarket:          { abbrev: 'PM',  bg: 'bg-[#0052ff]',      text: 'text-white' },
  kalshi:              { abbrev: 'KL',  bg: 'bg-[#6366f1]',      text: 'text-white' },
  the_odds_api:        { abbrev: 'OA',  bg: 'bg-nb-700',         text: 'text-white' },
}

// Map display name → slug for places that only have the name
const NAME_TO_SLUG: Record<string, string> = {
  'DraftKings':          'draftkings',
  'FanDuel':             'fanduel',
  'BetMGM':              'betmgm',
  'Caesars':             'caesars',
  'BetRivers':           'betrivers',
  'BetRivers ON':        'betrivers_on',
  'bet365':              'bet365',
  'Pinnacle':            'pinnacle',
  'Sports Interaction':  'sports_interaction',
  'theScore Bet':        'thescore',
  'theScore':            'thescore',
  'PointsBet ON':        'pointsbet_on',
  'PointsBet':           'pointsbet',
  'Betway':              'betway',
  'BetVictor':           'betvictor',
  'BET99':               'bet99',
  'Unibet':              'unibet',
  'NorthStar Bets':      'northstarbets',
  'PROLINE+':            'proline',
  '888sport':            '888sport',
  'bwin':                'bwin',
  'Betano':              'betano',
  'LeoVegas':            'leovegas',
  'TonyBet':             'tonybet',
  'Casumo':              'casumo',
  'Bally Bet':           'ballybet',
  'partypoker':          'partypoker',
  'Jackpotbet':          'jackpotbet',
  'Polymarket':          'polymarket',
  'Kalshi':              'kalshi',
}

function resolveSlug(nameOrSlug: string): string {
  if (BOOK_CONFIG[nameOrSlug]) return nameOrSlug
  if (NAME_TO_SLUG[nameOrSlug]) return NAME_TO_SLUG[nameOrSlug]
  return nameOrSlug.toLowerCase().replace(/\s+/g, '_')
}

function getConfig(slug: string): BookConfig {
  return BOOK_CONFIG[slug] ?? { abbrev: slug.slice(0, 2).toUpperCase(), bg: 'bg-nb-700', text: 'text-white' }
}

// ── Component ────────────────────────────────────────────────────────────────

type BookLogoSize = 'xs' | 'sm' | 'md'

const SIZE_CLASSES: Record<BookLogoSize, { wrapper: string; text: string; img: number }> = {
  xs: { wrapper: 'h-4 w-4 rounded',      text: 'text-[6px]',  img: 16 },
  sm: { wrapper: 'h-5 w-5 rounded',      text: 'text-[7px]',  img: 20 },
  md: { wrapper: 'h-6 w-6 rounded-md',   text: 'text-[8px]',  img: 24 },
}

interface BookLogoProps {
  /** Book slug (e.g. "draftkings") or display name (e.g. "DraftKings") */
  name: string
  size?: BookLogoSize
  className?: string
}

export function BookLogo({ name, size = 'sm', className = '' }: BookLogoProps) {
  const slug = resolveSlug(name)
  const config = getConfig(slug)
  const sz = SIZE_CLASSES[size]
  const [imgError, setImgError] = useState(false)

  // Use real logo if available
  if (config.hasLogo && !imgError) {
    const logoFile = config.logoSlug ?? slug
    return (
      <Image
        src={`/books/${logoFile}.png`}
        alt={name}
        title={name}
        width={sz.img}
        height={sz.img}
        className={`${sz.wrapper} object-cover shrink-0 ${className}`}
        onError={() => setImgError(true)}
      />
    )
  }

  // Fallback: colored abbreviation
  return (
    <span
      className={`${sz.wrapper} ${config.bg} ${config.text} inline-flex items-center justify-center font-bold leading-none select-none shrink-0 ${className}`}
      title={name}
    >
      <span className={sz.text}>{config.abbrev}</span>
    </span>
  )
}

/** BookLogo + name label side by side */
export function BookLogoWithName({ name, size = 'sm', className = '' }: BookLogoProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <BookLogo name={name} size={size} />
      <span className="text-xs text-nb-400 truncate">{name}</span>
    </span>
  )
}
