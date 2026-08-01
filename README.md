# Flip Seven Scorekeeper

An unofficial, mobile-first lobby and scorekeeping companion for the Flip 7 card game.

## Current flow

1. A host enters a display name and creates a lobby.
2. The server creates a five-character lobby code and adds the host as the first player.
3. The waiting room shows the code, a join QR code, share controls, and the player list.
4. Players join from the home page or `/join/:code` with a unique display name.
5. The waiting room polls every three seconds for new players.

Lobby records expire logically after 12 hours. Ambiguous characters such as `0`, `1`, `I`, and `O` are not used in lobby codes.

## Stack

- Node.js 24 and TypeScript
- React 19 and Vite
- Express 5
- Azure Table Storage in production
- In-memory storage for local development

The production Express process serves both `/api/*` and the built React application, so one Linux App Service is sufficient.

## Local development

Requirements: Node.js 24 and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies API calls to Express on port `3000`. Local lobbies are held in memory and reset when the server restarts.

Useful checks:

```sh
npm test
npm run lint
npm run build
```

## Configuration

| Setting | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Azure | Set to `production`; this makes Table Storage the default store. |
| `LOBBY_STORE` | No | `memory` or `table`. Defaults to memory locally and Table Storage in production. |
| `PORT` | No | Express port. Azure supplies this automatically. |
| `AZURE_STORAGE_TABLE_ENDPOINT` | Table | Table service URL, such as `https://account.table.core.windows.net`. |
| `AZURE_STORAGE_TABLE_NAME` | No | Table name. Defaults to `lobbies`. |

No storage key or connection string is required. `DefaultAzureCredential` uses the App Service managed identity in Azure and the developer's Azure CLI identity when explicitly running the table store locally.

## Table layout

Each lobby is one table partition:

- `PartitionKey` is the lobby code.
- The lobby metadata entity uses `RowKey` `lobby`.
- Player row keys are deterministic hashes of normalized names, which enforces unique names within a lobby.
- Lobby metadata and the host are created in one atomic table transaction.
- Players are ordered by `joinedAt` in the application after retrieval.

Azure Table Storage does not provide per-entity TTL. The application rejects lobbies after their shared 12-hour expiration, but physical removal requires a scheduled cleanup process if stale-row storage becomes meaningful.

## Azure App Service

Use a Linux App Service configured for Node.js 24.

1. Enable the App Service system-assigned managed identity.
2. Grant that identity `Storage Table Data Contributor` on the storage account.
3. Set `NODE_ENV=production`, `LOBBY_STORE=table`, `AZURE_STORAGE_TABLE_ENDPOINT`, and optionally `AZURE_STORAGE_TABLE_NAME`.
4. Run `npm ci` and `npm run build` in the deployment pipeline.
5. Deploy `dist`, `dist-server`, production dependencies, and package metadata.
6. Use `npm start` as the startup command and `/api/health` as the health-check path.

The server initializes the table before listening, binds to `0.0.0.0`, and honors Azure's `PORT` setting.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/lobbies` | Create a lobby with `{ "hostName": "Morgan" }`. |
| `GET` | `/api/lobbies/:code` | Read the public waiting-room state. |
| `POST` | `/api/lobbies/:code/players` | Join with `{ "name": "Taylor" }`. |
| `DELETE` | `/api/lobbies/:code/players/:playerId` | Remove a joined player with the host session token as a bearer credential. |
| `GET` | `/api/health` | App Service health probe. |

Create and join responses include a browser session token. Only token hashes are persisted.

## Real-time next step

The current polling loop can be replaced with a lobby update event while retaining `GET /api/lobbies/:code` for initial state and reconnects. For scale-out, use Azure Web PubSub or another shared backplane rather than process-local broadcasts.