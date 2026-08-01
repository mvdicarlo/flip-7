import type { ServerConfig } from './config.js'
import { CosmosMongoLobbyRepository } from './cosmos-mongo-lobby-repository.js'
import { InMemoryLobbyRepository } from './in-memory-lobby-repository.js'
import type { LobbyRepository } from './lobby-model.js'

export async function createLobbyRepository(
  config: ServerConfig,
): Promise<LobbyRepository> {
  if (config.store === 'memory') {
    return new InMemoryLobbyRepository()
  }

  if (!config.cosmos) {
    throw new Error('Cosmos DB settings are missing')
  }

  return CosmosMongoLobbyRepository.connect(config.cosmos)
}