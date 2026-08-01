import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EXPIRED_LOBBY_CLEANUP_INTERVAL_MS,
  startExpiredLobbyCleanup,
} from './expired-lobby-cleanup.js'
import { InMemoryLobbyRepository } from './in-memory-lobby-repository.js'
import { LobbyService } from './lobby-service.js'

const TEST_NOW = new Date('2026-08-01T12:00:00.000Z')

class TrackingCleanupRepository extends InMemoryLobbyRepository {
  readonly cleanupDates: Date[] = []
  private releaseCleanup!: () => void
  private cleanupReleased = Promise.resolve()

  pauseCleanup(): void {
    this.cleanupReleased = new Promise<void>((resolve) => {
      this.releaseCleanup = resolve
    })
  }

  continueCleanup(): void {
    this.releaseCleanup()
  }

  override async deleteExpiredLobbies(expiresBefore: Date): Promise<number> {
    this.cleanupDates.push(expiresBefore)
    await this.cleanupReleased
    return 0
  }
}

describe('expired lobby cleanup', () => {
  it('deletes expired lobbies and retains newer lobbies', async () => {
    const repository = new InMemoryLobbyRepository()
    let now = new Date(TEST_NOW)
    const codes = ['ABCDE', 'FGHJK']
    const service = new LobbyService(
      repository,
      () => new Date(now),
      () => codes.shift() ?? 'KLMNP',
    )

    await service.createLobby('Expired host')
    now = new Date(TEST_NOW.getTime() + 24 * 60 * 60 * 1_000)
    await service.createLobby('Current host')

    const deletedCount = await repository.deleteExpiredLobbies(
      new Date(TEST_NOW.getTime() + 49 * 60 * 60 * 1_000),
    )

    assert.equal(deletedCount, 1)
    assert.equal(await repository.getLobby('ABCDE'), null)
    assert.ok(await repository.getLobby('FGHJK'))
  })

  it('runs immediately and schedules non-overlapping 12-hour checks', async () => {
    const repository = new TrackingCleanupRepository()
    repository.pauseCleanup()
    let scheduledCallback: (() => void) | undefined
    let scheduledInterval = 0
    let timerWasUnrefed = false
    let timerWasCancelled = false
    const timer = {
      unref: () => {
        timerWasUnrefed = true
      },
    }
    const cleanup = startExpiredLobbyCleanup(repository, {
      clock: () => new Date(TEST_NOW),
      schedule: (callback, intervalMs) => {
        scheduledCallback = callback
        scheduledInterval = intervalMs
        return timer
      },
      cancel: (scheduledTimer) => {
        assert.equal(scheduledTimer, timer)
        timerWasCancelled = true
      },
    })

    assert.equal(repository.cleanupDates.length, 1)
    scheduledCallback?.()
    assert.equal(repository.cleanupDates.length, 1)
    assert.equal(scheduledInterval, 12 * 60 * 60 * 1_000)
    assert.equal(scheduledInterval, EXPIRED_LOBBY_CLEANUP_INTERVAL_MS)
    assert.equal(timerWasUnrefed, true)

    repository.continueCleanup()
    await cleanup.run()
    scheduledCallback?.()
    await cleanup.run()
    assert.equal(repository.cleanupDates.length, 2)

    cleanup.stop()
    assert.equal(timerWasCancelled, true)
  })
})