# Gotenui

A **stateless TanStack Start document workbench** for Gotenberg 8.x. The interface uses React 19, TypeScript 7, Tailwind CSS 4, shadcn-style components, Valibot, url-join, Biome and Sonner. Nitro runs the same-origin API routes on Vercel, another serverless provider, or a Node server. No database, session storage or persistent disk is required.

See [ROADMAP.md](ROADMAP.md) for the remaining feature gaps, priorities, and proposed delivery sequence.

## Features

- 22 Chromium, LibreOffice and PDF-engine operations, including HTML, Markdown, URL and Office conversions, screenshots, merging, metadata, bookmarks, watermarks and Factur-X.
- Custom Chromium PDF headers/footers and multi-file Markdown templates, with editable/importable HTML and named, reorderable Markdown sources.
- Single-request PDF conversion plus watermark/stamp overlays, attachments, Factur-X XML, metadata, flattening and encryption.
- Optional remote-file `downloadFrom` inputs and asynchronous Gotenberg webhook delivery, validated server-side and forwarded through the same-origin proxy.
- Pure vector `public/gotenui-icon.svg`, used as the in-app mark and browser favicon.
- Multiple named connections in **Connection settings**: browser profiles are saved in `localStorage` (`gotenui.connections.v1`), with automatic migration from the former `gotenui.backend-url.v1` preference. Default: **https://demo.gotenberg.dev**. Server-managed profiles are configured through environment variables, with credentials kept server-side.
- Conversions and health/version checks call **same-origin `/api/gotenberg/*` routes**. Nitro makes server-to-server requests to Gotenberg, so **the demo requires no CORS configuration**.
- Input validation in both browser and server, explicit destination allowlist, independent per-connection Basic Auth or bearer-token support, with server-side credentials never exposed to browsers, streaming conversion responses, three-minute request timeout and an in-memory activity list.
- Optional debug JSON (`GET /debug`) and legacy Prometheus metrics (`GET /prometheus/metrics`) for the selected instance. Gotenberg controls access; runtime `GOTENUI_SHOW_DEBUG` / `GOTENUI_SHOW_METRICS` flags hide the UI options without disabling the APIs.
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

Vitest integration tests start a **disposable `gotenberg/gotenberg:8.37.0` container with Basic Auth enabled** on a Docker-assigned loopback port and a tiny local HTTP fixture server. The tests exercise the real `proxyConversionRequest` against the local instance, including all 22 processing routes, multipart uploads, PDF/image/ZIP/JSON responses, health, and URL allowlisting. The harness waits for `/health` and destroys the container at teardown. No fixed port or public-demo dependency is required. The suite verifies authenticated conversions for all 22 routes, rejects unauthenticated and incorrect-password requests, and checks the credential-free demo path with unit tests. It also validates upstream-authenticated local `/debug` and `/prometheus/metrics` routes, and tests direct and proxied `HEAD /health` requests. A missing Docker daemon **fails the suite**, rather than silently skipping it. Override the pinned test image with `GOTENBERG_TEST_IMAGE` if needed.

To cover both split response types, the suite merges two locally generated PDF pages and verifies that splitting produces a ZIP with two entries. It also checks the single-page PDF response and uploads a MINIMUM-profile XML fixture for Factur-X.

The integration suite also covers single-request PDF overlays, embedded attachments, Factur-X XML during Office conversion, and a remote attachment from a disposable local fixture server.

The test setup does **not** change the application's public-demo default. Docker must support the `host-gateway` option so the container can reach the deterministic fixture page. Unit tests mock `fetch` and do not contact any remote host.

### Gotenberg API coverage

Gotenui exposes **all 22 documented `POST /forms/*` routes**: four conversion, three screenshot, and fifteen PDF-engine routes. It queries `GET /health` and `GET /version` for detailed connection status, and exposes `HEAD /health` through `HEAD /api/gotenberg/health` for a no-body health probe. Gotenberg's `GET /debug` endpoint is accessible through `POST /api/gotenberg/debug` when enabled on the selected instance; legacy Prometheus metrics (`GET /prometheus/metrics` upstream) are accessible through `POST /api/gotenberg/metrics`. Both rely on Gotenberg's upstream authentication, not Gotenui access keys. Optional async webhook delivery and `downloadFrom` remote file descriptors are available through the Advanced options panel. OpenTelemetry exporters are configured on Gotenberg itself, not through Gotenui.

## Merge order, filenames and tracing (v1.0.18)

For **Merge PDFs**, the displayed order is authoritative for locally uploaded PDFs. Gotenberg normally merges files by alphanumeric filename (numeric names first), regardless of upload order. Gotenui assigns temporary numbered names (`01_original.pdf`, `02_original.pdf`, etc.) to **local** multipart uploads to preserve the chosen order. Duplicate local filenames are supported with Gotenberg 8.37+; original PDF bytes are unchanged. For filename-keyed `bookmarks` JSON, Gotenui maps original filenames to their temporary upload names. Where multiple files share the same name, that bookmark mapping applies to each. A Gotenberg-generated title bookmark may display a numbered filename if the original PDF has no Title metadata.

`downloadFrom` remote inputs cannot be reordered from the local upload list. Gotenberg sorts remote filenames together with the submitted files, so **mixed remote/local merges do not guarantee that the visible local order matches the complete merged page order**. For deterministic complete ordering, download remote files and add them as local uploads, then reorder. Gotenberg must permit remote downloads in its own outbound URL configuration.

For file-producing operations, **Output filename** now sets both the browser download name and the upstream `Gotenberg-Output-Filename` header (without extension). When blank, Gotenberg chooses its own filename and Gotenui uses the returned `Content-Disposition`. For metadata/bookmark JSON reads, the field changes the browser download filename only; Gotenberg does not define an output-filename header on these routes.

Advanced options include a validated custom **Gotenberg request ID** (`Gotenberg-Trace`, plain log/webhook correlation ID), **W3C `traceparent`**, and optional `tracestate` for distributed tracing. Gotenberg 8.34+ continues upstream `traceparent` context into asynchronous webhook callbacks. These are different mechanisms: the correlation ID is *not* an OpenTelemetry trace ID. The app only forwards these fields from the validated conversion payload, never arbitrary browser request headers. Upstream error responses retain a safe Gotenberg correlation ID for diagnosis; credentials and cookies are not relayed. No session state or new authentication layer is added.

## Chromium PDF headers, footers and Markdown templates (v1.0.20)

The **Website to PDF**, **HTML to PDF** and **Markdown to PDF** workbenches accept optional **Header HTML** and **Footer HTML**. Paste complete HTML documents into the editors or load `.html` files into them. The API proxy creates the required `header.html` and `footer.html` file parts for Gotenberg; these are not separate form fields. Uploaded assets with reserved filenames (`header.html`, `footer.html` or `index.html`) are rejected to avoid collisions. **Screenshot** routes have no PDF header/footer controls.

Chromium renders headers and footers in an **isolated context**: the main document's CSS does not apply, external assets cannot be loaded and scripts do not execute. Use a complete document with `<html>`, `<head>` and `<body>`, inline CSS and base64/data-URI images. Set suitable `marginTop` and `marginBottom` (for example `0.8` inches) to prevent clipping. Chromium supports placeholder elements such as `<span class="pageNumber"></span>` and `<span class="totalPages"></span>`.

The **Markdown to PDF** and **Markdown screenshot** workbenches retain their editable initial `document.md`, and now allow renaming it and adding, importing, removing or reordering more `.md` sources (up to 20 total). The default `index.html` template is generated automatically from their displayed order. Use **Customize template** or load your own `.html` template to control layout and render order with Gotenberg's `{{ toHTML "filename.md" }}` action. Return to **Use generated template** to track source changes automatically. When using a custom template, every listed Markdown source must be referenced and every reference must match a submitted filename, including case.

All Chromium HTML, Markdown and asset files share **one flat Gotenberg directory**: reference stylesheets and images by basename (for example `style.css`), not absolute paths or subdirectories. Markdown sources have unique case-insensitive `.md` names; reserved filenames, missing template references, empty Markdown sources and asset name collisions are rejected before proxying. Existing one-file Markdown conversions retain their previous request contract. These editors and imports are per-tab, in-memory only; no state is added to the server or stored between sessions.

## PDF post-processing during conversion (v1.0.21)

The **Website to PDF**, **HTML to PDF**, **Markdown to PDF**, and **Office to PDF** workbenches include an optional **PDF post-processing** editor. Gotenui sends these options to the **same** Gotenberg conversion endpoint rather than converting a PDF twice or storing an intermediate result. Screenshot operations do not support PDF-engine post-processing; PDF tools retain their own dedicated controls.

| Feature | Gotenberg form fields | Upload part / remote input |
| --- | --- | --- |
| Text, image, or PDF watermark | `watermarkSource`, `watermarkExpression`, optional `watermarkPages` and `watermarkOptions` | `watermark` (one local image/PDF); or `downloadFrom` with `field: "watermark"` |
| Text, image, or PDF stamp | `stampSource`, `stampExpression`, optional `stampPages` and `stampOptions` | `stamp` (one local image/PDF); or `downloadFrom` with `field: "stamp"` |
| Embedded attachments | Optional `embedsMetadata` JSON keyed by **exact** attachment filenames | Repeated `embeds` file parts; or `downloadFrom` with `field: "embedded"` |
| Factur-X / ZUGFeRD | Required `facturxConformanceLevel`, optional `facturxDocumentType` and `facturxVersion` | **One local XML file** as `facturxXml` (not a source or regular attachment; remote descriptors do not support this field) |
| Metadata and flattening | `metadata` (JSON), `flatten` | No extra files |
| Passwords and permissions | `userPassword`, `ownerPassword`, optional `allowPrinting`, `allowCopying`, `allowModifying`, `allowAnnotating`, `allowFillingForms`, `allowAssembling` | No extra files |
| PDF/A and PDF/UA | Existing `pdfa`, `pdfua` fields in **Advanced options** | No extra files |

One watermark and one stamp are supported in this patch, each with optional page ranges and PDF-engine-specific JSON options. Repeated ordered overlays are scheduled separately. Select **Text** to enter content, or **Image/PDF** to select exactly one matching local file. For remote overlays, use Advanced `downloadFrom` JSON. Gotenberg requires the remote server to provide a `Content-Disposition` filename and applies its own outbound URL restrictions. Enter the exact remote filename in the editor (required for image/PDF overlays). Remote attachments likewise use a remote descriptor, not a Gotenui upload.

**Compatibility constraints:** PDF/A and PDF encryption are mutually exclusive. PDF/A-1b/2b cannot contain attachments; use PDF/A-3b (or let Factur-X generate PDF/A-3). PDF/A-1b combined with PDF/UA is not supported. Factur-X and attachment metadata require a compatible PDF engine (QPDF is recommended). Local embedded filenames must be unique, and `embedsMetadata` keys must match them exactly; Gotenui can validate this when no remote attachments are supplied. When combining PDF/A and metadata writing, the upstream converter can overwrite some standard metadata fields. Permission restrictions require a user or owner password and remain PDF-viewer-dependent.

All post-processing files use the existing bounded same-origin Nitro proxy and the selected Gotenberg instance's authentication. Multipart parts have dedicated validated names (`watermark`, `stamp`, `embeds`, `facturxXml`) and count toward the upload budget. UI selections remain in memory only; passwords are not persisted or written to server storage. Browser-managed and server-managed connections, allowlisting, and proxy security policy are unchanged. No new environment variables are required.

## Debug diagnostics and Prometheus metrics (Gotenberg-controlled)

Gotenui no longer implements a separate administrator access key for diagnostics or metrics. Select **Diagnostics** in the header to request the selected instance's `/debug` JSON; from that dialog, open **Prometheus metrics**. If debug is hidden while metrics are shown, a standalone Metrics button appears in the header. The same selected connection's upstream Basic/Bearer authentication is forwarded to Gotenberg, and upstream `401`/`403` responses are respected.

**Runtime UI visibility flags**, read by the server on each connection-settings request:

```dotenv
GOTENUI_SHOW_DEBUG=false
GOTENUI_SHOW_METRICS=false
```

Omit either variable to display that option (the default). Values must be exactly `true` or `false`. Both flags are independent. They affect **only the interface**, not access to `/api/gotenberg/debug` or `/api/gotenberg/metrics`. These routes continue enforcing the exact backend allowlist, same-origin restrictions, no redirects, and safe response handling. **Hiding a button is not an authorisation mechanism.**

Gotenberg's `/debug` route is disabled unless `API_ENABLE_DEBUG_ROUTE=true` is configured on Gotenberg. It can expose sensitive runtime configuration, so enable it only on an appropriately authenticated or network-restricted Gotenberg instance. Gotenui returns up to **1 MB of valid debug JSON**, without exposing upstream cookies. Debug results are kept in memory while the dialog is open and are not persisted by Gotenui.

For legacy `GET /prometheus/metrics`, the read-only Gotenui viewer filters, copies, and downloads up to **2 MB of valid UTF-8 Prometheus text**. It also uses only the selected connection's upstream auth and does not persist metrics. A disabled/unavailable upstream metrics endpoint returns its error status through the proxy.

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
| `GOTENBERG_BASIC_AUTH_PASSWORD` | **Server-only** legacy Basic Auth password for that URL; like other server-managed credentials, it may be used by anyone allowed to access the proxy. |
| `GOTENUI_SERVER_CONNECTIONS` | Optional server-only JSON array of named connection profiles, each with ID, name, allowed URL and optional Basic/Bearer auth. |
| `GOTENUI_SHOW_DEBUG` | Optional server-only runtime flag (`true` or `false`, default `true`) controlling visibility of the Debug diagnostics option. Does **not** disable the API. |
| `GOTENUI_SHOW_METRICS` | Optional server-only runtime flag (`true` or `false`, default `true`) controlling visibility of Prometheus metrics. Does **not** disable the API. |

For example, to let the Settings UI select either the demo or a private Gotenberg instance:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf.internal.example.com
```

### Stateless multi-instance connections (v1.0.10)

Gotenui supports **two connection types**, with no database, cookies, sessions, or persistent server storage:

1. **Browser-managed:** Users add, rename, remove, and select their own profiles in Connection settings. Each profile stores only its name, URL and authentication *mode* in `localStorage`. For Basic Auth and bearer-token connections, users enter the username/password or token when switching to that connection. Secrets are held in **tab memory only** and sent to the same-origin Gotenui proxy on each request, never persisted by Gotenui. Refreshing the page requires re-entering them.
2. **Server-managed:** Operators provide named profiles via `GOTENUI_SERVER_CONNECTIONS`. Users select a profile by ID; the proxy resolves the exact approved URL and attaches its configured Basic or bearer credentials. The browser receives only the profile ID and name; neither the upstream URL nor credentials are returned. Switching requires no redeployment.

Both modes use the fixed, server-side `GOTENBERG_ALLOWED_URLS` allowlist. **Adding a browser profile cannot add a new allowed destination**; to permit more backends, update the deployment's allowlist. Redirects and arbitrary relay endpoints remain disabled.

Example configuration with a public demo and two private backends:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf-one.example.com,https://pdf-two.example.com
GOTENUI_SERVER_CONNECTIONS=[{"id":"finance","name":"Finance PDFs","url":"https://pdf-one.example.com","auth":{"type":"basic","username":"service","password":"secret"}},{"id":"records","name":"Records PDFs","url":"https://pdf-two.example.com","auth":{"type":"bearer","token":"example-token"}}]
```

**Important security trade-off:** An authenticated server-managed connection acts as a shared service credential. Without Gotenui-specific access keys, **anyone able to reach the Gotenui proxy can select that profile and invoke Gotenberg with its configured credentials**, including the debug and metrics routes when upstream permits them. Protect Gotenui with an identity-aware reverse proxy, network access rules, and rate limits, or prefer user-managed connections (users supply their own upstream credentials). Do not deploy a publicly reachable Gotenui instance with privileged server-managed credentials unless this is intentional. Gotenui still never sends server-managed secrets to the browser or attaches them when a user selects the same URL as a browser profile.

The v1.0.9 `GOTENBERG_BASIC_AUTH_*` variables remain supported as an explicit `legacy-basic` profile, subject to the same shared-service-credential warning. The former `GOTENUI_PROFILE_ACCESS_KEY` and `GOTENUI_DEBUG_ACCESS_KEY` environment variables are ignored and should be removed from deployment settings.

For browser-managed Basic/Bearer credentials, user-entered secrets are forwarded only to that exact approved destination, never automatically to other profiles, and **never to the public Gotenberg demo**. Any local profile's URL or auth mode can be edited; credentials must be re-entered on each switch. Use HTTPS for private remote Gotenberg instances; Base64-encoded Basic Auth is not encryption. The app may relay privileged document operations and URL-fetching by Gotenberg itself, so follow Gotenberg's network isolation guidance.

**SSR/SSRF policy:** Every selected URL must match the allowlist exactly (including path prefixes); server profile IDs cannot override URLs or authentication; client headers/cookies are never blindly forwarded; redirects are rejected; and the proxy accepts only pre-defined Gotenberg operations. Because DNS can be rebinding-prone and allowlisted hosts can point to private infrastructure, only allow backends you operate or explicitly trust, protect the proxy at the edge, and consider egress controls on the serverless runtime.

The proxy buffers and validates incoming multipart data in memory (up to the configured limit), then streams the upstream response back to the browser. Neither uploads nor results are intentionally persisted by Gotenui. Browser download previews and activity remain in memory until the tab closes. Your host or Gotenberg may enforce separate limits or log requests.

### Request size limits

The browser currently caps uploaded files at **4,000,000 bytes** and the proxy caps its entire multipart body at **4,200,000 bytes** by default. This leaves some overhead under Vercel Functions' **4.5 MB request limit**, although large form fields and generated output can still hit host limits. Vercel also applies a 4.5 MB limit to function responses; some streaming configurations behave differently. For large conversions use a Node/other hosting platform with suitable limits, then increase `VITE_GOTENUI_MAX_UPLOAD_BYTES` and `GOTENUI_MAX_REQUEST_BYTES` appropriately. The public Gotenberg demo has its own limit of **5 MB per request** and rate limit of **2 requests per second per IP**; it is intended for evaluation, not production.

## API contracts

- `GET /api/gotenberg/connections` — returns `{connections:[{id,name}],features:{showDebug,showMetrics}}`; **no server-managed URLs, passwords, or tokens**. Feature flags are display preferences, not API permissions.
- `GET /api/gotenberg/status?url=<encoded-base-url>` — status for a browser-managed URL, with optional `X-Gotenui-Upstream-Authorization` for user-supplied Basic or Bearer auth.
- `GET /api/gotenberg/status?connection=<profile-id>` — status for a server-managed profile; no separate Gotenui access key.
- `HEAD /api/gotenberg/health?url=<encoded-base-url>` or `?connection=<profile-id>` — lightweight, **bodyless** upstream `HEAD /health` probe. Uses the same browser-supplied or server-managed upstream credentials as the corresponding status request. Returns **200** for healthy, **503** for unhealthy, **401/403** for upstream authentication/authorisation failures, or **502/504** for unexpected gateway failures/timeouts. A browser-managed URL not on the allowlist is rejected with **403**. Never forwards upstream cookies or headers; includes an `X-Gotenui-Health-Probe: 1` header so the browser can reject a static-host SPA fallback. Because Gotenberg's own `/health` can be public even when document operations require Basic Auth, use the full status endpoint to check credentials and version.
- `POST /api/gotenberg/debug` — read-only JSON from upstream `GET /debug`, with the normal connection selector and upstream authentication. No Gotenui admin key.
- `POST /api/gotenberg/metrics` — bounded Prometheus exposition from upstream `GET /prometheus/metrics`, with the normal connection selector and upstream authentication. On success returns `text/plain; charset=utf-8` with `X-Gotenui-Metrics: 1`; protects against static SPA fallback, and does not forward upstream cookies or authentication challenges.
- `POST /api/gotenberg/convert` — validated multipart form with `payload`, `files`, and `auxiliary` fields. Browser-managed requests supply `X-Gotenberg-Url` and optional `X-Gotenui-Upstream-Authorization`; server-managed requests supply `X-Gotenui-Connection-Id`. **Do not combine modes.** The proxy reconstructs approved Gotenberg multipart fields and forwards only the selected upstream auth.

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
