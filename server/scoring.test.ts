import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateHandScore } from '../shared/scoring.js'

describe('Flip 7 hand scoring', () => {
  it('multiplies number cards before adding modifiers', () => {
    assert.deepEqual(
      calculateHandScore({
        numberCards: [12, 11, 5],
        modifiers: ['times-2', 'plus-4'],
        busted: false,
      }),
      {
        numberTotal: 28,
        modifierTotal: 4,
        hasMultiplier: true,
        hasFlip7: false,
        points: 60,
      },
    )
  })

  it('adds 15 points for seven unique number cards', () => {
    assert.equal(
      calculateHandScore({
        numberCards: [0, 1, 2, 3, 4, 5, 6],
        modifiers: ['plus-10'],
        busted: false,
      }).points,
      46,
    )
  })

  it('scores modifiers without number cards and zero after a bust', () => {
    assert.equal(
      calculateHandScore({
        numberCards: [],
        modifiers: ['plus-8'],
        busted: false,
      }).points,
      8,
    )
    assert.equal(
      calculateHandScore({
        numberCards: [12, 10],
        modifiers: ['times-2', 'plus-10'],
        busted: true,
      }).points,
      0,
    )
  })
})