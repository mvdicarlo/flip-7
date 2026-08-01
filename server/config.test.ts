import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from './config.js'

describe('server configuration', () => {
  it('uses the App Service MongoDB connection string in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AZURE_COSMOS_CONNECTIONSTRING: 'mongodb://example.invalid',
    })

    assert.equal(config.store, 'cosmos')
    assert.equal(config.cosmos?.connectionString, 'mongodb://example.invalid')
    assert.equal(config.cosmos?.databaseId, 'flip-seven')
    assert.equal(config.cosmos?.collectionId, 'lobbies')
  })

  it('requires a MongoDB connection string for the Cosmos store', () => {
    assert.throws(
      () => loadConfig({ LOBBY_STORE: 'cosmos' }),
      /AZURE_COSMOS_CONNECTIONSTRING is required/,
    )
  })

  it('supports an App Service custom connection string', () => {
    const config = loadConfig({
      LOBBY_STORE: 'cosmos',
      CUSTOMCONNSTR_AZURE_COSMOS_CONNECTIONSTRING:
        'mongodb://app-service.example.invalid',
    })

    assert.equal(
      config.cosmos?.connectionString,
      'mongodb://app-service.example.invalid',
    )
  })
})