import type { LobbyRepository } from './lobby-model.js'

export const EXPIRED_LOBBY_CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1_000

interface CleanupTimer {
  unref?: () => void
}

interface CleanupOptions {
  clock?: () => Date
  schedule?: (callback: () => void, intervalMs: number) => CleanupTimer
  cancel?: (timer: CleanupTimer) => void
  onError?: (error: unknown) => void
}

export interface ExpiredLobbyCleanup {
  run: () => Promise<void>
  stop: () => void
}

export function startExpiredLobbyCleanup(
  repository: LobbyRepository,
  options: CleanupOptions = {},
): ExpiredLobbyCleanup {
  const clock = options.clock ?? (() => new Date())
  const schedule =
    options.schedule ??
    ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel =
    options.cancel ??
    ((timer) => clearInterval(timer as ReturnType<typeof setInterval>))
  const onError =
    options.onError ??
    ((error) => console.error('Expired lobby cleanup failed.', error))
  let currentRun: Promise<void> | null = null

  const run = (): Promise<void> => {
    if (currentRun) {
      return currentRun
    }

    currentRun = repository
      .deleteExpiredLobbies(clock())
      .then((deletedCount) => {
        if (deletedCount > 0) {
          console.log(`Deleted ${deletedCount} expired Flip Seven lobbies.`)
        }
      })
      .catch(onError)
      .finally(() => {
        currentRun = null
      })

    return currentRun
  }

  void run()
  const timer = schedule(() => void run(), EXPIRED_LOBBY_CLEANUP_INTERVAL_MS)
  timer.unref?.()

  return {
    run,
    stop: () => cancel(timer),
  }
}