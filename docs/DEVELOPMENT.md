# Development

## Setup

Use Node.js 24 and the pnpm version declared in `package.json`.

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3100>. The public Gotenberg demo is selected by default unless you configure another allowed connection.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/components/` | React interface and reusable controls |
| `src/lib/` | Operations, validation, client requests and shared logic |
| `server/` | Nitro API routes, authentication and request middleware |
| `tests/` | Vitest unit and Docker integration tests |
| `scripts/` | Production and browser smoke tests |
| `deploy/` | Example Docker Compose deployment |

The browser sends conversions through `/api/gotenberg/*`. The server validates requests, checks the configured upstream allowlist and forwards them to Gotenberg. Gotenui has no database, persistent job queue or document storage.

## Checks

| Command | Purpose |
| --- | --- |
| `pnpm format` | Apply Biome formatting and safe fixes |
| `pnpm check` | Check formatting and lint rules |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm test:unit` | Run unit tests without Docker |
| `pnpm test:integration` | Run tests against disposable Gotenberg in Docker |
| `pnpm build` | Build the production app |
| `pnpm test:smoke` | Test built Nitro routes using a local mock upstream |
| `pnpm test:browser` | Exercise the built UI in headless Chrome |
| `pnpm test` | Run unit and Docker integration tests |

Build before running `test:smoke` or `test:browser`. Browser tests need Chrome or Chromium. Override discovery with `GOTENUI_BROWSER_BIN` when needed.

Integration tests require Docker and use `gotenberg/gotenberg:8.37.0` by default. `GOTENBERG_TEST_IMAGE` overrides the image. Tests do not depend on the public demo. CI runs unit, build, production smoke, browser smoke and Docker integration checks.

Keep `pnpm-lock.yaml` in sync when updating dependencies. Do not edit generated files by hand.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /api/gotenberg/connections` | List public names and IDs of managed connections |
| `GET /api/gotenberg/status` | Check health and version of a selected instance |
| `HEAD /api/gotenberg/health` | Run a lightweight health probe |
| `POST /api/gotenberg/convert` | Submit a conversion or PDF operation |
| `POST /api/gotenberg/debug` | Read upstream debug data |
| `POST /api/gotenberg/metrics` | Read upstream metrics |

Conversion requests use multipart `payload`, `files` and `auxiliary` fields. Browser-managed requests select a backend URL, while managed requests use an approved connection ID. The server never returns managed credentials to browsers.

For supported options and payload behavior, see the operation definitions and validation in `src/lib/`. Upstream API documentation is at [gotenberg.dev](https://gotenberg.dev/docs/getting-started/routes).
