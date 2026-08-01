import { CosmosClient, type Container } from '@azure/cosmos'
import { DefaultAzureCredential } from '@azure/identity'
import type { CosmosSettings } from './config.js'
import {
  LobbyCodeConflictError,
  PlayerNameConflictError,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type StoredLobby,
} from './lobby-model.js'

export class CosmosLobbyRepository implements LobbyRepository {
  private readonly container: Container

  private constructor(container: Container) {
    this.container = container
  }

  static async connect(
    settings: CosmosSettings,
  ): Promise<CosmosLobbyRepository> {
    const client = new CosmosClient(
      settings.key
        ? { endpoint: settings.endpoint, key: settings.key }
        : {
            endpoint: settings.endpoint,
            aadCredentials: new DefaultAzureCredential(),
          },
    )

    if (settings.autoCreate) {
      const { database } = await client.databases.createIfNotExists({
        id: settings.databaseId,
      })
      const { container } = await database.containers.createIfNotExists({
        id: settings.containerId,
        partitionKey: { paths: ['/lobbyCode'] },
        defaultTtl: -1,
      })

      return new CosmosLobbyRepository(container)
    }

    const container = client
      .database(settings.databaseId)
      .container(settings.containerId)
    await container.read()
    return new CosmosLobbyRepository(container)
  }

  async createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void> {
    try {
      await this.container.items.create(lobby)
    } catch (error) {
      if (isConflict(error)) {
        throw new LobbyCodeConflictError()
      }

      throw error
    }

    try {
      await this.container.items.create(host)
    } catch (error) {
      await this.container.item(lobby.id, lobby.lobbyCode).delete().catch(() => undefined)
      throw error
    }
  }

  async getLobby(code: string): Promise<StoredLobby | null> {
    const { resource: lobby } = await this.container
      .item('lobby', code)
      .read<LobbyRecord>()

    if (!lobby) {
      return null
    }

    const { resources: players } = await this.container.items
      .query<PlayerRecord>(
        {
          query: 'SELECT * FROM player WHERE player.type = @type',
          parameters: [{ name: '@type', value: 'player' }],
        },
        { partitionKey: code },
      )
      .fetchAll()

    return { lobby, players }
  }

  async addPlayer(player: PlayerRecord): Promise<void> {
    try {
      await this.container.items.create(player)
    } catch (error) {
      if (isConflict(error)) {
        throw new PlayerNameConflictError()
      }

      throw error
    }
  }
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 409
  )
}