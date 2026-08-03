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
  GameStateConflictError,
  LobbyCodeConflictError,
  PlayerNameConflictError,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type RoundRecord,
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
    const rounds: RoundRecord[] = []
    const playerEntities = this.client.listEntities<PlayerRecord>({
      queryOptions: {
        filter: odata`PartitionKey eq ${code} and type eq ${'player'}`,
      },
    })

    for await (const entity of playerEntities) {
      players.push(toPlayerRecord(entity))
    }

    const roundEntities = this.client.listEntities<RoundRecord>({
      queryOptions: {
        filter: odata`PartitionKey eq ${code} and type eq ${'round'}`,
      },
    })

    for await (const entity of roundEntities) {
      rounds.push(toRoundRecord(entity))
    }

    players.sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))
    rounds.sort((left, right) => left.roundNumber - right.roundNumber)

    return {
      lobby: toLobbyRecord(lobbyEntity),
      players,
      rounds,
    }
  }

  async addPlayer(lobby: LobbyRecord, player: PlayerRecord): Promise<void> {
    const transaction = new TableTransaction()
    transaction.updateEntity(toTableEntity(lobby), 'Replace', {
      etag: requireEtag(lobby),
    })
    transaction.createEntity(toTableEntity(player))

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 409)) {
        throw new PlayerNameConflictError()
      }

      if (isStatus(error, 404) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async removePlayer(
    lobby: LobbyRecord,
    player: PlayerRecord,
  ): Promise<void> {
    const transaction = new TableTransaction()
    transaction.updateEntity(toTableEntity(lobby), 'Replace', {
      etag: requireEtag(lobby),
    })
    transaction.deleteEntity(player.lobbyCode, player.id)

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 409) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async deactivatePlayer(player: PlayerRecord): Promise<void> {
    try {
      await this.client.updateEntity(toTableEntity(player), 'Replace', {
        etag: requireEtag(player),
      })
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async updatePlayerHand(player: PlayerRecord): Promise<void> {
    try {
      await this.client.updateEntity(
        {
          partitionKey: player.lobbyCode,
          rowKey: player.id,
          handRoundNumber: player.handRoundNumber,
          handNumberCardsJson: player.handNumberCardsJson,
          handModifiersJson: player.handModifiersJson,
          handBusted: player.handBusted,
          handReady: player.handReady,
          handUpdatedAt: player.handUpdatedAt,
        },
        'Merge',
        { etag: requireEtag(player) },
      )
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async startGame(lobby: LobbyRecord): Promise<void> {
    try {
      await this.client.updateEntity(toTableEntity(lobby), 'Replace', {
        etag: requireEtag(lobby),
      })
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async restartGame(
    lobby: LobbyRecord,
    players: PlayerRecord[],
  ): Promise<void> {
    const transaction = new TableTransaction()
    transaction.updateEntity(toTableEntity(lobby), 'Replace', {
      etag: requireEtag(lobby),
    })

    for (const player of players) {
      transaction.updateEntity(toTableEntity(player), 'Replace', {
        etag: requireEtag(player),
      })
    }

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 409) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async recordRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const transaction = new TableTransaction()
    transaction.updateEntity(toTableEntity(lobby), 'Replace', {
      etag: requireEtag(lobby),
    })

    for (const player of players) {
      transaction.updateEntity(toTableEntity(player), 'Replace', {
        etag: requireEtag(player),
      })
    }

    transaction.createEntity(toTableEntity(round))

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 409) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async undoRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const transaction = new TableTransaction()
    transaction.updateEntity(toTableEntity(lobby), 'Replace', {
      etag: requireEtag(lobby),
    })

    for (const player of players) {
      transaction.updateEntity(toTableEntity(player), 'Replace', {
        etag: requireEtag(player),
      })
    }

    transaction.deleteEntity(round.lobbyCode, round.id)

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 409) || isStatus(error, 412)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async deleteExpiredLobbies(expiresBefore: Date): Promise<number> {
    const expiresBeforeIso = expiresBefore.toISOString()
    const expiredLobbies = this.client.listEntities<LobbyRecord>({
      queryOptions: {
        filter: odata`type eq ${'lobby'} and expiresAt le ${expiresBeforeIso}`,
      },
    })
    let deletedCount = 0

    for await (const lobby of expiredLobbies) {
      if (Date.parse(lobby.expiresAt) > expiresBefore.getTime()) {
        continue
      }

      await this.deleteLobbyPartition(lobby.lobbyCode)
      deletedCount += 1
    }

    return deletedCount
  }

  async close(): Promise<void> {
    return Promise.resolve()
  }

  private async deleteLobbyPartition(lobbyCode: string): Promise<void> {
    const rowKeys: string[] = []
    const entities = this.client.listEntities({
      queryOptions: {
        filter: odata`PartitionKey eq ${lobbyCode}`,
      },
    })

    for await (const entity of entities) {
      if (entity.rowKey) {
        rowKeys.push(entity.rowKey)
      }
    }

    rowKeys.sort(
      (left, right) => Number(left === 'lobby') - Number(right === 'lobby'),
    )

    for (let index = 0; index < rowKeys.length; index += 100) {
      const batch = rowKeys.slice(index, index + 100)
      const transaction = new TableTransaction()

      batch.forEach((rowKey) => transaction.deleteEntity(lobbyCode, rowKey))

      try {
        await this.client.submitTransaction(transaction.actions)
      } catch (error) {
        if (!isStatus(error, 404) && !isStatus(error, 409)) {
          throw error
        }

        for (const rowKey of batch) {
          try {
            await this.client.deleteEntity(lobbyCode, rowKey)
          } catch (deleteError) {
            if (!isStatus(deleteError, 404)) {
              throw deleteError
            }
          }
        }
      }
    }
  }
}

function toTableEntity<T extends LobbyRecord | PlayerRecord | RoundRecord>(
  record: T,
): TableEntity {
  const properties = { ...record }
  delete properties.etag
  return {
    ...properties,
    partitionKey: record.lobbyCode,
    rowKey: record.id,
  }
}

function requireEtag(record: { etag?: string }): string {
  if (!record.etag) {
    throw new GameStateConflictError()
  }

  return record.etag
}

function toLobbyRecord(entity: TableEntityResult<LobbyRecord>): LobbyRecord {
  return {
    etag: entity.etag,
    id: 'lobby',
    lobbyCode: entity.lobbyCode,
    type: 'lobby',
    status: entity.status,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
    gameId: entity.gameId ?? '',
    hasRestarted: entity.hasRestarted ?? false,
    currentRound: entity.currentRound ?? 0,
    startedAt: entity.startedAt ?? '',
    finishedAt: entity.finishedAt ?? '',
  }
}

function toPlayerRecord(entity: TableEntityResult<PlayerRecord>): PlayerRecord {
  return {
    etag: entity.etag,
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
    active: entity.active ?? true,
    score: entity.score ?? 0,
    handRoundNumber: entity.handRoundNumber ?? 0,
    handNumberCardsJson: entity.handNumberCardsJson ?? '[]',
    handModifiersJson: entity.handModifiersJson ?? '[]',
    handBusted: entity.handBusted ?? false,
    handReady: entity.handReady ?? false,
    handUpdatedAt: entity.handUpdatedAt ?? '',
  }
}

function toRoundRecord(entity: TableEntityResult<RoundRecord>): RoundRecord {
  return {
    etag: entity.etag,
    id: entity.id,
    lobbyCode: entity.lobbyCode,
    type: 'round',
    gameId: entity.gameId ?? '',
    roundNumber: entity.roundNumber,
    completedAt: entity.completedAt,
    scoresJson: entity.scoresJson,
    expiresAt: entity.expiresAt,
  }
}

function isStatus(error: unknown, statusCode: number): boolean {
  return error instanceof RestError && error.statusCode === statusCode
}