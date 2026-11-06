# Development and configuration

Use this complete checkout, Node.js 24 and npm. `package-lock.json` is the active
npm lockfile. Optional `.zscripts/` deployment tooling also invokes Bun, so
`bun.lock` is intentional, but stale. Bun is unavailable on this machine; that
deployment path must regenerate and validate its lock before use. npm is the
verified local workflow; this cleanup does not switch package managers.

```powershell
npm ci
npm run dev
```

The default is `127.0.0.1:3000`. `scripts/start-local.mjs` owns dev/production
startup, forwards termination signals, sets the durable project root and enables
the loopback-only startup marker required by Auto. Verify `/api/agent-session/files?op=info`
before assuming which checkout a running server serves.

## Build and production

```powershell
npm run build
npm start
```

`scripts/build.mjs` runs the bundled Next CLI and copies public/static assets
with Node filesystem APIs after compilation succeeds. The same script respects
`NEXT_DIST_DIR`. To build alongside an active development server without
changing its cache:

```powershell
$env:NEXT_DIST_DIR = '.next-qa'
npm run build
$env:PORT = '3100'
npm start
```

Use the same `NEXT_DIST_DIR` when starting that build. Next may add the isolated
type directory to `tsconfig.json`; review this generated configuration change
before keeping it. Do not share one `.next` cache between simultaneous builds.
These are local source-checkout operations. A relocatable standalone deployment
needs a separately configured durable data location and locally installed Python
companion if Auto is required.

## Configuration

| Setting | Purpose |
|---|---|
| `PORT` | Local dashboard port, default 3000 |
| `NEXT_DIST_DIR` | Build/cache directory, default `.next` |
| `AGENTHUB_PROJECT_ROOT` | Installation root; set by the launcher |
| `AGENT_HUB_DB_DIR` | Explicit durable JSON directory; overrides the default project `db/` |
| `AGENT_SESSION_WORKSPACE` | Default file-tool workspace; separate from installation root |
| `AGENTHUB_COMPUTER_PYTHON` | Optional Python interpreter for the local companion |

Use the existing UI to select configured model providers, registered workspaces
and enabled skills. Credentials are server-side configuration and must not be
committed or included in diagnostic output. Provider defaults remain in
`chat-settings.ts`; custom endpoints are optional. See [n8n](n8n-setup.md) for its
specific configuration and [Auto](auto-computer-use.md) for computer setup.

## Local safety boundaries

File/exec routes retain workspace path, symlink and capability checks. Relative
path normalization is shared but does not replace those checks. Mutation and
command approval behavior is unchanged. Common API routes retain their existing
host-based Origin check and no-Origin CLI compatibility; this is not account
authentication or a general public-hosting security model.

Auto keeps its stricter localhost, Origin, consent, app/domain, read-only and
approval gates. A normal folder does not isolate arbitrary native app or command
writes. VM preparation remains stopped; no VirtualBox installation, guest startup
or new host-app permissions are part of this cleanup.

`db/`, personal documents, output deliverables, installed skills and local model
data are user data. Do not reset them as a cleanup step. Existing Prisma reset
and data-loss scripts are retained for compatibility but are not part of setup
or verification.

## Optional terminal agent

`AgentHub-CLI/` has its own package and tests. Run `npm test` from that
directory to check it. Follow its README for CLI setup; the web app does not
implicitly launch it.
