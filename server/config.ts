export type LobbyStore = 'memory' | 'cosmos'

export interface CosmosMongoSettings {
  connectionString: string
  databaseId: string
  collectionId: string
}

export interface ServerConfig {
  port: number
  store: LobbyStore
  cosmos?: CosmosMongoSettings
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
    cosmos: {
      connectionString: cosmosConnectionString(environment),
      databaseId: environment.COSMOS_DATABASE_ID?.trim() || 'flip-seven',
      collectionId: environment.COSMOS_COLLECTION_ID?.trim() || 'lobbies',
    },
  }
}

function getStore(environment: NodeJS.ProcessEnv): LobbyStore {
  const value =
    environment.LOBBY_STORE ??
    (environment.NODE_ENV === 'production' ? 'cosmos' : 'memory')

  if (value !== 'memory' && value !== 'cosmos') {
    throw new Error('LOBBY_STORE must be either "memory" or "cosmos"')
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

function cosmosConnectionString(environment: NodeJS.ProcessEnv): string {
  const value =
    environment.AZURE_COSMOS_CONNECTIONSTRING?.trim() ||
    environment.AZURE_COSMOS_CONNECTION_STRING?.trim() ||
    environment.CUSTOMCONNSTR_AZURE_COSMOS_CONNECTIONSTRING?.trim()

  if (!value) {
    throw new Error(
      'AZURE_COSMOS_CONNECTIONSTRING is required when LOBBY_STORE is "cosmos"',
    )
  }

  return value
}