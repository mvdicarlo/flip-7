import {
  MongoClient,
  MongoServerError,
  type Collection,
  type Document,
} from 'mongodb'
import type { CosmosMongoSettings } from './config.js'
import {
  LobbyCodeConflictError,
  PlayerNameConflictError,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type StoredLobby,
} from './lobby-model.js'

export class CosmosMongoLobbyRepository implements LobbyRepository {
  private readonly client: MongoClient
  private readonly collection: Collection<Document>

  private constructor(
    client: MongoClient,
    collection: Collection<Document>,
  ) {
    this.client = client
    this.collection = collection
  }

  static async connect(
    settings: CosmosMongoSettings,
  ): Promise<CosmosMongoLobbyRepository> {
    const client = new MongoClient(settings.connectionString, {
      serverSelectionTimeoutMS: 10_000,
    })

    try {
      await client.connect()
      const database = client.db(settings.databaseId)
      await database.command({ ping: 1 })
      const collection = database.collection(settings.collectionId)
      await collection.createIndexes([
        {
          key: { lobbyCode: 1, id: 1 },
          name: 'lobby_document_identity',
          unique: true,
        },
        {
          key: { expiresAtDate: 1 },
          name: 'lobby_expiration',
          expireAfterSeconds: 0,
        },
      ])

      return new CosmosMongoLobbyRepository(client, collection)
    } catch (error) {
      await client.close()
      throw error
    }
  }

  async createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void> {
    try {
      await this.collection.insertOne(toMongoDocument(lobby))
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new LobbyCodeConflictError()
      }

      throw error
    }

    try {
      await this.collection.insertOne(toMongoDocument(host))
    } catch (error) {
      await this.collection.deleteOne({
        lobbyCode: lobby.lobbyCode,
        id: lobby.id,
      })

      if (isDuplicateKey(error)) {
        throw new LobbyCodeConflictError()
      }

      throw error
    }
  }

  async getLobby(code: string): Promise<StoredLobby | null> {
    const [lobbyDocument, playerDocuments] = await Promise.all([
      this.collection.findOne({ lobbyCode: code, id: 'lobby', type: 'lobby' }),
      this.collection
        .find({ lobbyCode: code, type: 'player' })
        .sort({ joinedAt: 1 })
        .toArray(),
    ])

    if (!lobbyDocument) {
      return null
    }

    return {
      lobby: fromMongoDocument<LobbyRecord>(lobbyDocument),
      players: playerDocuments.map((document) =>
        fromMongoDocument<PlayerRecord>(document),
      ),
    }
  }

  async addPlayer(player: PlayerRecord): Promise<void> {
    try {
      await this.collection.insertOne(toMongoDocument(player))
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new PlayerNameConflictError()
      }

      throw error
    }
  }

  async deleteLobby(code: string): Promise<void> {
    await this.collection.deleteMany({ lobbyCode: code })
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}

function toMongoDocument(record: LobbyRecord | PlayerRecord): Document {
  return {
    ...record,
    expiresAtDate: new Date(record.expiresAt),
  }
}

function fromMongoDocument<T>(document: Document): T {
  const record = { ...document }
  delete record._id
  delete record.expiresAtDate
  return record as T
}

function isDuplicateKey(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11_000
}