import type { HandSelection, ScoreModifier } from './contracts.js'

export const NUMBER_CARDS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const

export const SCORE_MODIFIERS: readonly ScoreModifier[] = [
  'plus-2',
  'plus-4',
  'plus-6',
  'plus-8',
  'plus-10',
  'times-2',
]

export const SCORE_MODIFIER_LABELS: Record<ScoreModifier, string> = {
  'plus-2': '+2',
  'plus-4': '+4',
  'plus-6': '+6',
  'plus-8': '+8',
  'plus-10': '+10',
  'times-2': 'x2',
}

const SCORE_MODIFIER_VALUES: Record<ScoreModifier, number> = {
  'plus-2': 2,
  'plus-4': 4,
  'plus-6': 6,
  'plus-8': 8,
  'plus-10': 10,
  'times-2': 0,
}

export interface HandScore {
  numberTotal: number
  modifierTotal: number
  hasMultiplier: boolean
  hasFlip7: boolean
  points: number
}

export function calculateHandScore(hand: HandSelection): HandScore {
  const numberTotal = hand.numberCards.reduce(
    (total, card) => total + card,
    0,
  )
  const modifierTotal = hand.modifiers.reduce(
    (total, modifier) => total + SCORE_MODIFIER_VALUES[modifier],
    0,
  )
  const hasMultiplier = hand.modifiers.includes('times-2')
  const hasFlip7 = new Set(hand.numberCards).size === 7
  const points = hand.busted
    ? 0
    : numberTotal * (hasMultiplier ? 2 : 1) +
      modifierTotal +
      (hasFlip7 ? 15 : 0)

  return {
    numberTotal,
    modifierTotal,
    hasMultiplier,
    hasFlip7,
    points,
  }
}