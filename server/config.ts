export type LobbyStore = 'memory' | 'cosmos'

export interface CosmosSettings {
  endpoint: string
  key?: string
  databaseId: string
  containerId: string
  autoCreate: boolean
}

export interface ServerConfig {
  port: number
  store: LobbyStore
  cosmos?: CosmosSettings
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
      endpoint: required(environment, 'COSMOS_ENDPOINT'),
      key: environment.COSMOS_KEY?.trim() || undefined,
      databaseId: required(environment, 'COSMOS_DATABASE_ID'),
      containerId: required(environment, 'COSMOS_CONTAINER_ID'),
      autoCreate: environment.COSMOS_AUTO_CREATE === 'true',
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

function required(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required when LOBBY_STORE is "cosmos"`)
  }

  return value
}