import { resolve } from 'node:path'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createLobbyRepository } from './lobby-repository-factory.js'
import { LobbyService } from './lobby-service.js'

try {
  process.loadEnvFile()
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error
  }
}

const config = loadConfig()
const repository = await createLobbyRepository(config)
const lobbyService = new LobbyService(repository)
const app = createApp(lobbyService, {
  staticDirectory: resolve(process.cwd(), 'dist'),
})

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Flip Seven is listening on port ${config.port}`)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})