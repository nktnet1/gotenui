# Gotenui

A **stateless TanStack Start document workbench** for Gotenberg 8.x. The interface uses React 19, TypeScript 7, Tailwind CSS 4, shadcn-style components, Valibot, url-join, Biome and Sonner. Nitro runs the same-origin API routes on Vercel, another serverless provider, or a Node server. No database, session storage or persistent disk is required.

## Features

- 22 Chromium, LibreOffice and PDF-engine operations, including HTML, Markdown, URL and Office conversions, screenshots, merging, metadata, bookmarks, watermarks and Factur-X.
- Configurable Gotenberg URL in **Connection settings**, persisted only in the browser's `localStorage` (`gotenui.backend-url.v1`). Default: **https://demo.gotenberg.dev**.
- Conversions and health/version checks call **same-origin `/api/gotenberg/*` routes**. Nitro makes server-to-server requests to Gotenberg, so **the demo requires no CORS configuration**.
- Input validation in both browser and server, explicit destination allowlist, streaming conversion responses, three-minute request timeout and an in-memory activity list.

## Development

Requires Node.js 24+ and pnpm:

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3100`. The public demo is selected immediately unless the browser has a previously saved address. Use **Connection settings** to change it. A private instance must be listed in `GOTENBERG_ALLOWED_URLS` by the deployment administrator; the browser cannot authorise a new server target on its own.

Tests and tooling (Node.js 24+, pnpm, and Docker with a running daemon for integration tests):

```sh
pnpm format
pnpm check
pnpm typecheck
pnpm test:unit         # Fast Vitest tests; no Docker or Gotenberg required
pnpm test:integration  # Starts local Gotenberg, tests 22 processing routes, cleans up
pnpm test              # Both suites (requires Docker)
```

Vitest integration tests start a **disposable `gotenberg/gotenberg:8.37.0` container** on a Docker-assigned loopback port and a tiny local HTTP fixture server. The tests exercise the real `proxyConversionRequest` against the local instance, including all 22 processing routes, multipart uploads, PDF/image/ZIP/JSON responses, health, and URL allowlisting. The harness waits for `/health` and destroys the container at teardown. No fixed port or public-demo dependency is required. A missing Docker daemon **fails the suite**, rather than silently skipping it. Override the pinned test image with `GOTENBERG_TEST_IMAGE` if needed.

To cover both split response types, the suite merges two locally generated PDF pages and verifies that splitting produces a ZIP with two entries. It also checks the single-page PDF response and uploads a MINIMUM-profile XML fixture for Factur-X.

The test setup does **not** change the application's public-demo default. Docker must support the `host-gateway` option so the container can reach the deterministic fixture page. Unit tests mock `fetch` and do not contact any remote host.

### Gotenberg API coverage

Gotenui exposes **all 22 documented `POST /forms/*` routes**: four conversion, three screenshot, and fifteen PDF-engine routes. It also queries `GET /health` and `GET /version` for connection status. Admin and monitoring endpoints (`/debug`, `/prometheus/metrics`, `HEAD /health`) and optional async webhook and `downloadFrom` parameters are not exposed by the workbench. Those features require separate security controls and should not be relayed by an anonymous conversion proxy.

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

For example, to let the Settings UI select either the demo or a private Gotenberg instance:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf.internal.example.com
```

**Why the allowlist?** A publicly reachable serverless proxy that forwards to arbitrary user-specified URLs would be an SSRF/open-proxy vulnerability. This implementation requires an exact, server-approved base URL, disallows URL credentials and redirects, exposes only a fixed set of Gotenberg operations, validates fields and uploaded files, and never forwards arbitrary headers, cookies or credentials. Browser-selected URL values are not secrets. To support a new Gotenberg host, add it to your deployment environment and redeploy/restart the server as needed.

**Secure public deployments:** Protect Gotenui behind authentication and abuse/rate limits at the edge. The app itself does not implement accounts or a distributed rate limiter. Gotenberg can render URLs and load external resources, so isolate self-hosted instances and enable appropriate network/SSRF protections (including Chromium private-IP blocking when applicable). Never treat the Gotenberg instance as safe to expose directly to the internet.

The proxy buffers and validates incoming multipart data in memory (up to the configured limit), then streams the upstream response back to the browser. Upload contents and results are never intentionally persisted by Gotenui. The browser retains an in-memory download preview and activity list until the tab closes. Your host, CDN or Gotenberg instance may enforce separate request limits or log requests; apply your own privacy and retention rules.

### Request size limits

The browser currently caps uploaded files at **4,000,000 bytes** and the proxy caps its entire multipart body at **4,200,000 bytes** by default. This leaves some overhead under Vercel Functions' **4.5 MB request limit**, although large form fields and generated output can still hit host limits. Vercel also applies a 4.5 MB limit to function responses; some streaming configurations behave differently. For large conversions use a Node/other hosting platform with suitable limits, then increase `VITE_GOTENUI_MAX_UPLOAD_BYTES` and `GOTENUI_MAX_REQUEST_BYTES` appropriately. The public Gotenberg demo has its own limit of **5 MB per request** and rate limit of **2 requests per second per IP**; it is intended for evaluation, not production.

## API contracts

- `GET /api/gotenberg/status?url=<encoded-base-url>` — validates the selected backend against the server allowlist, queries Gotenberg's `/health` and `/version`, and returns a small JSON status object.
- `POST /api/gotenberg/convert` — multipart body with one `payload` JSON field and zero or more `files` and `auxiliary` file fields. `X-Gotenberg-Url` holds the selected base URL. The server validates the payload using Valibot, looks up the operation from the fixed catalogue, reconstructs a safe Gotenberg form and streams the result. It does not accept arbitrary Gotenberg routes or webhook/download URL overrides.

These API routes are **same-origin** and do not enable CORS. Requests with cross-site `Origin` or `Sec-Fetch-Site` headers are rejected. They remain reachable by server-side HTTP clients, so edge authentication and rate limits are still important.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes, pull requests and manual dispatch. The
**quality** job checks Biome, TypeScript, Vitest unit tests and a production build;
it also fails if either previously reported Rolldown warning returns. The
**integration** job invokes Vitest's Docker harness, which starts a disposable
`gotenberg/gotenberg:8.37.0` container with a local fixture server. CI never
contacts `demo.gotenberg.dev` to run tests.

CI uses Node.js 24 and pnpm 10 with `pnpm install --frozen-lockfile`.
After changing dependencies, update and commit `pnpm-lock.yaml` locally before
expecting CI to pass. This patch intentionally leaves the generated lockfile
untouched.

The Nitro build config labels its function-named library chunk group (without
altering chunk names) and silences only `MODULE_LEVEL_DIRECTIVE` warnings about
third-party `"use client"` markers in the **non-RSC** Nitro server bundle.
Warnings from application files and all other Rolldown warnings still appear.
