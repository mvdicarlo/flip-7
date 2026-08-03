import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import type {
  GameRoundScore,
  HandSelection,
  LobbySessionEnvelope,
  LobbyView,
  PlayerRole,
  PlayerSession,
  ScoreModifier,
} from '../shared/contracts.js'
import { calculateHandScore } from '../shared/scoring.js'
import {
  GameStateConflictError,
  LobbyCodeConflictError,
  PlayerNameConflictError,
  parseRoundScores,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type RoundRecord,
  type StoredLobby,
} from './lobby-model.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5
const LOBBY_LIFETIME_SECONDS = 48 * 60 * 60
const MAX_CODE_ATTEMPTS = 10
const MAX_PLAYERS = 18
const TARGET_SCORE = 200

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
        gameId: '',
        hasRestarted: false,
        currentRound: 0,
        startedAt: '',
        finishedAt: '',
      }
      const { player, session } = createPlayer(
        code,
        hostName,
        'host',
        createdAt,
        expiresAt.toISOString(),
      )

      try {
        await this.repository.createLobby(lobby, player)
        return {
          lobby: toLobbyView({ lobby, players: [player], rounds: [] }),
          session,
        }
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

    if (storedLobby.lobby.status !== 'waiting') {
      throw new LobbyServiceError(
        'LOBBY_ALREADY_STARTED',
        409,
        'This lobby has already started its game.',
      )
    }

    if (getActivePlayers(storedLobby.players).length >= MAX_PLAYERS) {
      throw new LobbyServiceError(
        'LOBBY_FULL',
        409,
        'This lobby is full.',
      )
    }

    const joinedAt = this.clock()
    const { player, session } = createPlayer(
      storedLobby.lobby.lobbyCode,
      playerName,
      'player',
      joinedAt,
      storedLobby.lobby.expiresAt,
    )

    try {
      await this.repository.addPlayer(storedLobby.lobby, player)
    } catch (error) {
      if (error instanceof PlayerNameConflictError) {
        throw new LobbyServiceError(
          'PLAYER_NAME_TAKEN',
          409,
          'That name is already in this lobby.',
        )
      }

      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'LOBBY_CHANGED',
          409,
          'The lobby changed while you joined. Try again.',
        )
      }

      throw error
    }

    return {
      lobby: toLobbyView({
        lobby: storedLobby.lobby,
        players: [...storedLobby.players, player],
        rounds: storedLobby.rounds,
      }),
      session,
    }
  }

  async removePlayer(
    rawCode: string,
    playerId: string,
    sessionToken: string | undefined,
  ): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    this.requireHost(storedLobby, sessionToken)

    if (storedLobby.lobby.status === 'finished') {
      throw new LobbyServiceError(
        'GAME_FINISHED',
        409,
        'Players cannot be removed after the game finishes.',
      )
    }

    const player = getActivePlayers(storedLobby.players).find(
      (candidate) => candidate.playerId === playerId,
    )

    if (!player) {
      throw new LobbyServiceError(
        'PLAYER_NOT_FOUND',
        404,
        'That player is no longer in the lobby.',
      )
    }

    if (player.role === 'host') {
      throw new LobbyServiceError(
        'HOST_CANNOT_BE_REMOVED',
        400,
        'The lobby host cannot be removed.',
      )
    }

    if (storedLobby.lobby.status === 'waiting') {
      try {
        await this.repository.removePlayer(storedLobby.lobby, player)
      } catch (error) {
        if (error instanceof GameStateConflictError) {
          throw new LobbyServiceError(
            'PLAYER_STATE_CHANGED',
            409,
            'The lobby changed before that player could be removed. Refresh and try again.',
          )
        }

        throw error
      }

      return toLobbyView({
        lobby: storedLobby.lobby,
        players: storedLobby.players.filter(
          (candidate) => candidate.playerId !== player.playerId,
        ),
        rounds: storedLobby.rounds,
      })
    }

    const deactivatedPlayer: PlayerRecord = {
      ...player,
      active: false,
      handNumberCardsJson: '[]',
      handModifiersJson: '[]',
      handBusted: false,
      handReady: false,
      handUpdatedAt: '',
    }
    try {
      await this.repository.deactivatePlayer(deactivatedPlayer)
    } catch (error) {
      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'PLAYER_STATE_CHANGED',
          409,
          'That player changed before they could be removed. Refresh and try again.',
        )
      }

      throw error
    }

    return toLobbyView({
      lobby: storedLobby.lobby,
      players: storedLobby.players.map((candidate) =>
        candidate.playerId === player.playerId
          ? deactivatedPlayer
          : candidate,
      ),
      rounds: storedLobby.rounds,
    })
  }

  async startGame(
    rawCode: string,
    sessionToken: string | undefined,
  ): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    this.requireHost(storedLobby, sessionToken)

    if (storedLobby.lobby.status !== 'waiting') {
      throw new LobbyServiceError(
        'LOBBY_ALREADY_STARTED',
        409,
        'This game has already started.',
      )
    }

    if (getActivePlayers(storedLobby.players).length < 2) {
      throw new LobbyServiceError(
        'NOT_ENOUGH_PLAYERS',
        409,
        'At least two players are needed to start.',
      )
    }

    const lobby: LobbyRecord = {
      ...storedLobby.lobby,
      status: 'active',
      gameId: randomUUID(),
      currentRound: 1,
      startedAt: this.clock().toISOString(),
    }
    try {
      await this.repository.startGame(lobby)
    } catch (error) {
      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'LOBBY_CHANGED',
          409,
          'The lobby changed before the game could start. Refresh and try again.',
        )
      }

      throw error
    }

    return toLobbyView({ ...storedLobby, lobby })
  }

  async restartGame(
    rawCode: string,
    sessionToken: string | undefined,
    expectedRunId: string | undefined,
  ): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    this.requireHost(storedLobby, sessionToken)

    if (storedLobby.lobby.status === 'waiting') {
      throw new LobbyServiceError(
        'GAME_NOT_STARTED',
        409,
        'Start the game before restarting it.',
      )
    }

    this.requireGameRun(storedLobby, expectedRunId)

    const restartedAt = this.clock().toISOString()
    const lobby: LobbyRecord = {
      ...storedLobby.lobby,
      status: 'active',
      gameId: randomUUID(),
      hasRestarted: true,
      currentRound: 1,
      startedAt: restartedAt,
      finishedAt: '',
    }
    const players = storedLobby.players.map((player) => ({
      ...player,
      score: 0,
      handRoundNumber: 1,
      handNumberCardsJson: '[]',
      handModifiersJson: '[]',
      handBusted: false,
      handReady: false,
      handUpdatedAt: '',
    }))

    try {
      await this.repository.restartGame(lobby, players)
    } catch (error) {
      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'GAME_STATE_CHANGED',
          409,
          'The game changed before it could restart. Refresh and try again.',
        )
      }

      throw error
    }

    return toLobbyView({ lobby, players, rounds: [] })
  }

  async updateHand(
    rawCode: string,
    hand: HandSelection & { ready: boolean },
    sessionToken: string | undefined,
    expectedRunId: string | undefined,
  ): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    const requester = this.requirePlayer(storedLobby, sessionToken)
    this.requireGameRun(storedLobby, expectedRunId)

    if (storedLobby.lobby.status !== 'active') {
      throw new LobbyServiceError(
        'GAME_NOT_ACTIVE',
        409,
        'Cards can only be changed during an active game.',
      )
    }

    if (
      hand.ready &&
      !hand.busted &&
      hand.numberCards.length === 0 &&
      hand.modifiers.length === 0
    ) {
      throw new LobbyServiceError(
        'EMPTY_HAND',
        400,
        'Select at least one card before marking your hand ready.',
      )
    }

    const player: PlayerRecord = {
      ...requester,
      handRoundNumber: storedLobby.lobby.currentRound,
      handNumberCardsJson: JSON.stringify(hand.numberCards),
      handModifiersJson: JSON.stringify(hand.modifiers),
      handBusted: hand.busted,
      handReady: hand.ready,
      handUpdatedAt: this.clock().toISOString(),
    }
    try {
      await this.repository.updatePlayerHand(player)
    } catch (error) {
      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'HAND_CHANGED',
          409,
          'Your hand changed on another request. Refresh and try again.',
        )
      }

      throw error
    }

    return toLobbyView({
      ...storedLobby,
      players: storedLobby.players.map((candidate) =>
        candidate.playerId === player.playerId ? player : candidate,
      ),
    })
  }

  async recordRound(
    rawCode: string,
    sessionToken: string | undefined,
    expectedRunId: string | undefined,
  ): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    this.requireHost(storedLobby, sessionToken)

    if (storedLobby.lobby.status === 'waiting') {
      throw new LobbyServiceError(
        'GAME_NOT_STARTED',
        409,
        'Start the game before recording a round.',
      )
    }

    this.requireGameRun(storedLobby, expectedRunId)

    if (storedLobby.lobby.status === 'finished') {
      throw new LobbyServiceError(
        'GAME_FINISHED',
        409,
        'This game is already finished.',
      )
    }

    const currentPlayers = getActivePlayers(storedLobby.players)
    const hands = new Map(
      currentPlayers.map((player) => [
        player.playerId,
        toCurrentHand(player, storedLobby.lobby.currentRound),
      ]),
    )

    if ([...hands.values()].some((hand) => !hand.ready)) {
      throw new LobbyServiceError(
        'HANDS_NOT_READY',
        409,
        'Every player must mark their hand ready first.',
      )
    }

    const scoredPlayers = currentPlayers.map((player) => {
      const hand = hands.get(player.playerId) ?? emptyHand()
      return {
        player: {
          ...player,
          score: player.score + hand.points,
        },
        hand,
      }
    })
    const players = scoredPlayers.map(({ player }) => player)
    const leadingScore = Math.max(...players.map((player) => player.score))
    const leaders = players.filter((player) => player.score === leadingScore)
    const isFinished = leadingScore >= TARGET_SCORE && leaders.length === 1
    const completedAt = this.clock().toISOString()
    const lobby: LobbyRecord = {
      ...storedLobby.lobby,
      status: isFinished ? 'finished' : 'active',
      currentRound: isFinished
        ? storedLobby.lobby.currentRound
        : storedLobby.lobby.currentRound + 1,
      finishedAt: isFinished ? completedAt : '',
    }
    const roundScores: GameRoundScore[] = scoredPlayers.map(
      ({ player, hand }) => ({
        playerId: player.playerId,
        playerName: player.name,
        points: hand.points,
        total: player.score,
        hand: {
          numberCards: hand.numberCards,
          modifiers: hand.modifiers,
          busted: hand.busted,
        },
      }),
    )
    const nextActivePlayers = new Map(
      scoredPlayers.map(({ player }) => [
        player.playerId,
        {
          ...player,
          handRoundNumber: lobby.currentRound,
          handNumberCardsJson: '[]',
          handModifiersJson: '[]',
          handBusted: false,
          handReady: false,
          handUpdatedAt: '',
        },
      ]),
    )
    const nextPlayers: PlayerRecord[] = storedLobby.players.map(
      (player) => nextActivePlayers.get(player.playerId) ?? player,
    )
    const round: RoundRecord = {
      id: `round:${storedLobby.lobby.gameId || 'legacy'}:${String(
        storedLobby.lobby.currentRound,
      ).padStart(4, '0')}`,
      lobbyCode: storedLobby.lobby.lobbyCode,
      type: 'round',
      gameId: storedLobby.lobby.gameId,
      roundNumber: storedLobby.lobby.currentRound,
      completedAt,
      scoresJson: JSON.stringify(roundScores),
      expiresAt: storedLobby.lobby.expiresAt,
    }

    try {
      await this.repository.recordRound(lobby, nextPlayers, round)
    } catch (error) {
      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'ROUND_STATE_CHANGED',
          409,
          'A hand or round changed before completion. Refresh and try again.',
        )
      }

      throw error
    }

    return toLobbyView({
      lobby,
      players: nextPlayers,
      rounds: [...currentGameRounds(storedLobby), round],
    })
  }

  async undoLastRound(
    rawCode: string,
    sessionToken: string | undefined,
    expectedRunId: string | undefined,
  ): Promise<LobbyView> {
    const storedLobby = await this.findLobby(rawCode)
    this.requireHost(storedLobby, sessionToken)
    this.requireGameRun(storedLobby, expectedRunId)
    const rounds = currentGameRounds(storedLobby)
    const round = rounds.at(-1)

    if (!round) {
      throw new LobbyServiceError(
        'NO_ROUNDS_TO_UNDO',
        409,
        'There is no completed round to undo.',
      )
    }

    const hasCurrentRoundChanges =
      storedLobby.lobby.status === 'active' &&
      storedLobby.lobby.currentRound > round.roundNumber &&
      getActivePlayers(storedLobby.players).some(
        (player) =>
          toCurrentHand(player, storedLobby.lobby.currentRound).updatedAt !==
          null,
      )

    if (hasCurrentRoundChanges) {
      throw new LobbyServiceError(
        'ROUND_IN_PROGRESS',
        409,
        'Undo is unavailable after the next round has begun.',
      )
    }

    const scoresByPlayerId = new Map(
      parseRoundScores(round).map((score) => [score.playerId, score]),
    )
    const restoredAt = this.clock().toISOString()
    const players = storedLobby.players.map((player) => {
      const roundScore = scoresByPlayerId.get(player.playerId)

      if (!roundScore) {
        if (!player.active) {
          return player
        }

        throw new LobbyServiceError(
          'ROUND_UNDO_CONFLICT',
          409,
          'The round could not be restored. Refresh and try again.',
        )
      }

      return {
        ...player,
        score: roundScore.total - roundScore.points,
        handRoundNumber: round.roundNumber,
        handNumberCardsJson: JSON.stringify(roundScore.hand.numberCards),
        handModifiersJson: JSON.stringify(roundScore.hand.modifiers),
        handBusted: roundScore.hand.busted,
        handReady: false,
        handUpdatedAt: restoredAt,
      }
    })
    const lobby: LobbyRecord = {
      ...storedLobby.lobby,
      status: 'active',
      currentRound: round.roundNumber,
      finishedAt: '',
    }

    try {
      await this.repository.undoRound(lobby, players, round)
    } catch (error) {
      if (error instanceof GameStateConflictError) {
        throw new LobbyServiceError(
          'ROUND_UNDO_CONFLICT',
          409,
          'The round changed before it could be restored. Refresh and try again.',
        )
      }

      throw error
    }

    return toLobbyView({
      lobby,
      players,
      rounds: rounds.slice(0, -1),
    })
  }

  private requirePlayer(
    storedLobby: StoredLobby,
    sessionToken: string | undefined,
  ): PlayerRecord {
    const requester = authenticatePlayer(
      getActivePlayers(storedLobby.players),
      sessionToken,
    )

    if (!requester) {
      throw new LobbyServiceError(
        'SESSION_UNAUTHORIZED',
        401,
        'A valid lobby session is required.',
      )
    }

    return requester
  }

  private requireHost(
    storedLobby: StoredLobby,
    sessionToken: string | undefined,
  ): PlayerRecord {
    const requester = this.requirePlayer(storedLobby, sessionToken)

    if (requester.role !== 'host') {
      throw new LobbyServiceError(
        'HOST_ONLY',
        403,
        'Only the host can do that.',
      )
    }

    return requester
  }

  private requireGameRun(
    storedLobby: StoredLobby,
    expectedRunId: string | undefined,
  ): void {
    if (!expectedRunId && !storedLobby.lobby.hasRestarted) {
      return
    }

    if (expectedRunId !== gameRunId(storedLobby.lobby)) {
      throw new LobbyServiceError(
        'GAME_RUN_CHANGED',
        409,
        'This game was restarted. Refresh and try again.',
      )
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
  expiresAt: string,
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
    expiresAt,
    active: true,
    score: 0,
    handRoundNumber: 0,
    handNumberCardsJson: '[]',
    handModifiersJson: '[]',
    handBusted: false,
    handReady: false,
    handUpdatedAt: '',
  }

  return {
    player,
    session: { lobbyCode, playerId, role, token },
  }
}

function authenticatePlayer(
  players: PlayerRecord[],
  token: string | undefined,
): PlayerRecord | undefined {
  if (!token) {
    return undefined
  }

  const presentedHash = Buffer.from(
    createHash('sha256').update(token).digest('base64url'),
  )

  return players.find((player) => {
    const storedHash = Buffer.from(player.tokenHash)
    return (
      storedHash.length === presentedHash.length &&
      timingSafeEqual(storedHash, presentedHash)
    )
  })
}

function toLobbyView(storedLobby: StoredLobby): LobbyView {
  const currentPlayers = getActivePlayers(storedLobby.players)
  const rounds = currentGameRounds(storedLobby)
  const playerNames = new Map(
    storedLobby.players.map((player) => [player.playerId, player.name]),
  )
  const leadingScore = Math.max(
    0,
    ...currentPlayers.map((player) => player.score),
  )

  return {
    code: storedLobby.lobby.lobbyCode,
    status: storedLobby.lobby.status,
    createdAt: storedLobby.lobby.createdAt,
    expiresAt: storedLobby.lobby.expiresAt,
    players: currentPlayers
      .map((player) => ({
        id: player.playerId,
        name: player.name,
        role: player.role,
        joinedAt: player.joinedAt,
        score: player.score,
        hand: toCurrentHand(player, storedLobby.lobby.currentRound),
      }))
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt)),
    game:
      storedLobby.lobby.status === 'waiting'
        ? null
        : {
            runId: gameRunId(storedLobby.lobby),
            targetScore: TARGET_SCORE,
            roundNumber: storedLobby.lobby.currentRound,
            startedAt: storedLobby.lobby.startedAt,
            finishedAt: storedLobby.lobby.finishedAt || null,
            rounds: rounds.map((round) => ({
              number: round.roundNumber,
              completedAt: round.completedAt,
              scores: parseRoundScores(round).map((score) => ({
                ...score,
                playerName:
                  score.playerName ??
                  playerNames.get(score.playerId) ??
                  'Former player',
              })),
            })),
            winnerIds:
              storedLobby.lobby.status === 'finished'
                ? currentPlayers
                    .filter((player) => player.score === leadingScore)
                    .map((player) => player.playerId)
                : [],
          },
  }
}

function gameRunId(lobby: LobbyRecord): string {
  return lobby.gameId || lobby.startedAt
}

function currentGameRounds(storedLobby: StoredLobby): RoundRecord[] {
  return storedLobby.rounds.filter(
    (round) => round.gameId === storedLobby.lobby.gameId,
  )
}

function getActivePlayers(players: PlayerRecord[]): PlayerRecord[] {
  return players.filter((player) => player.active)
}

function toCurrentHand(
  player: PlayerRecord,
  currentRound: number,
): ReturnType<typeof emptyHand> {
  if (player.handRoundNumber !== currentRound) {
    return emptyHand()
  }

  const hand = {
    numberCards: JSON.parse(player.handNumberCardsJson) as number[],
    modifiers: JSON.parse(player.handModifiersJson) as ScoreModifier[],
    busted: player.handBusted,
  }
  const score = calculateHandScore(hand)

  return {
    ...hand,
    points: score.points,
    hasFlip7: score.hasFlip7,
    ready: player.handReady,
    updatedAt: player.handUpdatedAt || null,
  }
}

function emptyHand() {
  return {
    numberCards: [] as number[],
    modifiers: [] as ScoreModifier[],
    busted: false,
    points: 0,
    hasFlip7: false,
    ready: false,
    updatedAt: null as string | null,
  }
}