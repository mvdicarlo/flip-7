import type { PlayerSession } from '../../shared/contracts'

const SESSION_PREFIX = 'flip-seven:session:'

export function saveLobbySession(session: PlayerSession): void {
  window.localStorage.setItem(
    `${SESSION_PREFIX}${session.lobbyCode}`,
    JSON.stringify(session),
  )
}

export function getLobbySession(code: string): PlayerSession | null {
  const storedSession = window.localStorage.getItem(`${SESSION_PREFIX}${code}`)

  if (!storedSession) {
    return null
  }

  try {
    return JSON.parse(storedSession) as PlayerSession
  } catch {
    window.localStorage.removeItem(`${SESSION_PREFIX}${code}`)
    return null
  }
}