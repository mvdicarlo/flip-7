import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from './app.js'
import { InMemoryLobbyRepository } from './in-memory-lobby-repository.js'
import { LobbyService } from './lobby-service.js'

const TEST_NOW = new Date('2026-08-01T12:00:00.000Z')

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
    now = new Date(TEST_NOW.getTime() + 11 * 60 * 60 * 1_000)
    await service.joinLobby('KLMNP', 'Late player')

    const storedLobby = await repository.getLobby('KLMNP')
    const latePlayer = storedLobby?.players.find(
      (player) => player.name === 'Late player',
    )

    assert.equal(latePlayer?.expiresAt, storedLobby?.lobby.expiresAt)
  })
})