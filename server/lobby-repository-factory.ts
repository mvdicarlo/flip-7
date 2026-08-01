import type { ServerConfig } from './config.js'
import { InMemoryLobbyRepository } from './in-memory-lobby-repository.js'
import type { LobbyRepository } from './lobby-model.js'
import { TableLobbyRepository } from './table-lobby-repository.js'

export async function createLobbyRepository(
  config: ServerConfig,
): Promise<LobbyRepository> {
  if (config.store === 'memory') {
    return new InMemoryLobbyRepository()
  }

  if (!config.tableStorage) {
    throw new Error('Azure Table Storage settings are missing')
  }

  return TableLobbyRepository.connect(config.tableStorage)
}