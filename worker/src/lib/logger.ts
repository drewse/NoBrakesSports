/** Minimal leveled logger. Structured JSON when not a TTY (Railway logs). */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const CONFIGURED_LEVEL: Level =
  (process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : 'info'

const IS_TTY = !!process.stdout.isTTY

function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[CONFIGURED_LEVEL]) return
  const time = new Date().toISOString()
  if (IS_TTY) {
    const tag = level.toUpperCase().padEnd(5)
    const extraStr = extra && Object.keys(extra).length > 0 ? ' ' + JSON.stringify(extra) : ''
    console.log(`${time} ${tag} [${scope}] ${msg}${extraStr}`)
  } else {
    console.log(JSON.stringify({ time, level, scope, msg, ...extra }))
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', scope, msg, extra),
    info:  (msg: string, extra?: Record<string, unknown>) => emit('info',  scope, msg, extra),
    warn:  (msg: string, extra?: Record<string, unknown>) => emit('warn',  scope, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit('error', scope, msg, extra),
  }
}

export type Logger = ReturnType<typeof createLogger>
