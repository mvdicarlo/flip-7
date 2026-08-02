export type PlayerRole = 'host' | 'player'

export type LobbyStatus = 'waiting' | 'active' | 'finished'

export type ScoreModifier =
  | 'plus-2'
  | 'plus-4'
  | 'plus-6'
  | 'plus-8'
  | 'plus-10'
  | 'times-2'

export interface HandSelection {
  numberCards: number[]
  modifiers: ScoreModifier[]
  busted: boolean
}

export interface PlayerRoundHand extends HandSelection {
  points: number
  hasFlip7: boolean
  ready: boolean
  updatedAt: string | null
}

export interface GameRoundScore {
  playerId: string
  playerName?: string
  points: number
  total: number
  hand: HandSelection
}

export interface GameRound {
  number: number
  completedAt: string
  scores: GameRoundScore[]
}

export interface LobbyGame {
  runId: string
  targetScore: number
  roundNumber: number
  startedAt: string
  finishedAt: string | null
  rounds: GameRound[]
  winnerIds: string[]
}

export interface LobbyPlayer {
  id: string
  name: string
  role: PlayerRole
  joinedAt: string
  score: number
  hand: PlayerRoundHand
}

export interface LobbyView {
  code: string
  status: LobbyStatus
  createdAt: string
  expiresAt: string
  players: LobbyPlayer[]
  game: LobbyGame | null
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