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

  async updatePlayerHand(player: PlayerRecord): Promise<void> {
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
    )
  }

  async startGame(lobby: LobbyRecord): Promise<void> {
    await this.client.updateEntity(toTableEntity(lobby), 'Replace')
  }

  async recordRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const transaction = new TableTransaction()
    transaction.updateEntity(toTableEntity(lobby), 'Replace')

    for (const player of players) {
      transaction.updateEntity(toTableEntity(player), 'Replace')
    }

    transaction.createEntity(toTableEntity(round))

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 409)) {
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
    transaction.updateEntity(toTableEntity(lobby), 'Replace')

    for (const player of players) {
      transaction.updateEntity(toTableEntity(player), 'Replace')
    }

    transaction.deleteEntity(round.lobbyCode, round.id)

    try {
      await this.client.submitTransaction(transaction.actions)
    } catch (error) {
      if (isStatus(error, 404) || isStatus(error, 409)) {
        throw new GameStateConflictError()
      }

      throw error
    }
  }

  async close(): Promise<void> {
    return Promise.resolve()
  }
}

function toTableEntity<T extends LobbyRecord | PlayerRecord | RoundRecord>(
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
    currentRound: entity.currentRound ?? 0,
    startedAt: entity.startedAt ?? '',
    finishedAt: entity.finishedAt ?? '',
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
    id: entity.id,
    lobbyCode: entity.lobbyCode,
    type: 'round',
    roundNumber: entity.roundNumber,
    completedAt: entity.completedAt,
    scoresJson: entity.scoresJson,
    expiresAt: entity.expiresAt,
  }
}

function isStatus(error: unknown, statusCode: number): boolean {
  return error instanceof RestError && error.statusCode === statusCode
}