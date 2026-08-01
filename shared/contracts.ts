export type PlayerRole = 'host' | 'player'

export type LobbyStatus = 'waiting'

export interface LobbyPlayer {
  id: string
  name: string
  role: PlayerRole
  joinedAt: string
}

export interface LobbyView {
  code: string
  status: LobbyStatus
  createdAt: string
  expiresAt: string
  players: LobbyPlayer[]
}

export interface PlayerSession {
  lobbyCode: string
  playerId: string
  role: PlayerRole
  token: string
}

export interface LobbyEnvelope {
  lobby: LobbyView
}

export interface LobbySessionEnvelope extends LobbyEnvelope {
  session: PlayerSession
}

export interface ApiErrorEnvelope {
  error: {
    code: string
    message: string
  }
}