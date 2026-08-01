import type { PlayerSession } from '../../shared/contracts'

const SESSION_PREFIX = 'flip-seven:session:'
const MAX_SAVED_LOBBIES = 10

interface StoredPlayerSession extends PlayerSession {
  savedAt: number
}

export function saveLobbySession(session: PlayerSession): void {
  const storedSession: StoredPlayerSession = {
    ...session,
    savedAt: Date.now(),
  }

  window.localStorage.setItem(
    `${SESSION_PREFIX}${session.lobbyCode}`,
    JSON.stringify(storedSession),
  )
  pruneLobbySessions()
}

export function getLobbySession(code: string): PlayerSession | null {
  const storedSession = window.localStorage.getItem(`${SESSION_PREFIX}${code}`)

  if (!storedSession) {
    return null
  }

  try {
    const session: unknown = JSON.parse(storedSession)

    if (!isPlayerSession(session) || session.lobbyCode !== code) {
      throw new Error('Invalid lobby session')
    }

    return session
  } catch {
    window.localStorage.removeItem(`${SESSION_PREFIX}${code}`)
    return null
  }
}

function isPlayerSession(value: unknown): value is PlayerSession {
  if (!value || typeof value !== 'object') {
    return false
  }

  const session = value as Record<string, unknown>

  return (
    typeof session.lobbyCode === 'string' &&
    typeof session.playerId === 'string' &&
    session.playerId.length > 0 &&
    (session.role === 'host' || session.role === 'player') &&
    typeof session.token === 'string' &&
    session.token.length > 0
  )
}

function pruneLobbySessions(): void {
  const sessions: Array<{ key: string; savedAt: number }> = []
  const invalidKeys: string[] = []

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)

    if (!key?.startsWith(SESSION_PREFIX)) {
      continue
    }

    const storedValue = window.localStorage.getItem(key)

    try {
      const session: unknown = storedValue ? JSON.parse(storedValue) : null

      if (
        !isPlayerSession(session) ||
        key !== `${SESSION_PREFIX}${session.lobbyCode}`
      ) {
        invalidKeys.push(key)
        continue
      }

      const storedSession = session as PlayerSession & { savedAt?: unknown }
      sessions.push({
        key,
        savedAt:
          typeof storedSession.savedAt === 'number' &&
          Number.isFinite(storedSession.savedAt)
            ? storedSession.savedAt
            : 0,
      })
    } catch {
      invalidKeys.push(key)
    }
  }

  invalidKeys.forEach((key) => window.localStorage.removeItem(key))

  sessions
    .sort((left, right) => left.savedAt - right.savedAt)
    .slice(0, Math.max(0, sessions.length - MAX_SAVED_LOBBIES))
    .forEach(({ key }) => window.localStorage.removeItem(key))
}