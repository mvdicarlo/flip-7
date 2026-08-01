import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from './config.js'

describe('server configuration', () => {
  it('uses Azure Table Storage in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      AZURE_STORAGE_TABLE_ENDPOINT: 'https://example.table.core.windows.net',
    })

    assert.equal(config.store, 'table')
    assert.equal(
      config.tableStorage?.endpoint,
      'https://example.table.core.windows.net',
    )
    assert.equal(config.tableStorage?.tableName, 'lobbies')
  })

  it('requires a Table Storage endpoint for the table store', () => {
    assert.throws(
      () => loadConfig({ LOBBY_STORE: 'table' }),
      /AZURE_STORAGE_TABLE_ENDPOINT is required/,
    )
  })

  it('supports a custom table name', () => {
    const config = loadConfig({
      LOBBY_STORE: 'table',
      AZURE_STORAGE_TABLE_ENDPOINT: 'https://example.table.core.windows.net',
      AZURE_STORAGE_TABLE_NAME: 'flipseven',
    })

    assert.equal(config.tableStorage?.tableName, 'flipseven')
  })
})