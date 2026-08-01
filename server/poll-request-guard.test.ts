import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PollRequestGuard } from '../src/lib/poll-request-guard.js'

describe('poll request ordering', () => {
  it('accepts only the latest request', () => {
    const guard = new PollRequestGuard()
    const firstRequest = guard.begin()
    const secondRequest = guard.begin()

    assert.equal(guard.isCurrent(firstRequest), false)
    assert.equal(guard.isCurrent(secondRequest), true)
  })

  it('rejects requests started before a mutation', () => {
    const guard = new PollRequestGuard()
    const pendingRequest = guard.begin()

    guard.invalidate()

    assert.equal(guard.isCurrent(pendingRequest), false)
    assert.equal(guard.isCurrent(guard.begin()), true)
  })
})