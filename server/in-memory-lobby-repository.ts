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
  private etag = 0

  async createLobby(lobby: LobbyRecord, host: PlayerRecord): Promise<void> {
    this.pruneExpired(lobby.lobbyCode)

    if (this.lobbies.has(lobby.lobbyCode)) {
      throw new LobbyCodeConflictError()
    }

    this.lobbies.set(lobby.lobbyCode, this.withNextEtag(lobby))
    this.players.set(
      lobby.lobbyCode,
      new Map([[host.id, this.withNextEtag(host)]]),
    )
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

  async addPlayer(lobby: LobbyRecord, player: PlayerRecord): Promise<void> {
    this.pruneExpired(player.lobbyCode)
    const lobbyPlayers = this.players.get(player.lobbyCode)
    const storedLobby = this.lobbies.get(player.lobbyCode)

    if (!lobbyPlayers || !storedLobby) {
      throw new Error('Lobby does not exist')
    }

    if (lobbyPlayers.has(player.id)) {
      throw new PlayerNameConflictError()
    }

    this.requireMatchingEtag(storedLobby, lobby)
    this.lobbies.set(player.lobbyCode, this.withNextEtag(storedLobby))
    lobbyPlayers.set(player.id, this.withNextEtag(player))
  }

  async removePlayer(
    lobby: LobbyRecord,
    player: PlayerRecord,
  ): Promise<void> {
    const storedLobby = this.lobbies.get(player.lobbyCode)
    const lobbyPlayers = this.players.get(player.lobbyCode)
    const storedPlayer = lobbyPlayers?.get(player.id)

    if (!storedLobby || !lobbyPlayers || !storedPlayer) {
      throw new GameStateConflictError()
    }

    this.requireMatchingEtag(storedLobby, lobby)
    this.requireMatchingEtag(storedPlayer, player)
    this.lobbies.set(player.lobbyCode, this.withNextEtag(storedLobby))
    lobbyPlayers.delete(player.id)
  }

  async deactivatePlayer(player: PlayerRecord): Promise<void> {
    const lobbyPlayers = this.players.get(player.lobbyCode)

    if (!lobbyPlayers?.has(player.id)) {
      throw new Error('Player does not exist')
    }

    this.requireMatchingEtag(lobbyPlayers.get(player.id), player)
    lobbyPlayers.set(player.id, this.withNextEtag(player))
  }

  async updatePlayerHand(player: PlayerRecord): Promise<void> {
    const storedPlayer = this.players.get(player.lobbyCode)?.get(player.id)

    if (!storedPlayer) {
      throw new Error('Player does not exist')
    }

    this.requireMatchingEtag(storedPlayer, player)
    Object.assign(storedPlayer, {
      handRoundNumber: player.handRoundNumber,
      handNumberCardsJson: player.handNumberCardsJson,
      handModifiersJson: player.handModifiersJson,
      handBusted: player.handBusted,
      handReady: player.handReady,
      handUpdatedAt: player.handUpdatedAt,
      etag: this.nextEtag(),
    })
  }

  async startGame(lobby: LobbyRecord): Promise<void> {
    const storedLobby = this.lobbies.get(lobby.lobbyCode)

    if (!storedLobby) {
      throw new GameStateConflictError()
    }

    this.requireMatchingEtag(storedLobby, lobby)
    this.lobbies.set(lobby.lobbyCode, this.withNextEtag(lobby))
  }

  async recordRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const lobbyRounds = this.rounds.get(lobby.lobbyCode)
    const storedLobby = this.lobbies.get(lobby.lobbyCode)
    const storedPlayers = this.players.get(lobby.lobbyCode)

    if (!lobbyRounds || !storedLobby || !storedPlayers || lobbyRounds.has(round.id)) {
      throw new GameStateConflictError()
    }

    this.requireMatchingEtag(storedLobby, lobby)
    this.requireMatchingPlayers(storedPlayers, players)
    this.lobbies.set(lobby.lobbyCode, this.withNextEtag(lobby))
    this.players.set(
      lobby.lobbyCode,
      new Map(
        players.map((player) => [player.id, this.withNextEtag(player)]),
      ),
    )
    lobbyRounds.set(round.id, this.withNextEtag(round))
  }

  async undoRound(
    lobby: LobbyRecord,
    players: PlayerRecord[],
    round: RoundRecord,
  ): Promise<void> {
    const lobbyRounds = this.rounds.get(lobby.lobbyCode)
    const storedLobby = this.lobbies.get(lobby.lobbyCode)
    const storedPlayers = this.players.get(lobby.lobbyCode)

    if (
      !lobbyRounds?.has(round.id) ||
      !storedLobby ||
      !storedPlayers
    ) {
      throw new GameStateConflictError()
    }

    this.requireMatchingEtag(storedLobby, lobby)
    this.requireMatchingPlayers(storedPlayers, players)
    this.lobbies.set(lobby.lobbyCode, this.withNextEtag(lobby))
    this.players.set(
      lobby.lobbyCode,
      new Map(
        players.map((player) => [player.id, this.withNextEtag(player)]),
      ),
    )
    lobbyRounds.delete(round.id)
  }

  async deleteExpiredLobbies(expiresBefore: Date): Promise<number> {
    let deletedCount = 0

    for (const [code, lobby] of this.lobbies) {
      if (Date.parse(lobby.expiresAt) <= expiresBefore.getTime()) {
        this.deleteLobby(code)
        deletedCount += 1
      }
    }

    return deletedCount
  }

  async close(): Promise<void> {
    return Promise.resolve()
  }

  private requireMatchingPlayers(
    storedPlayers: Map<string, PlayerRecord>,
    players: PlayerRecord[],
  ): void {
    if (storedPlayers.size !== players.length) {
      throw new GameStateConflictError()
    }

    players.forEach((player) =>
      this.requireMatchingEtag(storedPlayers.get(player.id), player),
    )
  }

  private requireMatchingEtag(
    stored: { etag?: string } | undefined,
    candidate: { etag?: string },
  ): void {
    if (!stored?.etag || !candidate.etag || stored.etag !== candidate.etag) {
      throw new GameStateConflictError()
    }
  }

  private withNextEtag<T extends object>(record: T): T & { etag: string } {
    return { ...record, etag: this.nextEtag() }
  }

  private nextEtag(): string {
    this.etag += 1
    return String(this.etag)
  }

  private pruneExpired(code: string): void {
    const lobby = this.lobbies.get(code)

    if (lobby && Date.parse(lobby.expiresAt) <= Date.now()) {
      this.deleteLobby(code)
    }
  }

  private deleteLobby(code: string): void {
    this.lobbies.delete(code)
    this.players.delete(code)
    this.rounds.delete(code)
  }
}