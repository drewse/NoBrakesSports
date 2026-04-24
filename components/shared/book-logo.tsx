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
  logoSlug?: string  // use a different slug's file (e.g. betrivers_on → betrivers)
  logoExt?: string   // file extension override (default: 'png')
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
  northstarbets:       { abbrev: 'NS',  bg: 'bg-[#1e3a5f]',      text: 'text-white',        hasLogo: true },
  proline:             { abbrev: 'PL',  bg: 'bg-[#003da5]',      text: 'text-white',        hasLogo: true },
  '888sport':          { abbrev: '888', bg: 'bg-[#1e1e1e]',      text: 'text-[#ff8800]',    hasLogo: true },
  bwin:                { abbrev: 'BW',  bg: 'bg-[#ffcc00]',      text: 'text-black',        hasLogo: true },
  betano:              { abbrev: 'BN',  bg: 'bg-[#ff6b00]',      text: 'text-white',        hasLogo: true },
  leovegas:            { abbrev: 'LV',  bg: 'bg-[#ff6600]',      text: 'text-white',        hasLogo: true },
  tonybet:             { abbrev: 'TB',  bg: 'bg-[#1a1a2e]',      text: 'text-[#00d4ff]',    hasLogo: true },
  casumo:              { abbrev: 'CA',  bg: 'bg-[#7b2d8e]',      text: 'text-white',        hasLogo: true },
  ballybet:            { abbrev: 'BB',  bg: 'bg-[#e31837]',      text: 'text-white',        hasLogo: true },
  partypoker:          { abbrev: 'PP',  bg: 'bg-[#ff6600]',      text: 'text-white',        hasLogo: true },
  jackpotbet:          { abbrev: 'JB',  bg: 'bg-[#ffd700]',      text: 'text-black',        hasLogo: true, logoSlug: 'jackpot', logoExt: 'jpg' },
  powerplay:           { abbrev: 'PP',  bg: 'bg-[#d40000]',      text: 'text-white',        hasLogo: true },
  betovo:              { abbrev: 'BV',  bg: 'bg-[#1a1a1a]',      text: 'text-[#7ed321]',    hasLogo: true },
  miseojeu:            { abbrev: 'MJ',  bg: 'bg-[#0a1f3d]',      text: 'text-[#e31b23]',    hasLogo: true },
  sportzino:           { abbrev: 'SZ',  bg: 'bg-[#0d1b3d]',      text: 'text-white',        hasLogo: true },
  titanplay:           { abbrev: 'TP',  bg: 'bg-[#1a1a1a]',      text: 'text-[#e08a2a]',    hasLogo: true },
  underdog:            { abbrev: 'UD',  bg: 'bg-black',          text: 'text-[#fdb913]',    hasLogo: true },
  fanaticsmarkets:     { abbrev: 'FN',  bg: 'bg-black',          text: 'text-white',        hasLogo: true },
  novig:               { abbrev: 'NV',  bg: 'bg-[#7cc4f5]',      text: 'text-black',        hasLogo: true, logoExt: 'jpeg' },
  prizepicks:          { abbrev: 'PZ',  bg: 'bg-[#5a189a]',      text: 'text-white',        hasLogo: true, logoExt: 'jpg' },
  prophetx:            { abbrev: 'PX',  bg: 'bg-[#3ec28f]',      text: 'text-white',        hasLogo: true },
  sleeper:             { abbrev: 'SL',  bg: 'bg-[#1a2740]',      text: 'text-[#00d4d4]',    hasLogo: true, logoExt: 'jpg' },
  stake:               { abbrev: 'ST',  bg: 'bg-[#1d2839]',      text: 'text-white',        hasLogo: true, logoExt: 'jpg' },
  betonline:           { abbrev: 'BO',  bg: 'bg-[#2a2a2a]',      text: 'text-[#e30613]',    hasLogo: true },
  betparx:             { abbrev: 'PX',  bg: 'bg-[#1a0d3d]',      text: 'text-white',        hasLogo: true },
  betus:               { abbrev: 'US',  bg: 'bg-[#1e90ff]',      text: 'text-white',        hasLogo: true },
  bookmaker:           { abbrev: 'BM',  bg: 'bg-black',          text: 'text-[#f5c518]',    hasLogo: true },
  bovada:              { abbrev: 'BV',  bg: 'bg-white',          text: 'text-[#d32f2f]',    hasLogo: true },
  circa:               { abbrev: 'CS',  bg: 'bg-[#1a1a1a]',      text: 'text-white',        hasLogo: true, logoExt: 'jpg' },
  hardrockbet:         { abbrev: 'HR',  bg: 'bg-[#c026d3]',      text: 'text-white',        hasLogo: true },
  lowvig:              { abbrev: 'LV',  bg: 'bg-[#0a1f4d]',      text: 'text-white',        hasLogo: true, logoExt: 'jpg' },
  mybookie:            { abbrev: 'MB',  bg: 'bg-black',          text: 'text-[#f57c00]',    hasLogo: true },
  sportsbetting:       { abbrev: 'SB',  bg: 'bg-[#0a3a8c]',      text: 'text-white',        hasLogo: true, logoExt: 'jpg' },
  // Fanatics ships under three different market_sources rows (slugs:
  // 'fanatics', 'fanatics_markets', and the canonical 'fanaticsmarkets').
  // Alias all three to the same logo file so the UI is consistent.
  fanatics:            { abbrev: 'FN',  bg: 'bg-black',          text: 'text-white',        hasLogo: true, logoExt: 'webp' },
  fanatics_markets:    { abbrev: 'FN',  bg: 'bg-black',          text: 'text-white',        hasLogo: true, logoSlug: 'fanaticsmarkets' },
  // Brand-matched fallback colors (used if image fails to load too).
  betanysports:        { abbrev: 'BA',  bg: 'bg-[#1a1a1a]',      text: 'text-[#ff8c00]' },
  betsson:             { abbrev: 'BS',  bg: 'bg-[#00b14f]',      text: 'text-white',        hasLogo: true },
  espnbet:             { abbrev: 'ES',  bg: 'bg-[#d20a11]',      text: 'text-white',        hasLogo: true },
  fliff:               { abbrev: 'FL',  bg: 'bg-[#ff5cb6]',      text: 'text-white',        hasLogo: true, logoExt: 'jpg' },
  unibet:              { abbrev: 'UN',  bg: 'bg-[#147b3c]',      text: 'text-[#ffd400]',    hasLogo: true },
  williamhill:         { abbrev: 'WH',  bg: 'bg-[#003b71]',      text: 'text-[#ffcc00]',    hasLogo: true },
  polymarket:          { abbrev: 'PM',  bg: 'bg-[#0052ff]',      text: 'text-white',        hasLogo: true },
  kalshi:              { abbrev: 'KL',  bg: 'bg-[#6366f1]',      text: 'text-white',        hasLogo: true },
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
  'PowerPlay':           'powerplay',
  'Power Play':          'powerplay',
  'Betovo':              'betovo',
  'Mise-O-Jeu':          'miseojeu',
  'Mise-o-jeu':          'miseojeu',
  'Mise O Jeu':          'miseojeu',
  'Mise-O-Jeu+':         'miseojeu',
  'Sportzino':           'sportzino',
  'TitanPlay':           'titanplay',
  'Titan Play':          'titanplay',
  'Underdog':            'underdog',
  'Underdog Fantasy':    'underdog',
  'Fanatics':            'fanaticsmarkets',
  'Fanatics Sportsbook': 'fanaticsmarkets',
  'Fanatics Markets':    'fanaticsmarkets',
  'Novig':               'novig',
  'PrizePicks':          'prizepicks',
  'Prize Picks':         'prizepicks',
  'ProphetX':            'prophetx',
  'Prophet Exchange':    'prophetx',
  'Sleeper':             'sleeper',
  'Sleeper Picks':       'sleeper',
  'Stake':               'stake',
  'Stake.com':           'stake',
  'BetOnline':           'betonline',
  'BetOnline.ag':        'betonline',
  'betPARX':             'betparx',
  'BetParx':             'betparx',
  'BetUS':               'betus',
  'BookMaker':           'bookmaker',
  'BookMaker.eu':        'bookmaker',
  'Bovada':              'bovada',
  'Circa':               'circa',
  'Circa Sports':        'circa',
  'Hard Rock Bet':       'hardrockbet',
  'Hard Rock':           'hardrockbet',
  'LowVig':              'lowvig',
  'LowVig.ag':           'lowvig',
  'MyBookie':            'mybookie',
  'MyBookie.ag':         'mybookie',
  'SportsBetting':       'sportsbetting',
  'SportsBetting.ag':    'sportsbetting',
  'BetAnySports':        'betanysports',
  'Betsson':             'betsson',
  'ESPN Bet':            'espnbet',
  'ESPNBet':             'espnbet',
  'Fliff':               'fliff',
  'Unibet':              'unibet',
  'William Hill':        'williamhill',
  'WilliamHill':         'williamhill',
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
    const logoExt = config.logoExt ?? 'png'
    return (
      <Image
        src={`/books/${logoFile}.${logoExt}`}
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
