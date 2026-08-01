# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  # Flip Seven Scorekeeper

  An unofficial, mobile-first lobby and scorekeeping companion for the Flip 7 card game.

  ## Current flow

  1. A host enters a display name and creates a lobby.
  2. The server creates a 5-character lobby code and stores the host as the first player.
  3. The waiting room shows the code, a join QR code, share controls, and the player list.
  4. Players join from the home page or `/join/:code` with a unique display name.
  5. The waiting room polls every three seconds for new players. The same lobby payload can later be pushed over WebSockets.

  Lobby records expire after 12 hours. Ambiguous characters such as `0`, `1`, `I`, and `O` are not used in lobby codes.

  ## Stack

  - Node.js 24 and TypeScript
  - React 19 and Vite
  - Express 5
  - Azure Cosmos DB for MongoDB in production
  - In-memory storage for local development

  The production Express process serves both `/api/*` and the built React application, so one Linux App Service is sufficient.

  ## Local development

  Requirements: Node.js 24 and npm.

  ```sh
  npm install
  npm run dev
  ```

  Open `http://localhost:5173`. Vite proxies API calls to the Express server on port `3000`. Local lobbies are held in memory and reset when the server restarts.

  To override local settings, create `.env` from `.env.example`. Node 24 loads it natively when the server starts.

  Useful checks:

  ```sh
  npm test
  npm run lint
  npm run build
  ```

  ## Configuration

  | Setting | Required | Purpose |
  | --- | --- | --- |
  | `NODE_ENV` | Azure | Set to `production`; this makes Cosmos DB the default store. |
  | `LOBBY_STORE` | No | `memory` or `cosmos`. Defaults to memory locally and Cosmos in production. |
  | `PORT` | No | Express port. Azure's supplied value is used automatically. |
  | `AZURE_COSMOS_CONNECTIONSTRING` | Cosmos | MongoDB API connection string supplied by Azure. |
  | `COSMOS_DATABASE_ID` | No | Database name. Defaults to `flip-seven`. |
  | `COSMOS_COLLECTION_ID` | No | Collection name. Defaults to `lobbies`. |

  Set `AZURE_COSMOS_CONNECTIONSTRING` under App Service **App settings**. If it is stored under **Connection strings** as type `Custom`, App Service exposes it as `CUSTOMCONNSTR_AZURE_COSMOS_CONNECTIONSTRING`, which is also supported.

  ## Cosmos DB

  This application uses Cosmos DB's MongoDB API through the official `mongodb` driver. The database and collection default to `flip-seven` and `lobbies` and can be overridden independently from the connection string.

  At startup, the repository ensures two indexes:

  - A unique compound index on `lobbyCode` and `id` protects lobby-code and normalized player-name uniqueness under concurrent writes.
  - A TTL index on `expiresAtDate` removes lobby and player documents at their shared 12-hour expiration.

  Each lobby and player is stored as a separate document. The supplied MongoDB credential must be able to read and write the collection and create these indexes.

  ## Azure App Service

  Use a Linux App Service configured for Node.js 24.

  1. Run `npm ci` and `npm run build` in the deployment pipeline.
  2. Deploy the repository with `dist`, `dist-server`, production dependencies, and package metadata.
  3. Use `npm start` as the startup command.
  4. Add `AZURE_COSMOS_CONNECTIONSTRING` and any database/collection overrides to App Service Configuration.
  5. Optionally configure `/api/health` as the health check path.

  The server binds to `0.0.0.0` and honors Azure's `PORT` setting.

  ## API

  | Method | Route | Purpose |
  | --- | --- | --- |
  | `POST` | `/api/lobbies` | Create a lobby with `{ "hostName": "Morgan" }`. |
  | `GET` | `/api/lobbies/:code` | Read the public waiting-room state. |
  | `POST` | `/api/lobbies/:code/players` | Join with `{ "name": "Taylor" }`. |
  | `GET` | `/api/health` | App Service health probe. |

  Create and join responses include a browser session token. Token hashes are stored now so host-only and player-only actions can be authorized when gameplay endpoints are added.

  ## Real-time next step

  The current polling loop should be replaced with a lobby update event while retaining `GET /api/lobbies/:code` for initial state and reconnects. Socket.IO can share the existing HTTP server for a single App Service instance. For scale-out, use Azure Web PubSub or a Socket.IO backplane rather than relying on process-local broadcasts.
