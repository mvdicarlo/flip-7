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

export class InMemoryLobbyRepository implements LobbyRepository {
  private readonly lobbies = new Map<string, LobbyRecord>()
  private readonly players = new Map<string, Map<string, PlayerRecord>>()
  private readonly rounds = new Map<string, Map<string, RoundRecord>>()

  async createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void> {
    this.pruneExpired(lobby.lobbyCode)

    if (this.lobbies.has(lobby.lobbyCode)) {
      throw new LobbyCodeConflictError()
    }

    this.lobbies.set(lobby.lobbyCode, { ...lobby })
    this.players.set(lobby.lobbyCode, new Map([[host.id, { ...host }]]))
    this.rounds.set(lobby.lobbyCode, new Map())
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
      rounds: [...(this.rounds.get(code)?.values() ?? [])].map((round) => ({
        ...round,
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

  async removePlayer(player: PlayerRecord): Promise<void> {
    this.players.get(player.lobbyCode)?.delete(player.id)
  }

  async deactivatePlayer(player: PlayerRecord): Promise<void> {
    const lobbyPlayers = this.players.get(player.lobbyCode)

    if (!lobbyPlayers?.has(player.id)) {
      throw new Error('Player does not exist')
    }

    lobbyPlayers.set(player.id, { ...player })
  }

  async updatePlayerHand(player: PlayerRecord): Promise<void> {
    const storedPlayer = this.players.get(player.lobbyCode)?.get(player.id)

    if (!storedPlayer) {
      throw new Error('Player does not exist')
    }

    Object.assign(storedPlayer, {
      handRoundNumber: player.handRoundNumber,
      handNumberCardsJson: player.handNumberCardsJson,
      handModifiersJson: player.handModifiersJson,
      handBusted: player.handBusted,
      handReady: player.handReady,
      handUpdatedAt: player.handUpdatedAt,
    })
  }

  async startGame(lobby: LobbyRecord): Promise<void> {
    this.lobbies.set(lobby.lobbyCode, { ...lobby })
  }

  async recordRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const lobbyRounds = this.rounds.get(lobby.lobbyCode)

    if (!lobbyRounds || lobbyRounds.has(round.id)) {
      throw new GameStateConflictError()
    }

    this.lobbies.set(lobby.lobbyCode, { ...lobby })
    this.players.set(
      lobby.lobbyCode,
      new Map(players.map((player) => [player.id, { ...player }])),
    )
    lobbyRounds.set(round.id, { ...round })
  }

  async undoRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const lobbyRounds = this.rounds.get(lobby.lobbyCode)

    if (!lobbyRounds?.has(round.id)) {
      throw new GameStateConflictError()
    }

    this.lobbies.set(lobby.lobbyCode, { ...lobby })
    this.players.set(
      lobby.lobbyCode,
      new Map(players.map((player) => [player.id, { ...player }])),
    )
    lobbyRounds.delete(round.id)
  }

  async close(): Promise<void> {
    return Promise.resolve()
  }

  private pruneExpired(code: string): void {
    const lobby = this.lobbies.get(code)

    if (lobby && Date.parse(lobby.expiresAt) <= Date.now()) {
      this.lobbies.delete(code)
      this.players.delete(code)
      this.rounds.delete(code)
    }
  }
}