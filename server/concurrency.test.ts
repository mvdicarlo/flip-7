import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InMemoryLobbyRepository } from './in-memory-lobby-repository.js'
import type {
  LobbyRecord,
  PlayerRecord,
  RoundRecord,
} from './lobby-model.js'
import { LobbyService, LobbyServiceError } from './lobby-service.js'

const TEST_NOW = new Date('2030-08-01T12:00:00.000Z')

class PausedRoundRepository extends InMemoryLobbyRepository {
  private markRoundStarted!: () => void
  private releaseRound!: () => void
  readonly roundStarted = new Promise<void>((resolve) => {
    this.markRoundStarted = resolve
  })
  private readonly roundReleased = new Promise<void>((resolve) => {
    this.releaseRound = resolve
  })

  override async recordRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    this.markRoundStarted()
    await this.roundReleased
    return super.recordRound(lobby, players, round)
  }

  continueRound(): void {
    this.releaseRound()
  }
}

class PausedJoinRepository extends InMemoryLobbyRepository {
  private shouldPauseJoin = false
  private markJoinStarted!: () => void
  private releaseJoin!: () => void
  readonly joinStarted = new Promise<void>((resolve) => {
    this.markJoinStarted = resolve
  })
  private readonly joinReleased = new Promise<void>((resolve) => {
    this.releaseJoin = resolve
  })

  pauseNextJoin(): void {
    this.shouldPauseJoin = true
  }

  override async addPlayer(
    lobby: LobbyRecord,
    player: PlayerRecord,
  ): Promise<void> {
    if (this.shouldPauseJoin) {
      this.shouldPauseJoin = false
      this.markJoinStarted()
      await this.joinReleased
    }

    return super.addPlayer(lobby, player)
  }

  continueJoin(): void {
    this.releaseJoin()
  }
}

describe('game state concurrency', () => {
  it('rejects round completion when a hand changes after its snapshot', async () => {
    const repository = new PausedRoundRepository()
    const service = new LobbyService(
      repository,
      () => new Date(TEST_NOW),
      () => 'ABCDE',
    )
    const host = (await service.createLobby('Host')).session
    const player = (await service.joinLobby('ABCDE', 'Player')).session
    const startedLobby = await service.startGame('ABCDE', host.token)
    const runId = startedLobby.game?.runId ?? ''
    await service.updateHand(
      'ABCDE',
      { numberCards: [1], modifiers: [], busted: false, ready: true },
      host.token,
      runId,
    )
    await service.updateHand(
      'ABCDE',
      { numberCards: [2], modifiers: [], busted: false, ready: true },
      player.token,
      runId,
    )

    const roundRequest = service.recordRound('ABCDE', host.token, runId)
    await repository.roundStarted
    await service.updateHand(
      'ABCDE',
      { numberCards: [3], modifiers: [], busted: false, ready: false },
      player.token,
      runId,
    )
    const rejection = assert.rejects(
      roundRequest,
      (error: unknown) =>
        error instanceof LobbyServiceError &&
        error.code === 'ROUND_STATE_CHANGED',
    )
    repository.continueRound()
    await rejection

    const lobby = await service.getLobby('ABCDE')
    const currentPlayer = lobby.players.find(
      (candidate) => candidate.id === player.playerId,
    )
    assert.equal(lobby.game?.roundNumber, 1)
    assert.equal(lobby.game?.rounds.length, 0)
    assert.deepEqual(currentPlayer?.hand.numberCards, [3])
    assert.equal(currentPlayer?.hand.ready, false)
  })

  it('rejects a hand update from the previous game run', async () => {
    const service = new LobbyService(
      new InMemoryLobbyRepository(),
      () => new Date(TEST_NOW),
      () => 'RSTRT',
    )
    const host = (await service.createLobby('Host')).session
    await service.joinLobby('RSTRT', 'Player')
    const startedLobby = await service.startGame('RSTRT', host.token)
    const previousRunId = startedLobby.game?.runId ?? ''
    const restartedLobby = await service.restartGame(
      'RSTRT',
      host.token,
      previousRunId,
    )

    await assert.rejects(
      service.updateHand(
        'RSTRT',
        { numberCards: [7], modifiers: [], busted: false, ready: true },
        host.token,
        previousRunId,
      ),
      (error: unknown) =>
        error instanceof LobbyServiceError &&
        error.code === 'GAME_RUN_CHANGED',
    )

    assert.notEqual(restartedLobby.game?.runId, previousRunId)
    assert.deepEqual(
      (await service.getLobby('RSTRT')).players[0]?.hand.numberCards,
      [],
    )
  })

  it('rejects a join that was read before the game started', async () => {
    const repository = new PausedJoinRepository()
    const service = new LobbyService(
      repository,
      () => new Date(TEST_NOW),
      () => 'FGHJK',
    )
    const host = (await service.createLobby('Host')).session
    await service.joinLobby('FGHJK', 'Player')
    repository.pauseNextJoin()

    const joinRequest = service.joinLobby('FGHJK', 'Too Late')
    await repository.joinStarted
    await service.startGame('FGHJK', host.token)
    const rejection = assert.rejects(
      joinRequest,
      (error: unknown) =>
        error instanceof LobbyServiceError && error.code === 'LOBBY_CHANGED',
    )
    repository.continueJoin()
    await rejection

    const lobby = await service.getLobby('FGHJK')
    assert.equal(lobby.status, 'active')
    assert.deepEqual(
      lobby.players.map((player) => player.name),
      ['Host', 'Player'],
    )
  })
})