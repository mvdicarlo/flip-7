import type { ServerConfig } from './config.js'
import { CosmosLobbyRepository } from './cosmos-lobby-repository.js'
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

  return CosmosLobbyRepository.connect(config.cosmos)
}