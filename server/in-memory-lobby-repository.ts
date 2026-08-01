import {
  LobbyCodeConflictError,
  PlayerNameConflictError,
  type LobbyRecord,
  type LobbyRepository,
  type PlayerRecord,
  type StoredLobby,
} from './lobby-model.js'

export class InMemoryLobbyRepository implements LobbyRepository {
  private readonly lobbies = new Map<string, LobbyRecord>()
  private readonly players = new Map<string, Map<string, PlayerRecord>>()

  async createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void> {
    this.pruneExpired(lobby.lobbyCode)

    if (this.lobbies.has(lobby.lobbyCode)) {
      throw new LobbyCodeConflictError()
    }

    this.lobbies.set(lobby.lobbyCode, { ...lobby })
    this.players.set(lobby.lobbyCode, new Map([[host.id, { ...host }]]))
  }

  async getLobby(code: string): Promise<StoredLobby | null> {
    this.pruneExpired(code)
    const lobby = this.lobbies.get(code)

    if (!lobby) {
      return null
    }

    return {
      lobby: { ...lobby },
      players: [...(this.players.get(code)?.values() ?? [])].map((player) => ({
        ...player,
      })),
    }
  }

  async addPlayer(player: PlayerRecord): Promise<void> {
    this.pruneExpired(player.lobbyCode)
    const lobbyPlayers = this.players.get(player.lobbyCode)

    if (!lobbyPlayers) {
      throw new Error('Lobby does not exist')
    }

    if (lobbyPlayers.has(player.id)) {
      throw new PlayerNameConflictError()
    }

    lobbyPlayers.set(player.id, { ...player })
  }

  private pruneExpired(code: string): void {
    const lobby = this.lobbies.get(code)

    if (lobby && Date.parse(lobby.expiresAt) <= Date.now()) {
      this.lobbies.delete(code)
      this.players.delete(code)
    }
  }
}