import type {
  GameRoundScore,
  LobbyStatus,
  PlayerRole,
} from '../shared/contracts.js'

export interface LobbyRecord {
  etag?: string
  id: 'lobby'
  lobbyCode: string
  type: 'lobby'
  status: LobbyStatus
  createdAt: string
  expiresAt: string
  gameId: string
  hasRestarted: boolean
  currentRound: number
  startedAt: string
  finishedAt: string
}

export interface PlayerRecord {
  etag?: string
  id: string
  lobbyCode: string
  type: 'player'
  playerId: string
  name: string
  normalizedName: string
  role: PlayerRole
  joinedAt: string
  tokenHash: string
  expiresAt: string
  active: boolean
  score: number
  handRoundNumber: number
  handNumberCardsJson: string
  handModifiersJson: string
  handBusted: boolean
  handReady: boolean
  handUpdatedAt: string
}

export interface RoundRecord {
  etag?: string
  id: string
  lobbyCode: string
  type: 'round'
  gameId: string
  roundNumber: number
  completedAt: string
  scoresJson: string
  expiresAt: string
}

export interface StoredLobby {
  lobby: LobbyRecord
  players: PlayerRecord[]
  rounds: RoundRecord[]
}

export interface LobbyRepository {
  createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void>
  getLobby(code: string): Promise<StoredLobby | null>
  addPlayer(lobby: LobbyRecord, player: PlayerRecord): Promise<void>
  removePlayer(lobby: LobbyRecord, player: PlayerRecord): Promise<void>
  deactivatePlayer(player: PlayerRecord): Promise<void>
  updatePlayerHand(player: PlayerRecord): Promise<void>
  startGame(lobby: LobbyRecord): Promise<void>
  restartGame(lobby: LobbyRecord, players: PlayerRecord[]): Promise<void>
  recordRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void>
  undoRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void>
  deleteExpiredLobbies(expiresBefore: Date): Promise<number>
  close(): Promise<void>
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

export class GameStateConflictError extends Error {
  constructor() {
    super('Game state changed concurrently')
    this.name = 'GameStateConflictError'
  }
}

export function parseRoundScores(round: RoundRecord): GameRoundScore[] {
  return JSON.parse(round.scoresJson) as GameRoundScore[]
}