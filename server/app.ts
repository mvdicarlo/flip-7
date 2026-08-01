import { resolve } from 'node:path'
import express, { type ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import { z } from 'zod'
import type { ApiErrorEnvelope } from '../shared/contracts.js'
import { SCORE_MODIFIERS } from '../shared/scoring.js'
import { LobbyService, LobbyServiceError } from './lobby-service.js'

const playerNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a player name.')
  .max(24, 'Player names can be up to 24 characters.')
  .transform((name) => name.replace(/\s+/g, ' '))

const createLobbySchema = z.object({
  hostName: playerNameSchema,
})

const joinLobbySchema = z.object({
  name: playerNameSchema,
})

const lobbyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/,
    'Enter a valid 5-character lobby code.',
  )

const playerIdSchema = z.string().uuid('Enter a valid player ID.')

const handSchema = z.object({
  numberCards: z
    .array(z.number().int().min(0).max(12))
    .max(7)
    .refine((cards) => new Set(cards).size === cards.length, {
      message: 'Number cards must be unique.',
    }),
  modifiers: z
    .array(z.enum(SCORE_MODIFIERS))
    .max(SCORE_MODIFIERS.length)
    .refine((modifiers) => new Set(modifiers).size === modifiers.length, {
      message: 'Score modifiers must be unique.',
    }),
  busted: z.boolean(),
  ready: z.boolean(),
})

export interface AppOptions {
  staticDirectory?: string
}

export function createApp(
  lobbyService: LobbyService,
  options: AppOptions = {},
): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(express.json({ limit: '16kb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.post('/api/lobbies', async (request, response) => {
    const { hostName } = createLobbySchema.parse(request.body)
    const result = await lobbyService.createLobby(hostName)
    response.status(201).json(result)
  })

  app.get('/api/lobbies/:code', async (request, response) => {
    const code = lobbyCodeSchema.parse(request.params.code)
    const lobby = await lobbyService.getLobby(code)
    response.set('Cache-Control', 'no-store')
    response.json({ lobby })
  })

  app.post('/api/lobbies/:code/players', async (request, response) => {
    const code = lobbyCodeSchema.parse(request.params.code)
    const { name } = joinLobbySchema.parse(request.body)
    const result = await lobbyService.joinLobby(code, name)
    response.status(201).json(result)
  })

  app.delete('/api/lobbies/:code/players/:playerId', async (request, response) => {
    const code = lobbyCodeSchema.parse(request.params.code)
    const playerId = playerIdSchema.parse(request.params.playerId)
    const lobby = await lobbyService.removePlayer(
      code,
      playerId,
      bearerToken(request.headers.authorization),
    )
    response.json({ lobby })
  })

  app.post('/api/lobbies/:code/game', async (request, response) => {
    const code = lobbyCodeSchema.parse(request.params.code)
    const lobby = await lobbyService.startGame(
      code,
      bearerToken(request.headers.authorization),
    )
    response.json({ lobby })
  })

  app.put('/api/lobbies/:code/game/hand', async (request, response) => {
    const code = lobbyCodeSchema.parse(request.params.code)
    const hand = handSchema.parse(request.body)
    const lobby = await lobbyService.updateHand(
      code,
      hand,
      bearerToken(request.headers.authorization),
    )
    response.json({ lobby })
  })

  app.post('/api/lobbies/:code/game/rounds', async (request, response) => {
    const code = lobbyCodeSchema.parse(request.params.code)
    const lobby = await lobbyService.recordRound(
      code,
      bearerToken(request.headers.authorization),
    )
    response.json({ lobby })
  })

  app.delete(
    '/api/lobbies/:code/game/rounds/latest',
    async (request, response) => {
      const code = lobbyCodeSchema.parse(request.params.code)
      const lobby = await lobbyService.undoLastRound(
        code,
        bearerToken(request.headers.authorization),
      )
      response.json({ lobby })
    },
  )

  app.use('/api', (_request, response) => {
    response.status(404).json(
      apiError('API_ROUTE_NOT_FOUND', 'That API route does not exist.'),
    )
  })

  if (options.staticDirectory) {
    const staticDirectory = resolve(options.staticDirectory)
    app.use(express.static(staticDirectory, { index: false }))
    app.use((request, response, next) => {
      if (request.method === 'GET' && request.accepts('html')) {
        response.sendFile(resolve(staticDirectory, 'index.html'))
        return
      }

      next()
    })
  }

  app.use(errorHandler)
  return app
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next

  if (error instanceof z.ZodError) {
    response
      .status(400)
      .json(apiError('INVALID_REQUEST', error.issues[0]?.message ?? 'Invalid request.'))
    return
  }

  if (error instanceof LobbyServiceError) {
    response.status(error.status).json(apiError(error.code, error.message))
    return
  }

  console.error(error)
  response
    .status(500)
    .json(apiError('INTERNAL_ERROR', 'Something went wrong. Please try again.'))
}

function apiError(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } }
}

function bearerToken(authorization: string | undefined): string | undefined {
  const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? []

  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
    return undefined
  }

  return token
}