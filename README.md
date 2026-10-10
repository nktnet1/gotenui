# Gotenui

A **stateless TanStack Start document workbench** for Gotenberg 8.x. The interface uses React 19, TypeScript 7, Tailwind CSS 4, shadcn-style components, Valibot, url-join, Biome and Sonner. Nitro runs the same-origin API routes on Vercel, another serverless provider, or a Node server. No database, session storage or persistent disk is required.

## Features

- 22 Chromium, LibreOffice and PDF-engine operations, including HTML, Markdown, URL and Office conversions, screenshots, merging, metadata, bookmarks, watermarks and Factur-X.
- Multiple named connections in **Connection settings**: browser profiles are saved in `localStorage` (`gotenui.connections.v1`), with automatic migration from the former `gotenui.backend-url.v1` preference. Default: **https://demo.gotenberg.dev**. Server-managed profiles are configured through environment variables, with credentials kept server-side.
- Conversions and health/version checks call **same-origin `/api/gotenberg/*` routes**. Nitro makes server-to-server requests to Gotenberg, so **the demo requires no CORS configuration**.
- Input validation in both browser and server, explicit destination allowlist, independent per-connection Basic Auth or bearer-token support, with server-side credentials never exposed to browsers, streaming conversion responses, three-minute request timeout and an in-memory activity list.
- Optional **admin-key-protected** debug JSON (`GET /debug`) and read-only legacy Prometheus metrics (`GET /prometheus/metrics`) for the selected instance. Neither viewer persists credentials or output.
- A lightweight **Probe** button sends an authenticated, same-origin `HEAD /api/gotenberg/health` request to check Gotenberg without downloading a JSON body. HTTP 200 means healthy and 503 means unhealthy. The existing full status check remains responsible for verifying credentials against `/version`.

## Development

Requires Node.js 24+ and pnpm:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3100`. The public demo is selected immediately unless the browser has a previously saved address. Use **Connection settings** to change it. A private instance must be listed in `GOTENBERG_ALLOWED_URLS` by the deployment administrator; the browser cannot authorise a new server target on its own.

Project modules use the Node `package.json` subpath mappings `#/` → `./src/` and `#scripts/` → `./scripts/`. TypeScript, Vite and Vitest use the same absolute import conventions; Vite 8 and Vitest resolve `tsconfig.json` paths natively via `resolve.tsconfigPaths`, and the Vite dev/build scripts use its **native config loader**. Imports are extensionless, including the Vite configuration; Node resolves `#scripts/*` using the package import map without a warning-suppression variable.

Tests and tooling (Node.js 24+, pnpm, and Docker with a running daemon for integration tests):

```sh
pnpm format
pnpm check
pnpm typecheck
pnpm test:unit         # Fast Vitest tests; no Docker or Gotenberg required
pnpm test:integration  # Starts local Gotenberg, tests 22 processing routes, cleans up
pnpm test              # Both suites (requires Docker)
```

Vitest integration tests start a **disposable `gotenberg/gotenberg:8.37.0` container with Basic Auth enabled** on a Docker-assigned loopback port and a tiny local HTTP fixture server. The tests exercise the real `proxyConversionRequest` against the local instance, including all 22 processing routes, multipart uploads, PDF/image/ZIP/JSON responses, health, and URL allowlisting. The harness waits for `/health` and destroys the container at teardown. No fixed port or public-demo dependency is required. The suite verifies authenticated conversions for all 22 routes, rejects unauthenticated and incorrect-password requests, and checks the credential-free demo path with unit tests. It also validates the protected local `/debug` and `/prometheus/metrics` routes using a Gotenui admin key, and tests direct and proxied `HEAD /health` requests. A missing Docker daemon **fails the suite**, rather than silently skipping it. Override the pinned test image with `GOTENBERG_TEST_IMAGE` if needed.

To cover both split response types, the suite merges two locally generated PDF pages and verifies that splitting produces a ZIP with two entries. It also checks the single-page PDF response and uploads a MINIMUM-profile XML fixture for Factur-X.

The test setup does **not** change the application's public-demo default. Docker must support the `host-gateway` option so the container can reach the deterministic fixture page. Unit tests mock `fetch` and do not contact any remote host.

### Gotenberg API coverage

Gotenui exposes **all 22 documented `POST /forms/*` routes**: four conversion, three screenshot, and fifteen PDF-engine routes. It queries `GET /health` and `GET /version` for detailed connection status, and exposes `HEAD /health` through `HEAD /api/gotenberg/health` for a no-body health probe. The privileged `GET /debug` endpoint is available through `POST /api/gotenberg/debug`, but only when `GOTENUI_DEBUG_ACCESS_KEY` is configured and supplied. Legacy Prometheus text metrics (`GET /prometheus/metrics` upstream) are available through the protected `POST /api/gotenberg/metrics` endpoint. Optional async webhook and `downloadFrom` parameters are not yet exposed. OpenTelemetry exporters are configured on Gotenberg itself, not through Gotenui.

## Protected debug diagnostics

To inspect a Gotenberg instance, first configure a separate **32+ character** `GOTENUI_DEBUG_ACCESS_KEY` in Gotenui's **server-only** environment. Leave it unset to disable the endpoint completely. Enable `API_ENABLE_DEBUG_ROUTE=true` on Gotenberg and protect that instance with its own authentication or an authenticated private gateway. Gotenberg's `/debug` route exposes module configuration and dependency information, and **may include sensitive settings**. Never enable it publicly without access controls.

Use **Diagnostics** in the workbench header, enter the Gotenui admin key (not your Gotenberg password), and inspect the selected connection's read-only JSON. The UI sends the admin key only to Gotenui's same-origin proxy, and forwards only the selected connection's upstream credentials to Gotenberg. No secret or response is saved to `localStorage`, a database or a server session. Results and credentials are cleared when the dialog closes; all responses are `Cache-Control: no-store`. The endpoint enforces the existing exact backend allowlist and limits returned debug JSON to 1 MB.

A disabled local Gotenui admin key produces HTTP 404, an incorrect key HTTP 403, and an upstream Gotenberg without `API_ENABLE_DEBUG_ROUTE` HTTP 404. The local integration suite enables the debug route only on its disposable authenticated Gotenberg container, and never contacts the public demo.

## Protected Prometheus metrics (legacy)

Select **Diagnostics → Prometheus metrics** in the workbench header and enter the same **32+ character** `GOTENUI_DEBUG_ACCESS_KEY` used for debug diagnostics. This server-only key is required even when the chosen Gotenberg instance permits anonymous access. The proxy sends a `GET /prometheus/metrics` request using that profile's upstream Basic/Bearer credentials and returns only bounded, UTF-8, Prometheus text. The browser can filter, copy or download this response without saving it to `localStorage`, a cookie or a server-side session. Maximum response size is **2 MB**. The endpoint refuses redirects, unknown hosts, invalid media types, and unexpected responses. Leaving the key unset disables both debug and metrics access (HTTP 404).

**Deprecation:** Gotenberg has deprecated its legacy `/prometheus/metrics` module since **8.29.0**. It remains available in the pinned **8.37.0** integration image, but new monitoring installations should configure Gotenberg's **OpenTelemetry exporter** (`OTEL_METRICS_EXPORTER=otlp` to send metrics to an external collector, or `OTEL_METRICS_EXPORTER=prometheus` to expose a separate scrape server, usually `:9464/metrics`). The OTEL exporter is **not** the same endpoint or port as `/prometheus/metrics`, and Gotenui deliberately does not proxy arbitrary collector hosts or management APIs. See [Gotenberg telemetry](https://gotenberg.dev/docs/telemetry).

Only the default legacy endpoint path is supported. If a Gotenberg instance changes `PROMETHEUS_METRICS_PATH`, restore the default to use this panel. This is an **on-demand admin viewer**, not a scheduled metrics collector, production monitoring database, or substitute for your normal Prometheus/OTEL scrape infrastructure.

## Vercel and other serverless providers

TanStack Start uses **SPA shell mode for its UI**, while Nitro produces server endpoints and the server runtime. Deploy the **whole project** to Vercel (the included `vercel.json` selects `tanstack-start`) or another Nitro-compatible runtime. **Do not deploy only a `static/` directory:** the `/api/gotenberg/*` routes are required.

Build and run a self-hosted Nitro server:

```sh
pnpm build
pnpm start
```

The server entry point is `.output/server/index.mjs`; Nitro serves the generated public assets as well. Docker and a local Docker Compose example are included; Docker uses port 3100.

The UI is client-rendered: there is no requirement for persistent server processes, shared memory, sticky sessions, database, or disk. Each request selects a backend from the allowlist, validates the payload and files, calls Gotenberg and returns its response. Aborted requests and timeouts do not create saved jobs.

## Configuration and security

| Variable | Purpose |
| --- | --- |
| `VITE_GOTENBERG_DEFAULT_URL` | Optional **public build-time** default for the browser. Defaults to `https://demo.gotenberg.dev`. |
| `VITE_GOTENUI_MAX_UPLOAD_BYTES` | Optional **public build-time** upload-file size cap. Defaults to `4000000` bytes. Keep below the request-body cap. |
| `GOTENBERG_ALLOWED_URLS` | Comma-separated **server-side allowlist** of exact Gotenberg base URLs, including path prefixes. Defaults to `https://demo.gotenberg.dev` only. |
| `GOTENUI_MAX_REQUEST_BYTES` | Maximum total multipart request size at the server. Defaults to `4200000` bytes. |
| `GOTENBERG_BASIC_AUTH_URL` | **Server-only** exact Gotenberg base URL that should receive the credentials. Must be present in `GOTENBERG_ALLOWED_URLS`. |
| `GOTENBERG_BASIC_AUTH_USERNAME` | **Server-only** Basic Auth username for that URL. Cannot contain `:`. |
| `GOTENBERG_BASIC_AUTH_PASSWORD` | **Server-only** legacy Basic Auth password for that URL; v1.0.10 requires an access key for this profile. |
| `GOTENUI_SERVER_CONNECTIONS` | Optional server-only JSON array of named connection profiles, each with ID, name, allowed URL and optional Basic/Bearer auth. |
| `GOTENUI_PROFILE_ACCESS_KEY` | Server-only access key (16–4096 characters). Required if any server-managed profile has credentials. |
| `GOTENUI_DEBUG_ACCESS_KEY` | Optional server-only admin key (32–4096 characters) for both debug JSON and legacy Prometheus metrics. If unset, both endpoints are disabled. |

For example, to let the Settings UI select either the demo or a private Gotenberg instance:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf.internal.example.com
```

### Stateless multi-instance connections (v1.0.10)

Gotenui supports **two connection types**, with no database, cookies, sessions, or persistent server storage:

1. **Browser-managed:** Users add, rename, remove, and select their own profiles in Connection settings. Each profile stores only its name, URL and authentication *mode* in `localStorage`. For Basic Auth and bearer-token connections, users enter the username/password or token when switching to that connection. Secrets are held in **tab memory only** and sent to the same-origin Gotenui proxy on each request, never persisted by Gotenui. Refreshing the page requires re-entering them.
2. **Server-managed:** Operators provide named profiles via `GOTENUI_SERVER_CONNECTIONS`. Users select a profile by ID; the proxy resolves the exact approved URL and attaches its configured Basic or bearer credentials. The browser receives only the profile ID, name and whether an access key is required; neither the upstream URL nor credentials are returned. Switching requires no redeployment.

Both modes use the fixed, server-side `GOTENBERG_ALLOWED_URLS` allowlist. **Adding a browser profile cannot add a new allowed destination**; to permit more backends, update the deployment's allowlist. Redirects and arbitrary relay endpoints remain disabled.

Example configuration with a public demo and two private backends:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf-one.example.com,https://pdf-two.example.com
GOTENUI_PROFILE_ACCESS_KEY=replace-with-a-long-random-secret-at-least-16-chars
GOTENUI_SERVER_CONNECTIONS=[{"id":"finance","name":"Finance PDFs","url":"https://pdf-one.example.com","auth":{"type":"basic","username":"service","password":"secret"}},{"id":"records","name":"Records PDFs","url":"https://pdf-two.example.com","auth":{"type":"bearer","token":"example-token"}}]
```

**Authenticated server profiles require `GOTENUI_PROFILE_ACCESS_KEY`.** Users enter this shared access key in Settings. It is sent only to the same-origin proxy in a request header and is never stored in `localStorage`, embedded in a URL, or forwarded to Gotenberg. The server compares the key in constant time. Profiles without upstream credentials can be public; if an access key is configured, it also protects those profiles. Configure a high-entropy key, use HTTPS for Gotenui, and rotate the key if compromised. The key is a shared capability, **not an individual-user login or RBAC system**. For public deployments, protect Gotenui with an identity-aware edge gateway and request limits; this app does not provide user accounts or an abuse-rate-limiter.

The v1.0.9 `GOTENBERG_BASIC_AUTH_*` variables are still supported, but now expose an explicit `legacy-basic` server-managed profile. **A `GOTENUI_PROFILE_ACCESS_KEY` must also be configured** to make these credentials usable. Merely selecting the legacy backend URL from a browser profile no longer grants access to the server secret. This intentionally closes a credential-use bypass in publicly reachable deployments. Removing the legacy variables and using `GOTENUI_SERVER_CONNECTIONS` is recommended for new deployments.

For browser-managed Basic/Bearer credentials, user-entered secrets are forwarded only to that exact approved destination, never automatically to other profiles, and **never to the public Gotenberg demo**. Any local profile's URL or auth mode can be edited; credentials must be re-entered on each switch. Use HTTPS for private remote Gotenberg instances; Base64-encoded Basic Auth is not encryption. The app may relay privileged document operations and URL-fetching by Gotenberg itself, so follow Gotenberg's network isolation guidance.

**SSR/SSRF policy:** Every selected URL must match the allowlist exactly (including path prefixes); server profile IDs cannot override URLs or authentication; client headers/cookies are never blindly forwarded; redirects are rejected; and the proxy accepts only pre-defined Gotenberg operations. Because DNS can be rebinding-prone and allowlisted hosts can point to private infrastructure, only allow backends you operate or explicitly trust, protect the proxy at the edge, and consider egress controls on the serverless runtime.

The proxy buffers and validates incoming multipart data in memory (up to the configured limit), then streams the upstream response back to the browser. Neither uploads nor results are intentionally persisted by Gotenui. Browser download previews and activity remain in memory until the tab closes. Your host or Gotenberg may enforce separate limits or log requests.

### Request size limits

The browser currently caps uploaded files at **4,000,000 bytes** and the proxy caps its entire multipart body at **4,200,000 bytes** by default. This leaves some overhead under Vercel Functions' **4.5 MB request limit**, although large form fields and generated output can still hit host limits. Vercel also applies a 4.5 MB limit to function responses; some streaming configurations behave differently. For large conversions use a Node/other hosting platform with suitable limits, then increase `VITE_GOTENUI_MAX_UPLOAD_BYTES` and `GOTENUI_MAX_REQUEST_BYTES` appropriately. The public Gotenberg demo has its own limit of **5 MB per request** and rate limit of **2 requests per second per IP**; it is intended for evaluation, not production.

## API contracts

- `GET /api/gotenberg/connections` — returns only `{connections:[{id,name,requiresKey}]}` for server-managed profiles; **no URLs, passwords, or tokens**.
- `GET /api/gotenberg/status?url=<encoded-base-url>` — status for a browser-managed URL, with optional `X-Gotenui-Upstream-Authorization` for user-supplied Basic or Bearer auth.
- `GET /api/gotenberg/status?connection=<profile-id>` — status for a server-managed profile. Supply `X-Gotenui-Profile-Access-Key` if protected.
- `HEAD /api/gotenberg/health?url=<encoded-base-url>` or `?connection=<profile-id>` — lightweight, **bodyless** upstream `HEAD /health` probe. Uses the same browser credential header or protected server-profile access key as the corresponding status request. Returns **200** for healthy, **503** for unhealthy, **401/403** for upstream authentication/authorisation failures, or **502/504** for unexpected gateway failures/timeouts. A browser-managed URL not on the allowlist is rejected with **403**. Never forwards upstream cookies or headers; includes an `X-Gotenui-Health-Probe: 1` header so the browser can reject a static-host SPA fallback. Because Gotenberg's own `/health` can be public even when document operations require Basic Auth, use the full status endpoint to check credentials and version.
- `POST /api/gotenberg/debug` — read-only JSON from upstream `GET /debug`, requires `X-Gotenui-Debug-Access-Key` and the normal connection selector and credentials.
- `POST /api/gotenberg/metrics` — bounded Prometheus exposition from upstream `GET /prometheus/metrics`, requires `X-Gotenui-Debug-Access-Key` and the normal connection selector and credentials. On success returns `text/plain; charset=utf-8` with `X-Gotenui-Metrics: 1`; protects against static SPA fallback, and does not forward upstream cookies or authentication challenges.
- `POST /api/gotenberg/convert` — validated multipart form with `payload`, `files`, and `auxiliary` fields. Browser-managed requests supply `X-Gotenberg-Url` and optional `X-Gotenui-Upstream-Authorization`; server-managed requests supply `X-Gotenui-Connection-Id` and optional `X-Gotenui-Profile-Access-Key`. **Do not combine modes.** The proxy reconstructs approved Gotenberg multipart fields and forwards only the selected upstream auth.

These routes are same-origin and do not enable CORS. Requests claiming a different `Origin` or `Sec-Fetch-Site` are rejected, but server-side HTTP clients can still access public browser-managed routes, so edge security and rate limits are essential.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes, pull requests and manual dispatch. The
**quality** job checks Biome, TypeScript, Vitest unit tests and a production build;
it also fails if either previously reported Rolldown warning returns. The
**integration** job invokes Vitest's Docker harness, which starts a disposable
`gotenberg/gotenberg:8.37.0` container with a local fixture server. CI never
contacts `demo.gotenberg.dev` to run tests.

CI uses `pnpm/setup@v1` to install Node.js 24 and **pnpm 12**, reading the
exact pnpm version from `packageManager` in `package.json` (currently
`pnpm@12.10.1`) automatically. Both jobs run `pnpm install --frozen-lockfile`.
After changing dependencies, update and commit `pnpm-lock.yaml` locally before
expecting CI to pass. This patch intentionally leaves the generated lockfile
untouched.

The Nitro build config labels its function-named library chunk group (without
altering chunk names) and silences only `MODULE_LEVEL_DIRECTIVE` warnings about
third-party `"use client"` markers in the **non-RSC** Nitro server bundle.
Warnings from application files and all other Rolldown warnings still appear.
