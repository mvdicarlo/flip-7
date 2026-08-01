export type LobbyStore = 'memory' | 'table'

export interface TableStorageSettings {
  endpoint: string
  tableName: string
}

export interface ServerConfig {
  port: number
  store: LobbyStore
  tableStorage?: TableStorageSettings
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const store = getStore(environment)
  const port = getPort(environment.PORT)

  if (store === 'memory') {
    return { port, store }
  }

  return {
    port,
    store,
    tableStorage: {
      endpoint: required(environment, 'AZURE_STORAGE_TABLE_ENDPOINT'),
      tableName: environment.AZURE_STORAGE_TABLE_NAME?.trim() || 'lobbies',
    },
  }
}

function getStore(environment: NodeJS.ProcessEnv): LobbyStore {
  const value =
    environment.LOBBY_STORE ??
    (environment.NODE_ENV === 'production' ? 'table' : 'memory')

  if (value !== 'memory' && value !== 'table') {
    throw new Error('LOBBY_STORE must be either "memory" or "table"')
  }

  return value
}

function getPort(value: string | undefined): number {
  const port = Number(value ?? 3000)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required when LOBBY_STORE is "table"`)
  }

  return value
}