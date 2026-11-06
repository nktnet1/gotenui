# Development

## Setup

Use Node.js 24 and the pnpm version declared in `package.json`.

```sh
pnpm install
pnpm dev
```

Open <http://localhost:3100>. The public Gotenberg demo is selected by default unless you configure another allowed connection.

## Project layout

| Path                            | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/components/`               | Workspace interface and reusable controls                          |
| `src/tools/<tool-id>/config.ts` | Individual tool definition: endpoint, fields and output            |
| `src/tools/registry.ts`         | Ordered catalogue used by the homepage, sidebar, search and routes |
| `src/tools/shared/`             | Reusable field groups, form, field renderer and result panel       |
| `src/lib/`                      | Validation, client requests and shared backend logic               |
| `src/start.ts`                  | Global request middleware and optional site authentication         |
| `src/routes/api/`               | Gotenberg proxy API endpoints                                      |
| `tests/`                        | Vitest unit and Docker integration tests                           |
| `scripts/`                      | Production and browser smoke tests                                 |
| `deploy/`                       | Example Docker Compose deployment                                  |

The browser sends conversions through `/api/gotenberg/*`. The server validates requests, checks the configured upstream allowlist and forwards them to Gotenberg. Gotenui has no database, persistent job queue or document storage.

For tag-driven GitHub releases and container publishing, see [Releasing](RELEASING.md).

## Checks

| Command                    | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm format`              | Apply Biome formatting and safe fixes                                   |
| `pnpm check`               | Check formatting and lint rules                                         |
| `pnpm typecheck`           | Run TypeScript checks                                                   |
| `pnpm test:unit`           | Run unit tests without Docker                                           |
| `pnpm test:integration`    | Run Docker integration tests against **both** pinned Gotenberg versions |
| `pnpm test:integration:v8` | Run only the Gotenberg 8.40.0 integration suite                         |
| `pnpm test:integration:v9` | Run only the Gotenberg 9.0.0 integration suite                          |
| `pnpm build`               | Build the production app                                                |
| `pnpm test:smoke`          | Test built Nitro routes using a local mock upstream                     |
| `pnpm test:browser`        | Exercise the built UI in headless Chrome                                |
| `pnpm test`                | Run unit and Docker integration tests                                   |

Build before running `test:smoke` or `test:browser`. Browser tests need Chrome or Chromium. Override discovery with `GOTENUI_BROWSER_BIN` when needed.

Integration tests require Docker. `pnpm test` and `pnpm test:integration` run **both** `gotenberg/gotenberg:8.40.0` and `gotenberg/gotenberg:9.0.0` sequentially, with separate results for each version. Missing images are pulled with visible Docker download progress; locally cached images are reused. The version-specific commands above select just one image, as does the CI `GOTENBERG_TEST_VERSION` matrix variable. The v9-specific PDF integration cases generate a temporary interactive PDF form and certificate/key pair; an `openssl` executable must be available on the host running those tests. They do not require a live timestamp authority. Tests verify the actual upstream `/version`, use local fixtures and never contact the public demo. Version-specific tests are expected to be skipped when the _other_ image is running, but both suites must finish successfully. CI runs unit, build, production smoke, browser smoke and both Docker integration checks.

Keep `pnpm-lock.yaml` in sync when updating dependencies. Do not edit generated files by hand.

## API overview

| Endpoint                         | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `GET /api/gotenberg/connections` | List public names and IDs of managed connections |
| `GET /api/gotenberg/status`      | Check health and version of a selected instance  |
| `HEAD /api/gotenberg/health`     | Run a lightweight health probe                   |
| `POST /api/gotenberg/convert`    | Submit a conversion or PDF operation             |
| `POST /api/gotenberg/debug`      | Read upstream debug data                         |
| `POST /api/gotenberg/metrics`    | Read upstream metrics                            |

Conversion requests use multipart `payload`, `files` and `auxiliary` fields. Browser-managed requests select a backend URL, while managed requests use an approved connection ID. The server never returns managed credentials to browsers.

To add a tool, create `src/tools/<tool-id>/config.ts` exporting an `Operation`, then import it in `src/tools/registry.ts` in the desired display order. The homepage, sidebar, search and `/tools/$operationId` route use that single registry. Reuse field groups and components in `src/tools/shared/`; `src/lib/operations.ts` is a compatibility re-export.

For payload options, see `src/tools/` and `src/lib/validation.ts`. Upstream API documentation is at [gotenberg.dev](https://gotenberg.dev/docs/getting-started/routes).
