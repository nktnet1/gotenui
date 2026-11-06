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

The browser sends conversions through `/api/gotenberg/*`. The server validates requests, checks the configured upstream allowlist and forwards them to Gotenberg. Gotenui has no database, persistent job queue, callback inbox or document storage. A 202/204 webhook response confirms only acceptance: the UI shows the output/events receiver origins and optional trace ID but cannot verify callback delivery.

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
| `pnpm test`                | Run unit and both integration suites concurrently                       |

Build before running `test:smoke` or `test:browser`. Browser tests need Chrome or Chromium. Override discovery with `GOTENUI_BROWSER_BIN` when needed.

Integration tests require Docker. `pnpm test` starts three independent Vitest processes concurrently: **unit**, **Gotenberg 8.40.0**, and **Gotenberg 9.0.0**. `pnpm test:integration` runs the two pinned Docker suites concurrently without the unit suite. Output is streamed live with Turbo-style **`[unit]`**, **`[v8]`**, and **`[v9]`** prefixes on stdout and stderr, including Docker image-pull progress. Whole lines stay together even when the suites run concurrently; each suite retains its own exit status and error summary. Each Docker suite uses a unique container name, an ephemeral host port, and its own fixture HTTP server. Missing images are pulled with visible progress; locally cached images are reused. Parallel execution needs enough memory for two Gotenberg instances (including Chromium and LibreOffice) **and the unit Vitest workers**. To run all three suites sequentially on a constrained machine, set `GOTENUI_TEST_SEQUENTIAL=1` when invoking `pnpm test`; the version-specific integration commands remain available. The version-specific commands above select just one image, as does the CI `GOTENBERG_TEST_VERSION` matrix variable. The v9-specific PDF integration cases generate a temporary interactive PDF form and certificate/key pair; an `openssl` executable must be available on the host running those tests. They do not require a live timestamp authority. Tests verify the actual upstream `/version`, use local fixtures and never contact the public demo. Version-specific tests are expected to be skipped when the _other_ image is running, but both suites must finish successfully. CI runs unit, build, production smoke, browser smoke and both Docker integration checks.

Node CLI scripts import project modules via extensionless package subpaths: `#scripts/name` resolves to `scripts/name.ts`, and `#/lib/name` resolves to `src/lib/name.ts`. Node resolves these through `package.json` `imports`; Vite/Vitest also use the corresponding `tsconfig.json` paths for source files, including TSX. Avoid extensionless relative ESM imports such as `./test-process`, which native Node does not resolve, and avoid adding `.ts` to import specifiers.

Keep `pnpm-lock.yaml` in sync when updating dependencies. Do not edit generated files by hand.

## API overview

| Endpoint                         | Purpose                                          |
| -------------------------------- | ------------------------------------------------ |
| `GET /api/gotenberg/connections` | List public names and IDs of managed connections |
| `GET /api/gotenberg/status`      | Check health and version of a selected instance  |
| `HEAD /api/gotenberg/health`     | Run a lightweight health probe                   |
| `POST /api/gotenberg/convert`    | Submit a conversion or PDF operation             |
| `POST /api/gotenberg/debug`      | Read upstream debug data                         |
| `POST /api/gotenberg/metrics`    | Read v8 legacy metrics or configured exporter    |

Conversion requests use multipart `payload`, `files` and `auxiliary` fields, plus optional `stageFile` (v9 pipeline assets) and `archives` (v9 Office ZIP inputs). Browser-managed requests select a backend URL, while managed requests use an approved connection ID. The server never returns managed credentials to browsers.

To add a tool, create `src/tools/<tool-id>/config.ts` exporting an `Operation`, then import it in `src/tools/registry.ts` in the desired display order. The homepage, sidebar, search and `/tools/$operationId` route use that single registry. Reuse field groups and components in `src/tools/shared/`; `src/lib/operations.ts` is a compatibility re-export.

For payload options, see `src/tools/` and `src/lib/validation.ts`. Upstream API documentation is at [gotenberg.dev](https://gotenberg.dev/docs/getting-started/routes). On Gotenberg 8, the metrics proxy authenticates and checks `/version` before fetching legacy `/prometheus/metrics`. Gotenberg 9 removed that route; only a server-managed `metricsUrl` pointing at a separate OpenTelemetry Prometheus exporter can provide metrics. The exporter is not auto-discovered and Gotenberg authorization is not forwarded to it.

## Gotenberg 9 PDF pipeline builder

The **PDF pipeline builder** is available only when the selected connection reports Gotenberg 9.0.0 or later in major version 9. Gotenberg 8 keeps its existing standalone tools, endpoints and PDF controls unchanged.

1. Select **PDF pipeline builder** and upload one or more input PDFs.
2. Add processing stages and use **Move up** / **Move down** to change execution order. Set each stage's options as a JSON object (without an `op` key). The editor starts with a lossless `optimize` stage.
3. Upload any stage-referenced PDFs, images, invoices, attachments or signing credentials under **Additional stage files**; the filenames in stage settings must match exactly. For example, attach a text file named `receipt.txt` with `{"file":"receipt.txt"}` in an **Attach file** stage.
4. Check the **Preview ordered stages** output before submitting. It hides passwords and signing keys, but stage settings are visible while editing. Redaction also requires explicit acknowledgement. Treat the output as unverified until inspecting the resulting document.

The adapter sends a single multipart request to `/forms/pdf/pipe` using the ordered `stages` JSON and uploads named inputs under `files`. The server independently validates stage settings, ordering and references; it rejects unsupported legacy options. The output is PDF or ZIP, or PNG/JPEG/ZIP when rendering is the last stage. The standalone builder accepts **uploaded PDFs** as input; the conversion-time editor below applies the same processing stages to newly generated PDFs.

## Conversion-time PDF stages (Gotenberg 9)

On a **Gotenberg 9** connection, the **URL/HTML/Markdown to PDF** and **Office to PDF** tools offer **PDF processing after conversion**. Select **Add pipeline**, arrange stages with the same 26-stage editor as the standalone PDF pipeline builder, and upload any referenced files under **Pipeline stage files**. Each file must have a unique filename that does not collide with the input documents, HTML/Markdown assets, or generated source files. The browser validates the stage list and references; the proxy revalidates them, including the redaction acknowledgement, before sending a multipart request to the original Chromium or LibreOffice conversion route. All pipeline inputs remain local to the request and batch queue.

Office merge/split controls run before the user-defined stages. When a PDF/A or PDF/UA profile is chosen, the final remediation stage runs after user-defined edits rather than letting later edits silently invalidate the profile. An explicit `remediate` stage conflicts with automatic remediation; disable the built-in profile settings to use a custom remediation stage. Decryption is not supported in a conversion-time pipeline because the converted PDF is not encrypted yet; use the standalone PDF pipeline builder for an already encrypted input. A `render` stage can return an image or ZIP archive, depending on whether the pipeline retains the PDF alongside the image.

Gotenberg 9 conversion forms now expose **eleven PDF/A** and **two PDF/UA** conformance profiles. The Office form offers a conformance method: **Automatic** uses native LibreOffice export when available and otherwise uses a `remediate` stage; **Native** rejects unsupported profile combinations; **Remediate** always inserts a stage. Combining PDF/A-4 variants with PDF/UA requires PDF/UA-2; earlier PDF/A profiles require PDF/UA-1. Gotenberg 8 retains its existing PDF/A select and PDF/UA switch. A completed response must not be interpreted as proof of PDF/A/UA compliance without inspecting the remediation diagnostics or validating the output.

Direct Office uploads follow the exact v8.40.0 or v9.0.0 extension list. Both support `.sdw` and `.uot`; `.epub` is supported by v8 only. The proxy checks each uploaded extension against the authenticated upstream `/version` before conversion; the browser picker is only a convenience. Chromium PDF and screenshot tools also offer **Wait for window.status**, mapped automatically to `waitForWindowStatus` on v9. On v9 Office exports, bookmark expansion accepts only `-1` or `1`–`10`, and a plain and tiled native watermark cannot be combined.

On Gotenberg 9, Office conversion also accepts optional **Office ZIP archives** through a separate upload area. Each ZIP is sent as `archives`, not as `files`. The proxy validates the filename, combined request size, and a maximum of ten archive uploads; it does not inspect the ZIP's entries. Gotenberg validates and extracts the archive, counts extracted files toward its own limits, and rejects invalid, encrypted or oversized entries. The UI can upload ordinary Office files alongside ZIPs. Gotenberg 8 does not support this upload path and rejects it before conversion. The v9 archive integration test uses an in-memory ZIP fixture and checks the extracted document's generated PDF with the upstream info endpoint.

The older Gotenberg 8 conversion post-processing editor and request formats are unchanged. Existing v8-only post-processing options cannot be automatically converted to equivalent v9 options, especially behind-content watermarks and lossy image optimisation. Those must be recreated with an explicit v9 stage where semantically appropriate. A Gotenberg 8 connection rejects conversion-time stages rather than silently ignoring them.

The integration command uses pinned images `gotenberg/gotenberg:8.40.0` and `gotenberg/gotenberg:9.0.0`. The v9 `pdf-attachments` and `pdf-form` endpoints can return valid short JSON documents; their tests validate parsed structures rather than imposing a minimum byte length intended for document/image outputs. On v9, a `render`-only stage yields images, while a pipeline that modifies the document before `render` returns a ZIP containing the edited PDF and image files; integration tests inspect both entries.

## Connection switching and version drift

The workspace only uses a status response for the currently selected connection and credential epoch. A status reply from a previous connection cannot enable its tools after switching servers or changing credentials. Each conversion separately probes the selected upstream's authenticated `/version` before choosing its v8 or v9 request adapter. When the conversion response includes `Gotenberg-Version`, the proxy also checks that the **responding major** matches the probed major; if the upstream changes or a load balancer routes to a different major mid-request, a successful PDF is rejected with HTTP 409 rather than returned under the wrong contract. An invalid version header is a gateway error (HTTP 502). If the upstream has already accepted an asynchronous webhook job (HTTP 202/204), the proxy returns HTTP 502 and warns that the callback may still arrive; check the receiver before retrying to avoid duplicate jobs.

A browser or direct proxy request without the required upstream credentials can now receive HTTP 401 during the `/version` probe, **before** the metrics endpoint is requested. Unit and integration tests should expect the proxy function to throw `ProxyInputError` for that preflight rejection, or exercise the HTTP handler to verify the response. The v8 legacy metrics route remains available with valid authentication; v9 never uses it.

For direct outputs, the browser derives the download name from the **actual response media type**. For example, a requested PDF filename can become `.zip` when a Gotenberg 9 stage returns PDF and rendered images together. Inspect the contents and remediation headers; HTTP 200 alone does not establish PDF/A or PDF/UA conformance.
