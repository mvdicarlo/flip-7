import type {
  ApiErrorEnvelope,
  HandSelection,
  LobbyEnvelope,
  LobbySessionEnvelope,
  LobbyView,
} from '../../shared/contracts'

export class ApiClientError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
  }
}

export async function createLobby(
  hostName: string,
): Promise<LobbySessionEnvelope> {
  return apiRequest<LobbySessionEnvelope>('/api/lobbies', {
    method: 'POST',
    body: JSON.stringify({ hostName }),
  })
}

export async function joinLobby(
  code: string,
  name: string,
): Promise<LobbySessionEnvelope> {
  return apiRequest<LobbySessionEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}/players`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  )
}

export async function getLobby(code: string): Promise<LobbyView> {
  const result = await apiRequest<LobbyEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}`,
  )
  return result.lobby
}

export async function removeLobbyPlayer(
  code: string,
  playerId: string,
  token: string,
): Promise<LobbyView> {
  const result = await apiRequest<LobbyEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}/players/${encodeURIComponent(playerId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return result.lobby
}

export async function startLobbyGame(
  code: string,
  token: string,
): Promise<LobbyView> {
  const result = await apiRequest<LobbyEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}/game`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return result.lobby
}

export async function recordLobbyRound(
  code: string,
  token: string,
): Promise<LobbyView> {
  const result = await apiRequest<LobbyEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}/game/rounds`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return result.lobby
}

export async function undoLobbyRound(
  code: string,
  token: string,
): Promise<LobbyView> {
  const result = await apiRequest<LobbyEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}/game/rounds/latest`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return result.lobby
}

export async function updateLobbyHand(
  code: string,
  hand: HandSelection & { ready: boolean },
  token: string,
): Promise<LobbyView> {
  const result = await apiRequest<LobbyEnvelope>(
    `/api/lobbies/${encodeURIComponent(code)}/game/hand`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(hand),
    },
  )
  return result.lobby
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const apiError = payload as Partial<ApiErrorEnvelope> | null
    throw new ApiClientError(
      apiError?.error?.code ?? 'REQUEST_FAILED',
      apiError?.error?.message ?? 'Something went wrong. Please try again.',
    )
  }

  return payload as T
}