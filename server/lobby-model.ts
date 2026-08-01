import type { LobbyStatus, PlayerRole } from '../shared/contracts.js'

export interface LobbyRecord {
  id: 'lobby'
  lobbyCode: string
  type: 'lobby'
  status: LobbyStatus
  createdAt: string
  expiresAt: string
  ttl: number
}

export interface PlayerRecord {
  id: string
  lobbyCode: string
  type: 'player'
  playerId: string
  name: string
  normalizedName: string
  role: PlayerRole
  joinedAt: string
  tokenHash: string
  ttl: number
}

export interface StoredLobby {
  lobby: LobbyRecord
  players: PlayerRecord[]
}

export interface LobbyRepository {
  createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void>
  getLobby(code: string): Promise<StoredLobby | null>
  addPlayer(player: PlayerRecord): Promise<void>
}

export class LobbyCodeConflictError extends Error {
  constructor() {
    super('Lobby code already exists')
    this.name = 'LobbyCodeConflictError'
  }
}

export class PlayerNameConflictError extends Error {
  constructor() {
    super('Player name already exists')
    this.name = 'PlayerNameConflictError'
  }
}