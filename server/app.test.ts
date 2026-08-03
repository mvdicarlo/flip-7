import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from './app.js'
import { InMemoryLobbyRepository } from './in-memory-lobby-repository.js'
import { LobbyService } from './lobby-service.js'

const TEST_NOW = new Date('2030-08-01T12:00:00.000Z')

function makeApp(code = 'ABCDE') {
  const repository = new InMemoryLobbyRepository()
  const service = new LobbyService(
    repository,
    () => new Date(TEST_NOW),
    () => code,
  )

  return createApp(service)
}

describe('lobby API', () => {
  it('creates a lobby with the host as its first player', async () => {
    const app = makeApp()
    const createResponse = await request(app)
      .post('/api/lobbies')
      .send({ hostName: '  Morgan  ' })
      .expect(201)

    assert.equal(createResponse.body.lobby.code, 'ABCDE')
    assert.equal(createResponse.body.lobby.status, 'waiting')
    assert.equal(
      createResponse.body.lobby.expiresAt,
      new Date(TEST_NOW.getTime() + 48 * 60 * 60 * 1_000).toISOString(),
    )
    assert.deepEqual(
      createResponse.body.lobby.players.map(
        (player: { name: string; role: string }) => ({
          name: player.name,
          role: player.role,
        }),
      ),
      [{ name: 'Morgan', role: 'host' }],
    )
    assert.equal(createResponse.body.session.lobbyCode, 'ABCDE')
    assert.equal(createResponse.body.session.role, 'host')
    assert.ok(createResponse.body.session.token)

    const getResponse = await request(app)
      .get('/api/lobbies/abcde')
      .expect(200)

    assert.equal(getResponse.headers['cache-control'], 'no-store')
    assert.equal(getResponse.body.lobby.code, 'ABCDE')
    assert.equal(getResponse.body.lobby.players.length, 1)
  })

  it('joins a lobby and rejects a duplicate name', async () => {
    const app = makeApp('FGHJK')
    await request(app)
      .post('/api/lobbies')
      .send({ hostName: 'Host' })
      .expect(201)

    const joinResponse = await request(app)
      .post('/api/lobbies/fghjk/players')
      .send({ name: '  Taylor  Reed ' })
      .expect(201)

    assert.equal(joinResponse.body.session.role, 'player')
    assert.deepEqual(
      joinResponse.body.lobby.players.map(
        (player: { name: string }) => player.name,
      ),
      ['Host', 'Taylor Reed'],
    )

    const duplicateResponse = await request(app)
      .post('/api/lobbies/FGHJK/players')
      .send({ name: 'taylor reed' })
      .expect(409)

    assert.equal(duplicateResponse.body.error.code, 'PLAYER_NAME_TAKEN')
  })

  it('only lets the host remove joined players', async () => {
    const app = makeApp('HJKLM')
    const createResponse = await request(app)
      .post('/api/lobbies')
      .send({ hostName: 'Host' })
      .expect(201)
    const joinResponse = await request(app)
      .post('/api/lobbies/HJKLM/players')
      .send({ name: 'Taylor' })
      .expect(201)
    const host = createResponse.body.session
    const player = joinResponse.body.session

    const missingTokenResponse = await request(app)
      .delete(`/api/lobbies/HJKLM/players/${player.playerId}`)
      .expect(401)
    assert.equal(
      missingTokenResponse.body.error.code,
      'SESSION_UNAUTHORIZED',
    )

    const invalidTokenResponse = await request(app)
      .delete(`/api/lobbies/HJKLM/players/${player.playerId}`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401)
    assert.equal(
      invalidTokenResponse.body.error.code,
      'SESSION_UNAUTHORIZED',
    )

    const playerTokenResponse = await request(app)
      .delete(`/api/lobbies/HJKLM/players/${player.playerId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(403)
    assert.equal(playerTokenResponse.body.error.code, 'HOST_ONLY')

    const hostRemovalResponse = await request(app)
      .delete(`/api/lobbies/HJKLM/players/${host.playerId}`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(400)
    assert.equal(
      hostRemovalResponse.body.error.code,
      'HOST_CANNOT_BE_REMOVED',
    )

    const removeResponse = await request(app)
      .delete(`/api/lobbies/HJKLM/players/${player.playerId}`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200)

    assert.deepEqual(
      removeResponse.body.lobby.players.map(
        (lobbyPlayer: { name: string }) => lobbyPlayer.name,
      ),
      ['Host'],
    )

    const getResponse = await request(app)
      .get('/api/lobbies/HJKLM')
      .expect(200)
    assert.deepEqual(
      getResponse.body.lobby.players.map(
        (lobbyPlayer: { name: string }) => lobbyPlayer.name,
      ),
      ['Host'],
    )
  })

  it('lets the host remove a player during a game and continue rounds', async () => {
    const app = makeApp('JKLMN')
    const createResponse = await request(app)
      .post('/api/lobbies')
      .send({ hostName: 'Host' })
      .expect(201)
    const firstJoinResponse = await request(app)
      .post('/api/lobbies/JKLMN/players')
      .send({ name: 'Taylor' })
      .expect(201)
    const secondJoinResponse = await request(app)
      .post('/api/lobbies/JKLMN/players')
      .send({ name: 'Casey' })
      .expect(201)
    const host = createResponse.body.session
    const firstPlayer = firstJoinResponse.body.session
    const departingPlayer = secondJoinResponse.body.session

    const startResponse = await request(app)
      .post('/api/lobbies/JKLMN/game')
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200)
    const runId = startResponse.body.lobby.game.runId

    for (const [token, numberCard] of [
      [host.token, 1],
      [firstPlayer.token, 2],
      [departingPlayer.token, 3],
    ] as const) {
      await request(app)
        .put('/api/lobbies/JKLMN/game/hand')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Game-Run-Id', runId)
        .send({
          numberCards: [numberCard],
          modifiers: [],
          busted: false,
          ready: true,
        })
        .expect(200)
    }

    await request(app)
      .post('/api/lobbies/JKLMN/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(200)

    for (const [token, numberCard] of [
      [host.token, 4],
      [firstPlayer.token, 5],
    ] as const) {
      await request(app)
        .put('/api/lobbies/JKLMN/game/hand')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Game-Run-Id', runId)
        .send({
          numberCards: [numberCard],
          modifiers: [],
          busted: false,
          ready: true,
        })
        .expect(200)
    }

    const blockedRoundResponse = await request(app)
      .post('/api/lobbies/JKLMN/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(409)
    assert.equal(blockedRoundResponse.body.error.code, 'HANDS_NOT_READY')

    const removeResponse = await request(app)
      .delete(
        `/api/lobbies/JKLMN/players/${departingPlayer.playerId}`,
      )
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200)

    assert.deepEqual(
      removeResponse.body.lobby.players.map(
        (lobbyPlayer: { name: string }) => lobbyPlayer.name,
      ),
      ['Host', 'Taylor'],
    )
    assert.deepEqual(
      removeResponse.body.lobby.game.rounds[0].scores.map(
        (score: { playerName: string }) => score.playerName,
      ),
      ['Host', 'Taylor', 'Casey'],
    )

    await request(app)
      .put('/api/lobbies/JKLMN/game/hand')
      .set('Authorization', `Bearer ${departingPlayer.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [6],
        modifiers: [],
        busted: false,
        ready: true,
      })
      .expect(401)

    const continuedRoundResponse = await request(app)
      .post('/api/lobbies/JKLMN/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(200)

    assert.equal(continuedRoundResponse.body.lobby.game.roundNumber, 3)
    assert.deepEqual(
      continuedRoundResponse.body.lobby.game.rounds[1].scores.map(
        (score: { playerName: string }) => score.playerName,
      ),
      ['Host', 'Taylor'],
    )
  })

  it('starts a game and totals rounds until a player reaches 200', async () => {
    const app = makeApp('MNPQR')
    const createResponse = await request(app)
      .post('/api/lobbies')
      .send({ hostName: 'Morgan' })
      .expect(201)
    const joinResponse = await request(app)
      .post('/api/lobbies/MNPQR/players')
      .send({ name: 'Taylor' })
      .expect(201)
    const host = createResponse.body.session
    const player = joinResponse.body.session

    const playerStartResponse = await request(app)
      .post('/api/lobbies/MNPQR/game')
      .set('Authorization', `Bearer ${player.token}`)
      .expect(403)
    assert.equal(playerStartResponse.body.error.code, 'HOST_ONLY')

    const startResponse = await request(app)
      .post('/api/lobbies/MNPQR/game')
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200)
    const runId = startResponse.body.lobby.game.runId

    assert.equal(startResponse.body.lobby.status, 'active')
    assert.equal(startResponse.body.lobby.game.roundNumber, 1)
    assert.deepEqual(
      startResponse.body.lobby.players.map(
        (lobbyPlayer: { score: number }) => lobbyPlayer.score,
      ),
      [0, 0],
    )

    const lateJoinResponse = await request(app)
      .post('/api/lobbies/MNPQR/players')
      .send({ name: 'Casey' })
      .expect(409)
    assert.equal(lateJoinResponse.body.error.code, 'LOBBY_ALREADY_STARTED')

    const unauthorizedHandResponse = await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12],
        modifiers: [],
        busted: false,
        ready: false,
      })
      .expect(401)
    assert.equal(
      unauthorizedHandResponse.body.error.code,
      'SESSION_UNAUTHORIZED',
    )

    const duplicateCardResponse = await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12, 12],
        modifiers: [],
        busted: false,
        ready: false,
      })
      .expect(400)
    assert.equal(duplicateCardResponse.body.error.code, 'INVALID_REQUEST')

    const hostHandResponse = await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12, 11, 10, 9, 8, 7],
        modifiers: ['times-2', 'plus-6'],
        busted: false,
        ready: true,
      })
      .expect(200)
    const hostView = hostHandResponse.body.lobby.players.find(
      (lobbyPlayer: { id: string }) => lobbyPlayer.id === host.playerId,
    )
    assert.equal(hostView.hand.points, 120)
    assert.deepEqual(hostView.hand.numberCards, [12, 11, 10, 9, 8, 7])
    assert.equal(hostView.hand.ready, true)

    const incompleteRoundResponse = await request(app)
      .post('/api/lobbies/MNPQR/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(409)
    assert.equal(incompleteRoundResponse.body.error.code, 'HANDS_NOT_READY')

    const playerHandResponse = await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('Authorization', `Bearer ${player.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12, 11, 10, 9],
        modifiers: ['times-2', 'plus-6'],
        busted: false,
        ready: true,
      })
      .expect(200)
    const playerView = playerHandResponse.body.lobby.players.find(
      (lobbyPlayer: { id: string }) => lobbyPlayer.id === player.playerId,
    )
    assert.equal(playerView.hand.points, 90)

    const getHandsResponse = await request(app)
      .get('/api/lobbies/MNPQR')
      .expect(200)
    assert.deepEqual(
      getHandsResponse.body.lobby.players.map(
        (lobbyPlayer: { hand: { points: number; ready: boolean } }) => ({
          points: lobbyPlayer.hand.points,
          ready: lobbyPlayer.hand.ready,
        }),
      ),
      [
        { points: 120, ready: true },
        { points: 90, ready: true },
      ],
    )

    const playerRoundResponse = await request(app)
      .post('/api/lobbies/MNPQR/game/rounds')
      .set('Authorization', `Bearer ${player.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(403)
    assert.equal(playerRoundResponse.body.error.code, 'HOST_ONLY')

    const firstRoundResponse = await request(app)
      .post('/api/lobbies/MNPQR/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(200)

    assert.equal(firstRoundResponse.body.lobby.status, 'active')
    assert.equal(firstRoundResponse.body.lobby.game.roundNumber, 2)
    assert.deepEqual(
      firstRoundResponse.body.lobby.players.map(
        (lobbyPlayer: { score: number }) => lobbyPlayer.score,
      ),
      [120, 90],
    )
    assert.deepEqual(firstRoundResponse.body.lobby.game.rounds[0].scores[0].hand, {
      numberCards: [12, 11, 10, 9, 8, 7],
      modifiers: ['times-2', 'plus-6'],
      busted: false,
    })

    await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12, 11, 10],
        modifiers: ['times-2', 'plus-8'],
        busted: false,
        ready: true,
      })
      .expect(200)
    await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('Authorization', `Bearer ${player.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12, 11, 10, 9, 8, 7],
        modifiers: ['times-2', 'plus-2'],
        busted: false,
        ready: true,
      })
      .expect(200)

    const finalRoundResponse = await request(app)
      .post('/api/lobbies/MNPQR/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(200)

    assert.equal(finalRoundResponse.body.lobby.status, 'finished')
    assert.equal(finalRoundResponse.body.lobby.game.rounds.length, 2)
    assert.deepEqual(finalRoundResponse.body.lobby.game.winnerIds, [
      player.playerId,
    ])
    assert.deepEqual(
      finalRoundResponse.body.lobby.players.map(
        (lobbyPlayer: { score: number }) => lobbyPlayer.score,
      ),
      [194, 206],
    )

    const playerUndoResponse = await request(app)
      .delete('/api/lobbies/MNPQR/game/rounds/latest')
      .set('Authorization', `Bearer ${player.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(403)
    assert.equal(playerUndoResponse.body.error.code, 'HOST_ONLY')

    const undoResponse = await request(app)
      .delete('/api/lobbies/MNPQR/game/rounds/latest')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(200)

    assert.equal(undoResponse.body.lobby.status, 'active')
    assert.equal(undoResponse.body.lobby.game.roundNumber, 2)
    assert.equal(undoResponse.body.lobby.game.rounds.length, 1)
    assert.deepEqual(
      undoResponse.body.lobby.players.map(
        (lobbyPlayer: {
          score: number
          hand: { points: number; ready: boolean }
        }) => ({
          score: lobbyPlayer.score,
          roundPoints: lobbyPlayer.hand.points,
          ready: lobbyPlayer.hand.ready,
        }),
      ),
      [
        { score: 120, roundPoints: 74, ready: false },
        { score: 90, roundPoints: 116, ready: false },
      ],
    )

    await request(app)
      .put('/api/lobbies/MNPQR/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .send({
        numberCards: [12],
        modifiers: [],
        busted: false,
        ready: false,
      })
      .expect(200)

    const inProgressUndoResponse = await request(app)
      .delete('/api/lobbies/MNPQR/game/rounds/latest')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', runId)
      .expect(409)
    assert.equal(
      inProgressUndoResponse.body.error.code,
      'ROUND_IN_PROGRESS',
    )
  })

  it('continues when the leading players are tied above 200', async () => {
    const repository = new InMemoryLobbyRepository()
    const service = new LobbyService(
      repository,
      () => new Date(TEST_NOW),
      () => 'NPQRS',
    )
    const host = (await service.createLobby('Morgan')).session
    const player = (await service.joinLobby('NPQRS', 'Taylor')).session
    const startedLobby = await service.startGame('NPQRS', host.token)
    const runId = startedLobby.game?.runId ?? ''

    const score120 = {
      numberCards: [12, 11, 10, 9, 8, 7],
      modifiers: ['times-2' as const, 'plus-6' as const],
      busted: false,
      ready: true,
    }

    for (let round = 0; round < 2; round += 1) {
      await service.updateHand('NPQRS', score120, host.token, runId)
      await service.updateHand('NPQRS', score120, player.token, runId)
      await service.recordRound('NPQRS', host.token, runId)
    }

    const tiedLobby = await service.getLobby('NPQRS')
    assert.equal(tiedLobby.status, 'active')
    assert.equal(tiedLobby.game?.roundNumber, 3)
    assert.deepEqual(tiedLobby.game?.winnerIds, [])

    await service.updateHand(
      'NPQRS',
      { numberCards: [1], modifiers: [], busted: false, ready: true },
      host.token,
      runId,
    )
    await service.updateHand(
      'NPQRS',
      { numberCards: [0], modifiers: [], busted: false, ready: true },
      player.token,
      runId,
    )
    const finishedLobby = await service.recordRound(
      'NPQRS',
      host.token,
      runId,
    )

    assert.equal(finishedLobby.status, 'finished')
    assert.deepEqual(finishedLobby.game?.winnerIds, [host.playerId])
  })

  it('lets the host restart a game with the same players', async () => {
    const app = makeApp('RSTRT')
    const createResponse = await request(app)
      .post('/api/lobbies')
      .send({ hostName: 'Morgan' })
      .expect(201)
    const joinResponse = await request(app)
      .post('/api/lobbies/RSTRT/players')
      .send({ name: 'Taylor' })
      .expect(201)
    const host = createResponse.body.session
    const player = joinResponse.body.session

    const waitingRestartResponse = await request(app)
      .post('/api/lobbies/RSTRT/game/restart')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', 'not-started')
      .expect(409)
    assert.equal(waitingRestartResponse.body.error.code, 'GAME_NOT_STARTED')

    const startResponse = await request(app)
      .post('/api/lobbies/RSTRT/game')
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200)
    const firstRunId = startResponse.body.lobby.game.runId

    const legacyBustResponse = await request(app)
      .put('/api/lobbies/RSTRT/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        numberCards: [12],
        modifiers: [],
        busted: true,
        ready: false,
      })
      .expect(200)
    assert.equal(
      legacyBustResponse.body.lobby.players[0].hand.busted,
      true,
    )

    const legacyScoringResponse = await request(app)
      .put('/api/lobbies/RSTRT/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        numberCards: [12],
        modifiers: [],
        busted: false,
        ready: false,
      })
      .expect(200)
    assert.deepEqual(
      legacyScoringResponse.body.lobby.players[0].hand.numberCards,
      [12],
    )
    assert.equal(
      legacyScoringResponse.body.lobby.players[0].hand.busted,
      false,
    )

    for (const session of [host, player]) {
      await request(app)
        .put('/api/lobbies/RSTRT/game/hand')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Game-Run-Id', firstRunId)
        .send({
          numberCards: [12],
          modifiers: [],
          busted: false,
          ready: true,
        })
        .expect(200)
    }
    await request(app)
      .post('/api/lobbies/RSTRT/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', firstRunId)
      .expect(200)
    await request(app)
      .put('/api/lobbies/RSTRT/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', firstRunId)
      .send({
        numberCards: [7],
        modifiers: ['plus-2'],
        busted: false,
        ready: false,
      })
      .expect(200)

    const playerRestartResponse = await request(app)
      .post('/api/lobbies/RSTRT/game/restart')
      .set('Authorization', `Bearer ${player.token}`)
      .set('X-Game-Run-Id', firstRunId)
      .expect(403)
    assert.equal(playerRestartResponse.body.error.code, 'HOST_ONLY')

    const restartResponse = await request(app)
      .post('/api/lobbies/RSTRT/game/restart')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', firstRunId)
      .expect(200)
    const restartedRunId = restartResponse.body.lobby.game.runId

    assert.equal(restartResponse.body.lobby.status, 'active')
    assert.equal(restartResponse.body.lobby.game.roundNumber, 1)
    assert.equal(restartResponse.body.lobby.game.rounds.length, 0)
    assert.notEqual(restartResponse.body.lobby.game.runId, firstRunId)
    assert.deepEqual(
      restartResponse.body.lobby.players.map(
        (lobbyPlayer: {
          name: string
          score: number
          hand: {
            numberCards: number[]
            modifiers: string[]
            points: number
            ready: boolean
            updatedAt: string | null
          }
        }) => ({
          name: lobbyPlayer.name,
          score: lobbyPlayer.score,
          hand: lobbyPlayer.hand,
        }),
      ),
      [
        {
          name: 'Morgan',
          score: 0,
          hand: {
            numberCards: [],
            modifiers: [],
            busted: false,
            points: 0,
            hasFlip7: false,
            ready: false,
            updatedAt: null,
          },
        },
        {
          name: 'Taylor',
          score: 0,
          hand: {
            numberCards: [],
            modifiers: [],
            busted: false,
            points: 0,
            hasFlip7: false,
            ready: false,
            updatedAt: null,
          },
        },
      ],
    )

    const staleRestartResponse = await request(app)
      .post('/api/lobbies/RSTRT/game/restart')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', firstRunId)
      .expect(409)
    assert.equal(staleRestartResponse.body.error.code, 'GAME_RUN_CHANGED')

    const staleLegacyHandResponse = await request(app)
      .put('/api/lobbies/RSTRT/game/hand')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        numberCards: [7],
        modifiers: [],
        busted: false,
        ready: true,
      })
      .expect(409)
    assert.equal(
      staleLegacyHandResponse.body.error.code,
      'GAME_RUN_CHANGED',
    )

    for (const session of [host, player]) {
      await request(app)
        .put('/api/lobbies/RSTRT/game/hand')
        .set('Authorization', `Bearer ${session.token}`)
        .set('X-Game-Run-Id', restartedRunId)
        .send({
          numberCards: [1],
          modifiers: [],
          busted: false,
          ready: true,
        })
        .expect(200)
    }
    const newFirstRoundResponse = await request(app)
      .post('/api/lobbies/RSTRT/game/rounds')
      .set('Authorization', `Bearer ${host.token}`)
      .set('X-Game-Run-Id', restartedRunId)
      .expect(200)

    assert.equal(newFirstRoundResponse.body.lobby.game.rounds.length, 1)
    assert.equal(newFirstRoundResponse.body.lobby.game.rounds[0].number, 1)
    assert.deepEqual(
      newFirstRoundResponse.body.lobby.game.rounds[0].scores.map(
        (score: { points: number }) => score.points,
      ),
      [1, 1],
    )
  })

  it('returns useful errors for invalid and unknown lobbies', async () => {
    const app = makeApp()
    const invalidResponse = await request(app)
      .post('/api/lobbies')
      .send({ hostName: '' })
      .expect(400)

    assert.equal(invalidResponse.body.error.code, 'INVALID_REQUEST')

    const missingResponse = await request(app)
      .get('/api/lobbies/ZZZZZ')
      .expect(404)

    assert.equal(missingResponse.body.error.code, 'LOBBY_NOT_FOUND')
  })

  it('gives late-joining player records the lobby expiration', async () => {
    const repository = new InMemoryLobbyRepository()
    let now = new Date(TEST_NOW)
    const service = new LobbyService(
      repository,
      () => new Date(now),
      () => 'KLMNP',
    )

    await service.createLobby('Host')
    now = new Date(TEST_NOW.getTime() + 47 * 60 * 60 * 1_000)
    await service.joinLobby('KLMNP', 'Late player')

    const storedLobby = await repository.getLobby('KLMNP')
    const latePlayer = storedLobby?.players.find(
      (player) => player.name === 'Late player',
    )

    assert.equal(latePlayer?.expiresAt, storedLobby?.lobby.expiresAt)
  })
})