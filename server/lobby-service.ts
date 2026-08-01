import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type {
  LobbySessionEnvelope,
  LobbyView,
  PlayerRole,
  PlayerSession,
} from '../shared/contracts.js'
import {
  LobbyCodeConflictError,
  PlayerNameConflictError,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type StoredLobby,
} from './lobby-model.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5
const LOBBY_LIFETIME_SECONDS = 12 * 60 * 60
const MAX_CODE_ATTEMPTS = 10

type Clock = () => Date
type CodeGenerator = () => string

export class LobbyServiceError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'LobbyServiceError'
    this.code = code
    this.status = status
  }
}

export class LobbyService {
  private readonly repository: LobbyRepository
  private readonly clock: Clock
  private readonly codeGenerator: CodeGenerator

  constructor(
    repository: LobbyRepository,
    clock: Clock = () => new Date(),
    codeGenerator: CodeGenerator = generateLobbyCode,
  ) {
    this.repository = repository
    this.clock = clock
    this.codeGenerator = codeGenerator
  }

  async createLobby(hostName: string): Promise<LobbySessionEnvelope> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = this.codeGenerator()
      const createdAt = this.clock()
      const expiresAt = new Date(
        createdAt.getTime() + LOBBY_LIFETIME_SECONDS * 1_000,
      )
      const lobby: LobbyRecord = {
        id: 'lobby',
        lobbyCode: code,
        type: 'lobby',
        status: 'waiting',
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttl: LOBBY_LIFETIME_SECONDS,
      }
      const { player, session } = createPlayer(
        code,
        hostName,
        'host',
        createdAt,
        LOBBY_LIFETIME_SECONDS,
      )

      try {
        await this.repository.createLobby(lobby, player)
        return { lobby: toLobbyView({ lobby, players: [player] }), session }
      } catch (error) {
        if (error instanceof LobbyCodeConflictError) {
          continue
        }

        throw error
      }
    }

    throw new LobbyServiceError(
      'LOBBY_CODE_UNAVAILABLE',
      503,
      'Could not create a lobby. Please try again.',
    )
  }

  async getLobby(rawCode: string): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    return toLobbyView(storedLobby)
  }

  async joinLobby(
    rawCode: string,
    playerName: string,
  ): Promise<LobbySessionEnvelope> {
    const storedLobby = await this.findLobby(rawCode)
    const joinedAt = this.clock()
    const { player, session } = createPlayer(
      storedLobby.lobby.lobbyCode,
      playerName,
      'player',
      joinedAt,
      Math.max(
        1,
        Math.ceil(
          (Date.parse(storedLobby.lobby.expiresAt) - joinedAt.getTime()) / 1_000,
        ),
      ),
    )

    try {
      await this.repository.addPlayer(player)
    } catch (error) {
      if (error instanceof PlayerNameConflictError) {
        throw new LobbyServiceError(
          'PLAYER_NAME_TAKEN',
          409,
          'That name is already in this lobby.',
        )
      }

      throw error
    }

    return {
      lobby: toLobbyView({
        lobby: storedLobby.lobby,
        players: [...storedLobby.players, player],
      }),
      session,
    }
  }

  private async findLobby(rawCode: string): Promise<StoredLobby> {
    const code = rawCode.trim().toUpperCase()
    const storedLobby = await this.repository.getLobby(code)

    if (!storedLobby || Date.parse(storedLobby.lobby.expiresAt) <= this.clock().getTime()) {
      throw new LobbyServiceError(
        'LOBBY_NOT_FOUND',
        404,
        'We could not find that lobby.',
      )
    }

    return storedLobby
  }
}

export function generateLobbyCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('')
}

function createPlayer(
  lobbyCode: string,
  name: string,
  role: PlayerRole,
  joinedAt: Date,
  ttl: number,
): { player: PlayerRecord; session: PlayerSession } {
  const normalizedName = name.trim().replace(/\s+/g, ' ').toLowerCase()
  const token = randomBytes(32).toString('base64url')
  const playerId = randomUUID()
  const player: PlayerRecord = {
    id: `player:${createHash('sha256')
      .update(`${lobbyCode}:${normalizedName}`)
      .digest('base64url')}`,
    lobbyCode,
    type: 'player',
    playerId,
    name: name.trim().replace(/\s+/g, ' '),
    normalizedName,
    role,
    joinedAt: joinedAt.toISOString(),
    tokenHash: createHash('sha256').update(token).digest('base64url'),
    ttl,
  }

  return {
    player,
    session: { lobbyCode, playerId, role, token },
  }
}

function toLobbyView(storedLobby: StoredLobby): LobbyView {
  return {
    code: storedLobby.lobby.lobbyCode,
    status: storedLobby.lobby.status,
    createdAt: storedLobby.lobby.createdAt,
    expiresAt: storedLobby.lobby.expiresAt,
    players: storedLobby.players
      .map((player) => ({
        id: player.playerId,
        name: player.name,
        role: player.role,
        joinedAt: player.joinedAt,
      }))
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt)),
  }
}