import {
  odata,
  RestError,
  TableClient,
  TableTransaction,
  type TableEntity,
  type TableEntityResult,
} from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'
import type { TableStorageSettings } from './config.js'
import {
  LobbyCodeConflictError,
  PlayerNameConflictError,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type StoredLobby,
} from './lobby-model.js'

export class TableLobbyRepository implements LobbyRepository {
  private readonly client: TableClient

  private constructor(client: TableClient) {
    this.client = client
  }

  static async connect(
    settings: TableStorageSettings,
  ): Promise<TableLobbyRepository> {
    const client = new TableClient(
      settings.endpoint,
      settings.tableName,
      new DefaultAzureCredential(),
    )
    await client.createTable()
    return new TableLobbyRepository(client)
  }

  async createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void> {
    const transaction = new TableTransaction()
    transaction.createEntity(toTableEntity(lobby))
    transaction.createEntity(toTableEntity(host))

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 409)) {
        throw new LobbyCodeConflictError()
      }

      throw error
    }
  }

  async getLobby(code: string): Promise<StoredLobby | null> {
    let lobbyEntity: TableEntityResult<LobbyRecord>

    try {
      lobbyEntity = await this.client.getEntity<LobbyRecord>(code, 'lobby')
    } catch (error) {
      if (isStatus(error, 404)) {
        return null
      }

      throw error
    }

    const players: PlayerRecord[] = []
    const playerEntities = this.client.listEntities<PlayerRecord>({
      queryOptions: {
        filter: odata`PartitionKey eq ${code} and type eq ${'player'}`,
      },
    })

    for await (const entity of playerEntities) {
      players.push(toPlayerRecord(entity))
    }

    players.sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))

    return {
      lobby: toLobbyRecord(lobbyEntity),
      players,
    }
  }

  async addPlayer(player: PlayerRecord): Promise<void> {
    try {
      await this.client.createEntity(toTableEntity(player))
    } catch (error) {
      if (isStatus(error, 409)) {
        throw new PlayerNameConflictError()
      }

      throw error
    }
  }

  async removePlayer(player: PlayerRecord): Promise<void> {
    try {
      await this.client.deleteEntity(player.lobbyCode, player.id)
    } catch (error) {
      if (!isStatus(error, 404)) {
        throw error
      }
    }
  }

  async close(): Promise<void> {
    return Promise.resolve()
  }
}

function toTableEntity<T extends LobbyRecord | PlayerRecord>(
  record: T,
): TableEntity<T> {
  return {
    ...record,
    partitionKey: record.lobbyCode,
    rowKey: record.id,
  }
}

function toLobbyRecord(entity: TableEntityResult<LobbyRecord>): LobbyRecord {
  return {
    id: 'lobby',
    lobbyCode: entity.lobbyCode,
    type: 'lobby',
    status: entity.status,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
  }
}

function toPlayerRecord(entity: TableEntityResult<PlayerRecord>): PlayerRecord {
  return {
    id: entity.id,
    lobbyCode: entity.lobbyCode,
    type: 'player',
    playerId: entity.playerId,
    name: entity.name,
    normalizedName: entity.normalizedName,
    role: entity.role,
    joinedAt: entity.joinedAt,
    tokenHash: entity.tokenHash,
    expiresAt: entity.expiresAt,
  }
}

function isStatus(error: unknown, statusCode: number): boolean {
  return error instanceof RestError && error.statusCode === statusCode
}