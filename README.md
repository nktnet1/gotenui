# Gotenui

A **stateless TanStack Start document workbench** for Gotenberg 8.x. The interface uses React 19, TypeScript 7, Tailwind CSS 4, shadcn-style components, Valibot, url-join, Biome and Sonner. Nitro runs the same-origin API routes on Vercel, another serverless provider, or a Node server. No database, session storage or persistent disk is required.

See [ROADMAP.md](ROADMAP.md) for the remaining feature gaps, priorities, and proposed delivery sequence.

## Features

- 22 Chromium, LibreOffice and PDF-engine operations, including HTML, Markdown, URL and Office conversions, screenshots, merging, metadata, bookmarks, watermarks and Factur-X.
- First-class upstream options for Office merging/splitting, LibreOffice image compression, conversion-time PDF image optimization (Gotenberg 8.36+), and Chromium rendering/error checks. The Office picker and server share the documented extension catalogue, including modern slide shows and legacy document formats.
- Custom Chromium PDF headers/footers and multi-file Markdown templates, with editable/importable HTML and named, reorderable Markdown sources. HTML-to-PDF and HTML screenshot editors can import a local UTF-8 `.html` or `.htm` file without separately uploading it.
- Single-request PDF conversion plus ordered watermark/stamp overlays, attachments, Factur-X XML, metadata, flattening and encryption.
- Structured, repeatable `downloadFrom` remote-file and asynchronous webhook editors, with per-destination headers, redacted previews, and backwards-compatible JSON inputs; validated server-side and forwarded through the same-origin proxy.
- Pure vector `public/gotenui-icon.svg`, used as the in-app mark and browser favicon.
- Multiple named connections in **Connection settings**: browser profiles are saved in `localStorage` (`gotenui.connections.v1`), with automatic migration from the former `gotenui.backend-url.v1` preference. Default: **https://demo.gotenberg.dev**. Server-managed profiles are configured through environment variables, with credentials kept server-side.
- Conversions and health/version checks call **same-origin `/api/gotenberg/*` routes**. Nitro makes server-to-server requests to Gotenberg, so **the demo requires no CORS configuration**.
- Input validation in both browser and server, explicit destination allowlist, independent per-connection Basic Auth, bearer-token or server-managed OAuth2 client-credentials support, with server-side credentials never exposed to browsers, streaming conversion responses, three-minute request timeout and an in-memory activity list.
- A responsive appearance menu (icon on mobile, icon plus label on desktop) with **System** (monitor icon, the default), **Light** (sun icon), and **Dark** (moon icon). The expanded menu shows each icon and label, supports arrow keys, Home, End, Escape, and restores focus to the trigger. The app follows operating-system changes while System is selected and stores an explicit Light/Dark override in browser `localStorage` (`gotenui.color-theme.v1`). Switching back to System clears the override. Only the visual preference is stored, never Gotenberg credentials or documents. Buttons and form controls have distinct light/dark contrast states.
- Clear bookmark-action icons in the sidebar, and a plain **Gotenui** brand name without the decorative trailing period; the SVG gopher icon is unchanged.
- Optional debug JSON (`GET /debug`) and Prometheus-compatible metrics (a configured OpenTelemetry Prometheus exporter or legacy `GET /prometheus/metrics`) within **Diagnostics** for the selected instance. The metrics tab opens directly to its read-only controls without a separate warning card. Gotenberg controls access; `GOTENUI_SHOW_DEBUG` / `GOTENUI_SHOW_METRICS` hide only their respective actions without disabling the API routes.
- Optional **browser batch queue** for running multiple configured operations without any server-side jobs. Add an operation, switch tools if needed, then start up to two requests at once. Pause or cancel pending work, cancel an individual request, retry failures, and download each completed result. Webhook requests are marked accepted rather than completed. Queue contents are tab-local and never saved to browser storage.
- Results download automatically and remain available in the current tab until cleared or replaced. PDF results have an optional embedded browser preview and a new-tab fallback, while screenshots and JSON retain their existing previews. **Clear** releases the current browser Blob URL without removing the session activity list. ZIP archives download without an inline preview. No server-side output storage or PDF viewer endpoint is introduced.
- The **Run health probe** action inside Diagnostics sends an authenticated, same-origin `HEAD /api/gotenberg/health` request to check Gotenberg without downloading a JSON body. HTTP 200 means healthy and 503 means unhealthy. The existing full status check remains responsible for verifying credentials against `/version`. Full status polling requires upstream HTTP 200 for successful health/version bodies, cancels unread non-200 responses, and rejects malformed or incomplete diagnostic response lengths, avoiding retained streams and false healthy reports during repeated checks.
- Keyboard-focused connection and diagnostics dialogs: initial focus, Tab/Shift+Tab containment, Escape dismissal and focus restoration. The mobile navigation drawer uses the same focus handling and is hidden from tab navigation when closed.

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
pnpm build && pnpm test:smoke  # Exercise the built Nitro server with a local mock backend
```

Vitest integration tests start a **disposable `gotenberg/gotenberg:8.37.0` container with Basic Auth enabled** on a Docker-assigned loopback port and a tiny local HTTP fixture server. The tests exercise the real `proxyConversionRequest` against the local instance, including all 22 processing routes, multipart uploads, PDF/image/ZIP/JSON responses, health, and URL allowlisting. The harness waits for `/health` and destroys the container at teardown. No fixed port or public-demo dependency is required. The suite verifies authenticated conversions for all 22 routes, rejects unauthenticated and incorrect-password requests, and checks the credential-free demo path with unit tests. It also validates upstream-authenticated local `/debug` and `/prometheus/metrics` routes, and tests direct and proxied `HEAD /health` requests. A missing Docker daemon **fails the suite**, rather than silently skipping it. Override the pinned test image with `GOTENBERG_TEST_IMAGE` if needed.

To cover both split response types, the suite merges two locally generated PDF pages and verifies that splitting produces a ZIP with two entries. It also checks the single-page PDF response, multi-document Office and PDF/A ZIP downloads, and uploads a MINIMUM-profile XML fixture for Factur-X.

The integration suite also covers single-request PDF overlays, embedded attachments, Factur-X XML during Office conversion, and remote attachments/overlays from a disposable local fixture server. It includes further Docker scenarios for remote Office downloads with explicit fetch headers, asynchronous success/error/events callbacks, and a callback that retries after a `503` response. Webhook tests use a disposable HTTP receiver and short retry intervals configured **only** on the test Gotenberg container; Gotenui itself does not receive callbacks. These new Docker cases have not yet been verified in this environment. A non-Docker unit test checks the remote overlay PNG's chunk CRCs and decompressed pixel length, because invalid PNG data produces a misleading Gotenberg "unsupported stamp source" response.

The non-Docker **production smoke test** (`pnpm test:smoke`, after `pnpm build`) runs `scripts/smoke-production.ts` directly using Node.js 24's native TypeScript stripping; no transpilation step or additional runner is required. The script is also covered by `pnpm typecheck`. It boots the actual `.output/server/index.mjs` on a temporary loopback port with a disposable local mock upstream. It checks the SPA and SVG, API route availability, runtime connection profiles and visibility flags, health/version, distinct browser/server credentials, PDF and ZIP downloads (including single-result split PDFs), upstream trace/filename forwarding, response size and type enforcement, origin restrictions and destination allowlisting. It also verifies upstream HTTP 401/trace forwarding without cookies, refusal to follow upstream redirects, and the `204` webhook acceptance response without claiming job completion. **Since v1.0.31**, the smoke runner explicitly preserves caller abort signals alongside its 10-second timeout; the built-server checks cover overlapping requests using separate browser/server credentials, cancellation before upstream response headers, cancellation during streamed downloads, and truncated upstream bodies. Cancellation must complete promptly instead of merely expiring the smoke timeout. No external network or Gotenberg container is required. Since v1.0.33 it also rejects an HTTP 200 binary response whose body is actually HTML despite a PDF content type, before forwarding a download. Since v1.0.34 it also checks that inline or misleading upstream filenames are normalized to safe attachment names matching the PDF or ZIP output, and that webhook acceptance does not forward a download disposition. Since v1.0.35 a second built Nitro instance simulates a TLS-terminating reverse proxy and checks explicit public-origin acceptance and spoofed forwarded-host rejection. Since v1.0.36 the same smoke suite verifies that Nitro accepts valid quoted multipart boundaries and optional UTF-8 charset MIME parameters. The mock tests the **built Gotenui deployment**, not Gotenberg's conversion engines or delivery of real webhook callbacks; the pinned Docker suite and manual mobile/accessibility/deployment checks remain separate release gates. CI runs this smoke test immediately after the build.

Since v1.0.40, PDF downloads also require the full PDF version header (`%PDF-1.0` through `%PDF-1.7` or `%PDF-2.0`) rather than a bare `%PDF-`. Binary response preflight rejects an uncompressed upstream `Content-Length` shorter than the required file signature or the bytes already read. These checks run before Nitro sends download headers, without buffering the full document. The smoke suite verifies the incomplete-header rejection through the compiled server; checking the complete PDF structure is still the responsibility of a PDF reader or the upstream conversion engine.

The conversion API accepts standard `multipart/form-data` boundaries with or without quotes and an optional UTF-8 `charset` parameter. For safety, ambiguous or duplicate MIME parameters are rejected; upload size, file validation, and upstream destination checks still apply.

The test setup does **not** change the application's public-demo default. Docker must support the `host-gateway` option so the container can reach the deterministic fixture page. Unit tests mock `fetch` and do not contact any remote host.

### Gotenberg API coverage

Gotenui exposes **all 22 documented `POST /forms/*` routes**: four conversion, three screenshot, and fifteen PDF-engine routes. It queries `GET /health` and `GET /version` for detailed connection status, and exposes `HEAD /health` through `HEAD /api/gotenberg/health` for a no-body health probe. Gotenberg's `GET /debug` endpoint is accessible through `POST /api/gotenberg/debug` when enabled on the selected instance; legacy Prometheus metrics (`GET /prometheus/metrics` upstream) are accessible through `POST /api/gotenberg/metrics`. Both rely on Gotenberg's upstream authentication, not Gotenui access keys. Optional async webhook delivery and `downloadFrom` remote file descriptors are available through structured editors in the Advanced options panel, with legacy JSON entry still available. An OpenTelemetry Prometheus exporter can be read through Diagnostics when its exact `/metrics` URL is configured in a server-managed Gotenui connection; Gotenberg still owns exporter activation and instrumentation.

## Remote inputs and asynchronous webhooks (v1.0.25)

The Advanced options panel now provides **remote file rows** (`downloadFrom`) with a URL, destination field (`regular`, `embedded`, `watermark`, or `stamp`), and optional named HTTP headers for that specific fetch. Use **Add remote file** for up to 20 entries, with up/down controls for changing their order. The remote server must provide a valid `Content-Type` and a `Content-Disposition` header with a `filename` parameter; an S3 presigned URL alone is not sufficient without this response metadata. Files are fetched **by Gotenberg**, not by the browser or Gotenui proxy. The selected instance must allow outbound access to that URL (`API_DOWNLOAD_FROM_*` rules), and the instance may impose additional limits. Remote overlay filenames must match the overlay expressions, with remote image/PDF entries before local ones of the same type. Remote merge ordering is still determined upstream by filename.

The separate **webhook editor** accepts a required success URL and its `POST`/`PUT`/`PATCH` method, optional deprecated error URL/method, recommended structured **events URL** (always `POST`), and shared callback headers. To receive failure details, provide an events or error URL. Gotenberg sends callbacks directly to the external receiver, according to its `WEBHOOK_*` outbound URL and retry settings. A `429`, connection error, or most `5xx` responses triggers a retry; other `4xx` statuses generally do not. Gotenui never receives these callbacks or retains a server-side job history.

After an asynchronous request, Gotenui displays **HTTP 204: accepted for asynchronous processing** (or HTTP 202 if returned) and the `Gotenberg-Trace` correlation ID when available. **This does not mean conversion or delivery succeeded.** Check the external callback receiver to learn the outcome. The acceptance is visible only in the current tab, and it is cleared by the next operation; it is not a status poller. `traceparent` is a separate W3C distributed-tracing identifier sent to callbacks by Gotenberg 8.34+.

Header values are entered into password-style inputs and are **never included in the displayed request preview**. Previews display only URL origins, hiding userinfo, paths, query strings (including presigned tokens), and fragments. The URL and header values still enter the validated request to Gotenberg and the intended remote receiver; do not use them with untrusted destinations. The older `downloadFrom` array and webhook object JSON textareas remain available under **Legacy JSON**. Use **either** the structured inputs **or** legacy JSON for each feature, never both; neither is stored persistently. Server-side validation and proxy HTTP-header isolation are unchanged. Gotenberg's outbound URL filtering is the final enforcement point for external callbacks and downloads; operators should configure it to restrict destinations.

## Download filename safety (v1.0.34)

Gotenui validates the upstream response media type and binary signature, then constructs its own `Content-Disposition: attachment` header for completed downloads. It preserves safe Gotenberg filenames, but removes path components, strips unsafe characters, limits filename length, prevents Windows reserved filenames, and normalizes the final extension to the actual PDF, ZIP, JSON, PNG, JPEG, or WebP response type. The explicitly requested **Output filename** takes precedence over upstream suggestions. A ZIP from a multi-document conversion therefore downloads as `.zip` even if a gateway labels it `.pdf`. Asynchronous webhook acceptance responses do not carry download headers, because no file has been returned.

Unit tests and the built-Nitro smoke suite cover hostile inline and mismatched names. Real Gotenberg and interactive browser verification remain release gates; no new storage, credentials, or configuration are required.

## Merge order, filenames and tracing (v1.0.18)

For **Merge PDFs**, the displayed order is authoritative for locally uploaded PDFs. Gotenberg normally merges files by alphanumeric filename (numeric names first), regardless of upload order. Gotenui assigns temporary numbered names (`01_original.pdf`, `02_original.pdf`, etc.) to **local** multipart uploads to preserve the chosen order. Duplicate local filenames are supported with Gotenberg 8.37+; original PDF bytes are unchanged. For filename-keyed `bookmarks` JSON, Gotenui maps original filenames to their temporary upload names. Where multiple files share the same name, that bookmark mapping applies to each. A Gotenberg-generated title bookmark may display a numbered filename if the original PDF has no Title metadata.

`downloadFrom` remote inputs cannot be reordered from the local upload list. Gotenberg sorts remote filenames together with the submitted files, so **mixed remote/local merges do not guarantee that the visible local order matches the complete merged page order**. For deterministic complete ordering, download remote files and add them as local uploads, then reorder. Gotenberg must permit remote downloads in its own outbound URL configuration.

For file-producing operations, **Output filename** now sets both the browser download name and the upstream `Gotenberg-Output-Filename` header (without extension). When blank, Gotenberg chooses its own filename and Gotenui uses the returned `Content-Disposition`. For metadata/bookmark JSON reads, the field changes the browser download filename only; Gotenberg does not define an output-filename header on these routes.

Advanced options include a validated custom **Gotenberg request ID** (`Gotenberg-Trace`, plain log/webhook correlation ID), **W3C `traceparent`**, and optional `tracestate` for distributed tracing. Gotenberg 8.34+ continues upstream `traceparent` context into asynchronous webhook callbacks. These are different mechanisms: the correlation ID is *not* an OpenTelemetry trace ID. The app only forwards these fields from the validated conversion payload, never arbitrary browser request headers. Upstream error responses retain a safe Gotenberg correlation ID for diagnosis; credentials and cookies are not relayed. No session state or new authentication layer is added.

## Browser batch queue

Use **Add to batch** below an operation to snapshot its current settings, files and selected Gotenberg connection. Repeat for additional tasks, including different operations, then select **Start queue** in the Batch queue panel. At most two requests run at a time. **Pause new jobs** stops the next request from starting, but leaves in-flight conversions alone. **Cancel waiting/running** aborts active requests and discards waiting work. Each failed or cancelled job can be retried individually after its current request settles.

The non-Docker unit suite also verifies that queued snapshots are sent through the same-origin conversion client with their selected connection, files, headers and webhook options. It tests cancellation and retries without a real Gotenberg container.

Batch results remain in the current tab until **Download** or **Clear finished**. Batch jobs never trigger automatic downloads, since browsers often block multiple non-interactive downloads. Gotenberg does not expose percentage completion, so the panel shows queued, running, completed, failed or cancelled status, elapsed time and any trace ID. An accepted webhook means Gotenberg received the request, **not** that a callback was delivered. The normal **Run operation** button and its automatic download remain unchanged.

The queue is **entirely browser-managed and ephemeral**: there is no queue endpoint, session, worker, job store or background task. Jobs use the connection and credentials present when added, even if you switch connections later. Inputs and credentials are released from the queue after a successful result or webhook acceptance. Failed/cancelled jobs retain them in tab memory for retry, until removed. All queue content is discarded on page reload or navigation away. Cancelling a request does not necessarily stop work Gotenberg has already started. There is a 12-job limit, a 32 MB combined input-memory budget, and a 200 MB retained-download budget. Clear finished jobs to free capacity and object URLs. The existing per-request upload, authentication, origin and proxy limits still apply.

## Saved operation presets (v1.0.46)

Operations with reusable controls offer **Saved presets** in their workbench. Enter a name and choose **Save preset**, then select that name later and choose **Apply**. Saving another preset under the same name updates it. You can delete a selected preset after confirmation. Up to 25 presets are kept across operations, with each preset available only on the operation where it was created. The presets are saved in this browser's `localStorage` (`gotenui.presets.v1`) and do not require a Gotenui account, database or server storage.

Only non-sensitive conversion settings are stored: supported page size and margin values, image settings, numeric options, PDF viewer preferences, boolean switches and selected choices. The preset **never saves** uploaded files, document or HTML/Markdown content, source URLs, output names, passwords, cookies, HTTP headers, webhook configuration, remote download entries, tracing IDs, free-text expressions, PDF metadata or Advanced JSON. Preset names are stored locally, so do not include personal data or secrets in them. Applying a preset updates eligible settings and preserves your current document inputs and credentials in browser memory. Settings omitted from the preset return to the operation's defaults.

Presets are tied to the browser profile and are not synchronised between devices. Clearing browser storage removes them. If private browsing restrictions or storage quotas prevent saving, Gotenui reports the failure rather than claiming that the preset was saved. No new deployment environment variables or dependencies are needed.

## Visual PDF metadata and bookmark editors (v1.0.45)

**Write metadata** now has labelled Title, Author, Subject, Creator, Producer, Copyright and Keywords inputs. Keywords are separated with commas and submitted as a JSON list. Use the **JSON editor** tab for less common ExifTool XMP tags and non-text values. Editing a standard field preserves other JSON properties. Metadata writing can affect PDF/A conformance, and not every XMP tag is writable by ExifTool.

**Write bookmarks** now has a visual, nested tree: add top-level or child entries, edit titles and page numbers, reorder siblings, and remove entries with their children. Pages start at **1** and must exist in the selected PDF. Use the **JSON editor** tab for the advanced filename-to-bookmarks mapping supported by Gotenberg, especially when uploading several PDFs. Such maps remain untouched in visual mode. Gotenui checks bookmark titles, pages and nesting before submitting, while Gotenberg validates the actual page ranges. Both editors still submit the official `metadata` and `bookmarks` JSON multipart fields and retain per-operation Advanced options. No content is stored on the server.

## Chromium PDF headers, footers and Markdown templates (v1.0.20)

The **Website to PDF**, **HTML to PDF** and **Markdown to PDF** workbenches accept optional **Header HTML** and **Footer HTML**. Paste complete HTML documents into the editors or load `.html` files into them. The API proxy creates the required `header.html` and `footer.html` file parts for Gotenberg; these are not separate form fields. Uploaded assets with reserved filenames (`header.html`, `footer.html` or `index.html`) are rejected to avoid collisions. **Screenshot** routes have no PDF header/footer controls.

Chromium renders headers and footers in an **isolated context**: the main document's CSS does not apply, external assets cannot be loaded and scripts do not execute. Use a complete document with `<html>`, `<head>` and `<body>`, inline CSS and base64/data-URI images. Set suitable `marginTop` and `marginBottom` (for example `0.8` inches) to prevent clipping. Chromium supports placeholder elements such as `<span class="pageNumber"></span>` and `<span class="totalPages"></span>`.

The **Markdown to PDF** and **Markdown screenshot** workbenches retain their editable initial `document.md`, and now allow renaming it and adding, importing, removing or reordering more `.md` sources (up to 20 total). The default `index.html` template is generated automatically from their displayed order. Use **Customize template** or load your own `.html` template to control layout and render order with Gotenberg's `{{ toHTML "filename.md" }}` action. Return to **Use generated template** to track source changes automatically. When using a custom template, every listed Markdown source must be referenced and every reference must match a submitted filename, including case.

All Chromium HTML, Markdown and asset files share **one flat Gotenberg directory**: reference stylesheets and images by basename (for example `style.css`), not absolute paths or subdirectories. Markdown sources have unique case-insensitive `.md` names; reserved filenames, missing template references, empty Markdown sources and asset name collisions are rejected before proxying. Existing one-file Markdown conversions retain their previous request contract. These editors and imports are per-tab, in-memory only; no state is added to the server or stored between sessions.

## Advanced Chromium and LibreOffice controls (v1.0.23)

**Chromium PDFs** now have typed controls for `singlePage`, `preferCssPageSize`, tagged PDF structure and generated document outlines, plus page-render waits (`waitDelay`, `waitForSelector`, `waitForExpression`) and a User-Agent override. **Chromium screenshots** also support the page waits, User-Agent override, and browser network settings, but not PDF-only options. The server enforces which fields each route accepts. `singlePage` overrides paper height and native page ranges; `preferCssPageSize` uses the document's CSS `@page` dimensions. Document outlines automatically enable tagged output upstream. Selector/expression waits execute inside the rendered page, so use trusted expressions.

**Chromium website authentication** provides repeatable in-memory cookie rows (name, value, domain, path, HTTPS-only, HTTP-only, SameSite) and URL-scoped resource headers. Each resource header has a value and an explicit URL-matching regular-expression scope; for example `^https://portal\.example\.com/`. These settings become validated Gotenberg multipart `cookies` and `extraHttpHeaders` **form fields**, never incoming proxy HTTP headers or headers forwarded to Gotenberg itself. Chromium can send them to the destination page **and its subresources**, so match only the intended HTTPS host; the UI masks values, but it is not a secret vault. Gotenberg enforces outbound URL filtering and controls cookie-jar isolation. Browser-managed credentials stay in memory while the workbench is open; server-managed Gotenberg connection credentials remain an operator responsibility. Do not include browser authentication in an unscoped Advanced JSON field.

**LibreOffice conversions** now expose a separate **source-document opening password** (`password`), slide/notes export options, bookmark/index/form-field controls, and PDF viewer preferences (initial page, sidebar, zoom, page layout, title, full-screen and toolbar visibility). This password unlocks the **input document**; PDF output passwords and permissions are still configured independently in **PDF post-processing**. Neither kind of password is stored by Gotenui. Source passwords are sent upstream only for the current request.

LibreOffice export options depend on the source format: notes-page and hidden-slide options apply to **Impress** presentations, `singlePageSheets` applies to **Calc** sheets, and `skipEmptyPages` applies to **Writer** documents. Native PDF form-field export defaults to **on**; turn it off to flatten native form fields. `exportBookmarks`, `updateIndexes`, and `displayPDFDocumentTitle` default to **true** upstream, and the UI reflects those defaults. Custom viewer zoom requires **Custom zoom** magnification; first-page-on-left requires the two-column layout. Viewer preferences are advisory and may be interpreted differently by PDF readers.

This release introduces no API endpoints, server sessions, database, new environment variables, dependencies or Gotenui-specific authentication. Unit tests cover validation, route applicability, multipart serialization and proxy header isolation. Docker integration tests are provided but were not executed in this environment.

## Upstream conversion controls

**Office to PDF** accepts Gotenberg's documented LibreOffice extensions, including `.dotx`, `.xltx`, `.potx`, `.pub`, `.psd`, and the `.ppsx`/`.ppsm` slide-show additions. The file-picker filter and server allowlist use the same catalogue. Availability of a format does not guarantee perfect visual fidelity; conversion depends on the connected Gotenberg/LibreOffice installation.

The **Combine & split output** section merges Office files into one PDF, or splits by PDF-engine page ranges or positive page-count intervals. With merge enabled, local uploads can be reordered and are sent with temporary numbered filenames to match Gotenberg's alphanumeric sorting. Duplicate local filenames are supported in this mode. Remote `downloadFrom` inputs are not reordered; mixed remote and local files still follow upstream filename sorting. Split page syntax depends on the configured PDF engine and is intentionally not restricted to one engine's page-range grammar. Without merge, multiple independent Office files yield a ZIP; a split may also yield a ZIP.

**Image compression & optimization** offers two distinct steps on Office conversions: native LibreOffice lossy/lossless compression, JPEG `quality`, image downsampling and DPI, plus optional PDF-engine `optimizeImages`/`imageQuality` post-processing. Conversion-time optimization is also available for Chromium PDF conversion and PDF merge/split operations. These post-processing flags and the standalone Optimize PDFs operation require **Gotenberg 8.36+**; the controls are disabled when the connected server reports an older version. Unknown or unavailable version information is treated as unknown rather than as proof of support.

All Chromium PDF and screenshot tools have a **Rendering & error checks** section for HTTP status failures, ignored asset domains, failed-resource loading, console exceptions and network-idle waits. Comma-separated codes and domains are validated and serialized to Gotenberg's required JSON arrays. The normal UI submits the official form fields directly. **Advanced JSON** remains for exceptional upstream options; it is not a substitute for the controls above, and duplicate options are rejected.

Gotenui also reads Chromium/LibreOffice module health details for the selected connection to disable tools that are known to be unavailable. If module details are missing, it does not guess whether an operation is supported, nor does it claim that all PDF engines are available. Server-side validation and Gotenberg's actual version/module configuration remain authoritative.

## Ordered watermarks, stamps and conversion post-processing (v1.0.22)

The **Website to PDF**, **HTML to PDF**, **Markdown to PDF**, and **Office to PDF** workbenches include an optional **PDF post-processing** editor. Gotenui sends these options to the **same** Gotenberg conversion endpoint rather than converting a PDF twice or storing an intermediate result. Screenshot operations do not support PDF-engine post-processing; PDF tools retain their own dedicated controls.

| Feature | Gotenberg form fields | Upload part / remote input |
| --- | --- | --- |
| Ordered text, image, or PDF watermarks | Repeated `watermarkSource`, `watermarkExpression`, `watermarkPages`, `watermarkOptions` (parallel fields) | Repeated `watermark` file parts; or `downloadFrom` with `field: "watermark"` |
| Ordered text, image, or PDF stamps | Repeated `stampSource`, `stampExpression`, `stampPages`, `stampOptions` (parallel fields) | Repeated `stamp` file parts; or `downloadFrom` with `field: "stamp"` |
| Embedded attachments | Optional `embedsMetadata` JSON keyed by **exact** attachment filenames | Repeated `embeds` file parts; or `downloadFrom` with `field: "embedded"` |
| Factur-X / ZUGFeRD | Required `facturxConformanceLevel`, optional `facturxDocumentType` and `facturxVersion` | **One local XML file** as `facturxXml` (not a source or regular attachment; remote descriptors do not support this field) |
| Metadata and flattening | `metadata` (JSON), `flatten` | No extra files |
| Passwords and permissions | `userPassword`, `ownerPassword`, optional `allowPrinting`, `allowCopying`, `allowModifying`, `allowAnnotating`, `allowFillingForms`, `allowAssembling` | No extra files |
| PDF/A and PDF/UA | Existing `pdfa`, `pdfua` fields in **Advanced options** | No extra files |

The **Watermark PDFs** and **Stamp PDFs** tools, as well as all four PDF conversion workbenches, support up to **10 ordered entries per overlay type** with add, remove, and move-up/down controls. Each entry independently selects **Text**, **Image**, or **PDF**, with optional page ranges and PDF-engine-specific JSON options. Gotenui sends the repeated scalar fields with `FormData.append`, including empty `Pages`/`Options` placeholders to keep each field list aligned; images and PDFs are submitted as repeated, correctly ordered multipart uploads. Older API clients using the original single `watermark`/`stamp` setting remain supported for conversion routes.

To reference a remote overlay, use Advanced `downloadFrom` JSON with its `field` set to `"watermark"` or `"stamp"`, and enter the expected `Content-Disposition` filename in the corresponding editor row. **Within each overlay type, remote image/PDF rows must come before local image/PDF rows**: Gotenberg downloads remote files before it processes local multipart uploads. Text rows can appear anywhere. Remote responses must provide their expected filename through `Content-Disposition`, and Gotenberg enforces its own outbound URL restrictions. Filename matching is checked for local files and validated for safe, unique names; remote filenames are confirmed only by Gotenberg at download time. Remote attachments likewise use a remote descriptor, not a Gotenui upload.

**Compatibility constraints:** PDF/A and PDF encryption are mutually exclusive. PDF/A-1b/2b cannot contain attachments; use PDF/A-3b (or let Factur-X generate PDF/A-3). PDF/A-1b combined with PDF/UA is not supported. Factur-X and attachment metadata require a compatible PDF engine (QPDF is recommended). Local embedded filenames must be unique, and `embedsMetadata` keys must match them exactly; Gotenui can validate this when no remote attachments are supplied. When combining PDF/A and metadata writing, the upstream converter can overwrite some standard metadata fields. Permission restrictions require a user or owner password and remain PDF-viewer-dependent.

All post-processing files use the existing bounded same-origin Nitro proxy and the selected Gotenberg instance's authentication. Multipart parts have dedicated validated names (`watermark`, `stamp`, `embeds`, `facturxXml`) and count toward the upload budget. UI selections remain in memory only; passwords are not persisted or written to server storage. Browser-managed and server-managed connections, allowlisting, and proxy security policy are unchanged. No new environment variables are required.

### Chromium appearance, page selection and accessibility (v1.0.3)

All six Chromium PDF/screenshot workbenches now include **Browser appearance & accessibility** choices for CSS colour scheme, reduced motion, colour gamut and forced colours. The selectors produce a single, validated `emulatedMediaFeatures` JSON array in the outbound multipart form, not four Gotenberg-specific fields. Unset selectors stay unset. **Chromium PDFs** also expose transparent background (`omitBackground`) and native page ranges (`nativePageRanges`); as upstream documents, `singlePage` takes precedence over page ranges. `emulatedMediaType` remains available for print/screen styles. Advanced JSON supports unusual media features but cannot also override a selection made in the visual controls.

## Debug diagnostics and Prometheus metrics (Gotenberg-controlled)

Gotenui no longer implements a separate administrator access key for diagnostics or metrics. Select **Diagnostics** in the header to run the fixed-width `HEAD /health` probe, regardless of the debug/metrics visibility flags. When enabled, **Debug** (`/debug`) and **Prometheus** (`/prometheus/metrics`) are adjacent tabs in the same dialog; the panel state and metrics filters remain available when changing tabs. Arrow keys, Home, and End change tabs, and their respective UI visibility flags continue to apply independently. The redundant debug warning panel has been removed; the security trade-off remains documented here. For Debug, the selected connection's upstream Basic/Bearer authentication or server-managed OAuth2 access token is forwarded to Gotenberg. Metrics use that same authentication only for the legacy endpoint; a configured OpenTelemetry exporter receives separate credentials, if explicitly provided. Upstream `401`/`403` responses are respected.

**Runtime UI visibility flags**, read by the server on each connection-settings request:

```dotenv
GOTENUI_SHOW_DEBUG=false
GOTENUI_SHOW_METRICS=false
```

Omit either variable to display that option (the default). Values must be exactly `true` or `false`. Both flags are independent. They affect **only the interface**, not access to `/api/gotenberg/debug` or `/api/gotenberg/metrics`. These routes continue enforcing the exact backend allowlist, same-origin restrictions, no redirects, and safe response handling. **Hiding a button is not an authorisation mechanism.**

Gotenberg's `/debug` route is disabled unless `API_ENABLE_DEBUG_ROUTE=true` is configured on Gotenberg. It can expose sensitive runtime configuration, so enable it only on an appropriately authenticated or network-restricted Gotenberg instance. Gotenui accepts debug JSON only from upstream HTTP 200, returns up to **1 MB of valid debug JSON**, rejects invalid uncompressed response lengths, and does not expose upstream cookies. Debug results are kept in memory while the dialog is open and are not persisted by Gotenui.

The read-only Gotenui viewer filters, copies, and downloads up to **2 MB of valid UTF-8 Prometheus-compatible text** only from upstream HTTP 200, rejecting malformed or incomplete uncompressed response lengths. Results remain in memory; the selected source (OpenTelemetry or legacy) is displayed. A disabled or unavailable endpoint returns a safely described error through the proxy.

**OpenTelemetry exporter setup:** Gotenberg deprecated `/prometheus/metrics` in **8.29.0**. For a Prometheus-compatible scrape endpoint, run Gotenberg with `OTEL_METRICS_EXPORTER=prometheus` (normally `localhost:9464/metrics`). When Gotenui runs in a **different container or host**, set `OTEL_EXPORTER_PROMETHEUS_HOST=0.0.0.0` on Gotenberg to permit the separate exporter to bind outside its loopback interface, and restrict port 9464 to trusted networks. Register that exporter using a **server-managed** connection's `metricsUrl`; Gotenui always selects this endpoint for that profile, falling back to the legacy `/prometheus/metrics` route for other profiles. A separately configured `metricsAuth` is optional; the Gotenberg conversion token is **never forwarded to the exporter**. For example:

```dotenv
GOTENBERG_ALLOWED_URLS=https://pdf.internal.example.com
GOTENUI_SERVER_CONNECTIONS=[{"id":"internal","name":"Internal","url":"https://pdf.internal.example.com","metricsUrl":"http://gotenberg:9464/metrics"}]
```

An exporter URL must be an absolute HTTP(S) URL ending exactly in `/metrics`, without credentials, query parameters or a fragment; it is configured on the **server only**, never supplied by the browser. Optional credentials use `"metricsAuth":{"type":"bearer","token":"..."}` or Basic Auth with `username`/`password`. Protect exporter networking and the Gotenui proxy: the ability to select a server-managed profile grants access to its configured metrics. Gotenui deliberately does not proxy arbitrary browser-selected collector URLs, OTLP ingestion, or management APIs. A Prometheus scrape endpoint is different from an OTLP push exporter. See [Gotenberg telemetry](https://gotenberg.dev/docs/telemetry).

Legacy profiles still require the default `/prometheus/metrics` endpoint path; if an instance changes `PROMETHEUS_METRICS_PATH`, restore the default or use the new exporter option. This remains an **on-demand admin viewer**, not a metrics collector, production monitoring database, or substitute for your normal Prometheus/OTEL monitoring infrastructure.

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
| `GOTENUI_MAX_RESPONSE_BYTES` | Maximum converted response size, measured in streamed bytes. Defaults to `100000000` bytes. |
| `GOTENBERG_BASIC_AUTH_URL` | **Server-only** exact Gotenberg base URL that should receive the credentials. Must be present in `GOTENBERG_ALLOWED_URLS`. |
| `GOTENBERG_BASIC_AUTH_USERNAME` | **Server-only** Basic Auth username for that URL. Cannot contain `:`. |
| `GOTENBERG_BASIC_AUTH_PASSWORD` | **Server-only** legacy Basic Auth password for that URL; like other server-managed credentials, it may be used by anyone allowed to access the proxy. |
| `GOTENUI_SERVER_CONNECTIONS` | Optional server-only JSON array of named connection profiles, each with ID, name, allowed URL and optional Basic/Bearer/OAuth2 client-credentials auth. May also specify `metricsUrl` and independent `metricsAuth` for the OpenTelemetry Prometheus exporter (server-only, never browser configurable). |
| `GOTENUI_SHOW_DEBUG` | Optional server-only runtime flag (`true` or `false`, default `true`) controlling visibility of **Read debug info** within Diagnostics. Does **not** disable the API. |
| `GOTENUI_SHOW_METRICS` | Optional server-only runtime flag (`true` or `false`, default `true`) controlling visibility of Prometheus metrics. Does **not** disable the API. |

For example, to let the Settings UI select either the demo or a private Gotenberg instance:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf.internal.example.com
```

### Stateless multi-instance connections (v1.0.10)

Gotenui supports **two connection types**, with no database, cookies, sessions, or persistent server storage:

1. **Browser-managed:** Users add, rename, remove, and select their own profiles in Connection settings. Each profile stores only its name, URL and authentication *mode* in `localStorage`. For Basic Auth and bearer-token connections, users enter the username/password or token when switching to that connection. Secrets are held in **tab memory only** and sent to the same-origin Gotenui proxy on each request, never persisted by Gotenui. Refreshing the page requires re-entering them.
2. **Server-managed:** Operators provide named profiles via `GOTENUI_SERVER_CONNECTIONS`. Users select a profile by ID; the proxy resolves the exact approved URL and attaches configured Basic/Bearer credentials or obtains a scoped OAuth2 service token. The browser receives only the profile ID and name; neither the upstream URL nor credentials are returned. Switching requires no redeployment.

Both modes use the fixed, server-side `GOTENBERG_ALLOWED_URLS` allowlist. **Adding a browser profile cannot add a new allowed destination**; to permit more backends, update the deployment's allowlist. Redirects and arbitrary relay endpoints remain disabled.

Example configuration with a public demo and two private backends:

```dotenv
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,https://pdf-one.example.com,https://pdf-two.example.com
GOTENUI_SERVER_CONNECTIONS=[{"id":"finance","name":"Finance PDFs","url":"https://pdf-one.example.com","auth":{"type":"basic","username":"service","password":"secret"}},{"id":"records","name":"Records PDFs","url":"https://pdf-two.example.com","auth":{"type":"bearer","token":"example-token"}}]
```

### Managed OAuth2 service tokens (v1.0.4)

Gotenberg 8.36+ optionally validates **OIDC bearer tokens** (`API_ENABLE_OIDC_AUTH=true`, plus the issuer and audience configured on Gotenberg). For operators whose identity provider supports OAuth 2.0 `client_credentials`, a **server-managed connection** can now obtain and renew access tokens automatically, without copying a short-lived token into the UI:

```dotenv
GOTENBERG_ALLOWED_URLS=https://pdf.internal.example.com
GOTENUI_SERVER_CONNECTIONS=[{"id":"production","name":"Production PDFs","url":"https://pdf.internal.example.com","auth":{"type":"oauth2","tokenUrl":"https://login.example.com/oauth2/token","clientId":"gotenui-service","clientSecret":"replace-with-secret","scope":"gotenberg.convert","audience":"gotenberg-api"}}]
```

`tokenUrl` must be a **deployment-specified HTTPS endpoint** without embedded credentials, query or fragment. The token request is a server-side, non-redirecting form POST with a 10-second timeout and a 16 KiB response limit. Client authentication defaults to `client_secret_basic` (OAuth-compliant URL-encoding in the Basic header); add `"authMethod":"client_secret_post"` only if your provider requires credentials in the POST body. `scope` and `audience` are optional. The IdP must issue a bearer **access token** whose issuer and audience match Gotenberg's OIDC configuration; ID tokens are not substitutes. Configure and rotate secrets using your deployment's secret manager, not committed files.

Access tokens are kept **only in worker memory**, are keyed by the exact upstream target *and* identity-provider settings, and are renewed before expiry (`expires_in`). Simultaneous requests share one token acquisition; a Gotenberg HTTP 401 invalidates the cached token for the next request. Browser-managed connections do not inherit it, and a separately configured OpenTelemetry metrics exporter neither triggers token acquisition nor receives the Gotenberg token. Restarts/serverless workers acquire fresh tokens. Provider errors return generic gateway failures instead of leaking token endpoint bodies or secrets.

This is **service-to-service OAuth2**, **not user OIDC login, Authorization Code/PKCE, delegated per-user access or refresh-token storage**. Anyone with access to a managed profile exercises the service account's permissions. Do not expose such a profile on a public Gotenui without authentication and authorisation at your reverse proxy. For user-specific access, continue to supply an ephemeral bearer token from your IdP through the browser profile until a provider-specific interactive flow is designed.

**Important security trade-off:** An authenticated server-managed connection acts as a shared service credential. Without Gotenui-specific access keys, **anyone able to reach the Gotenui proxy can select that profile and invoke Gotenberg with its configured credentials**, including the debug and metrics routes when upstream permits them. Protect Gotenui with an identity-aware reverse proxy, network access rules, and rate limits, or prefer user-managed connections (users supply their own upstream credentials). Do not deploy a publicly reachable Gotenui instance with privileged server-managed credentials unless this is intentional. Gotenui still never sends server-managed secrets to the browser or attaches them when a user selects the same URL as a browser profile.

The v1.0.9 `GOTENBERG_BASIC_AUTH_*` variables remain supported as an explicit `legacy-basic` profile, subject to the same shared-service-credential warning. The former `GOTENUI_PROFILE_ACCESS_KEY` and `GOTENUI_DEBUG_ACCESS_KEY` environment variables are ignored and should be removed from deployment settings.

For browser-managed Basic/Bearer credentials, user-entered secrets are forwarded only to that exact approved destination, never automatically to other profiles, and **never to the public Gotenberg demo**. Any local profile's URL or auth mode can be edited; credentials must be re-entered on each switch. Use HTTPS for private remote Gotenberg instances; Base64-encoded Basic Auth is not encryption. The app may relay privileged document operations and URL-fetching by Gotenberg itself, so follow Gotenberg's network isolation guidance.

**SSR/SSRF policy:** Every selected URL must match the allowlist exactly (including path prefixes); server profile IDs cannot override URLs or authentication; client headers/cookies are never blindly forwarded; redirects are rejected; and the proxy accepts only pre-defined Gotenberg operations. Because DNS can be rebinding-prone and allowlisted hosts can point to private infrastructure, only allow backends you operate or explicitly trust, protect the proxy at the edge, and consider egress controls on the serverless runtime.

The proxy buffers and validates incoming multipart data in memory (up to the configured limit), then streams the upstream response back to the browser. Neither uploads nor results are intentionally persisted by Gotenui. Browser download previews and activity remain in memory until the tab closes. Your host or Gotenberg may enforce separate limits or log requests.

### Request and response size limits

The browser currently caps uploaded files at **4,000,000 bytes** and the proxy caps its entire multipart body at **4,200,000 bytes** by default. This leaves some overhead under Vercel Functions' **4.5 MB request limit**, although large form fields and generated output can still hit host limits. Vercel also applies a 4.5 MB limit to function responses; some streaming configurations behave differently. For large conversions use a Node/other hosting platform with suitable limits, then increase `VITE_GOTENUI_MAX_UPLOAD_BYTES` and `GOTENUI_MAX_REQUEST_BYTES` appropriately. For instance, on a self-hosted Node server set `VITE_GOTENUI_MAX_UPLOAD_BYTES=50000000` **before building** and `GOTENUI_MAX_REQUEST_BYTES=55000000` in the server environment (not on Vercel). The second limit covers the entire multipart request, not each file. Also verify your reverse-proxy limits and the connected Gotenberg instance's own limits. The public Gotenberg demo has its own limit of **5 MB per request** and rate limit of **2 requests per second per IP**; it is intended for evaluation, not production.

Converted output is streamed rather than fully buffered by Nitro. `GOTENUI_MAX_RESPONSE_BYTES` defaults to **100,000,000 bytes** (100 MB), and can be set between **1,024 and 500,000,000 bytes**. The proxy checks the declared `Content-Length` before streaming, counts actual streamed bytes independently, rejects truncated responses when the upstream supplies an uncompressed length, and cancels the upstream stream when the browser cancels. Compressed responses are limited by decoded bytes without comparing against their compressed `Content-Length`. If an undeclared or incorrectly declared stream exceeds its budget *after response headers have been sent*, the download stream fails (rather than returning a partial document); the HTTP status cannot then change to 502. Increase this value when legitimately processing large documents, subject to your hosting platform's response limits. The proxy also rejects unexpected 2xx output media types (including HTML SPA fallbacks), unexpected partial-content responses, and asynchronous success without configured webhook delivery. It also checks the minimal file signatures of PDF, ZIP, PNG, JPEG and WebP results **before** returning HTTP 200 to the browser; if an upstream gateway returns mislabeled HTML or an incomplete binary signature, Gotenui cancels the upstream and returns HTTP 502. Only the first 3–12 bytes are inspected, so this is not a complete document-integrity or malware scan. JSON metadata responses are not binary-signature checked. Response validation allows both PDF and ZIP for split operations: a split yielding just one document can return a PDF. PDF-processing and LibreOffice operations may return ZIP for multiple independent input files; a conversion with a requested post-processing split can also return ZIP. Other operations retain exact media-type requirements. The browser derives the download extension from the actual response content type, not only the selected operation.

## API contracts

- `GET /api/gotenberg/connections` — returns `{connections:[{id,name}],features:{showDebug,showMetrics}}`; **no server-managed URLs, passwords, or tokens**. Feature flags are display preferences, not API permissions.
- `GET /api/gotenberg/status?url=<encoded-base-url>` — status for a browser-managed URL, with optional `X-Gotenui-Upstream-Authorization` for user-supplied Basic or Bearer auth.
- `GET /api/gotenberg/status?connection=<profile-id>` — status for a server-managed profile; no separate Gotenui access key.
- `HEAD /api/gotenberg/health?url=<encoded-base-url>` or `?connection=<profile-id>` — lightweight, **bodyless** upstream `HEAD /health` probe. Uses the same browser-supplied or server-managed upstream credentials as the corresponding status request. Returns **200** for healthy, **503** for unhealthy, **401/403** for upstream authentication/authorisation failures, or **502/504** for unexpected gateway failures/timeouts. A browser-managed URL not on the allowlist is rejected with **403**. Never forwards upstream cookies or headers; includes an `X-Gotenui-Health-Probe: 1` header so the browser can reject a static-host SPA fallback. Because Gotenberg's own `/health` can be public even when document operations require Basic Auth, use the full status endpoint to check credentials and version.
- `POST /api/gotenberg/debug` — read-only JSON from upstream `GET /debug`, with the normal connection selector and upstream authentication. No Gotenui admin key.
- `POST /api/gotenberg/metrics` — bounded Prometheus exposition from upstream `GET /prometheus/metrics`, with the normal connection selector and upstream authentication. On success returns `text/plain; charset=utf-8` with `X-Gotenui-Metrics: 1`; protects against static SPA fallback, and does not forward upstream cookies or authentication challenges.
- `POST /api/gotenberg/convert` — validated multipart form with `payload`, `files`, and `auxiliary` fields. Browser-managed requests supply `X-Gotenberg-Url` and optional `X-Gotenui-Upstream-Authorization`; server-managed requests supply `X-Gotenui-Connection-Id`. **Do not combine modes.** The proxy reconstructs approved Gotenberg multipart fields and forwards only the selected upstream auth.

These routes are same-origin and do not enable CORS. Requests claiming a different `Origin` or `Sec-Fetch-Site` are rejected, but server-side HTTP clients can still access public browser-managed routes, so edge security and rate limits are essential.

### TLS-terminating reverse proxies

When the public site uses HTTPS but the reverse proxy forwards to Nitro over HTTP, the upstream `Request.url` may have an **internal** origin. Gotenui normally checks browser `Origin` against that URL. If this causes legitimate API requests to fail with HTTP 403, set **`GOTENUI_PUBLIC_ORIGIN=https://documents.example.com`** (replace with the actual origin visible in your browser) on the Nitro runtime. It accepts one HTTP(S) origin only, with an optional port but no URL path, userinfo, query or fragment. Do not set it to the upstream Gotenberg URL. Keep it unset when the runtime already sees the correct public origin.

The override **replaces** the origin inferred from `Request.url`; it does not add another allowed origin. `Sec-Fetch-Site: cross-site` and any mismatching `Origin` remain rejected. Gotenui deliberately **ignores `X-Forwarded-Host` and `X-Forwarded-Proto`** for this security decision, because clients may spoof those headers unless every ingress is strictly controlled. This setting is not a Gotenui authentication system: restrict public access to instances with server-managed upstream credentials at your trusted edge. The non-Docker production smoke tests simulate the mismatch, but live ingress/TLS testing is still a release gate.

## Container deployment

The production `Dockerfile` builds with the project's Node.js 24 / pnpm 12 toolchain, using Corepack and `pnpm install --frozen-lockfile` to resolve **exactly the dependencies recorded in `pnpm-lock.yaml`**. The final `node:24-alpine` stage copies only `.output`, runs as the unprivileged `node` user, and listens on port `3100`. No uploads, job history or credentials are written to disk by Gotenui.

Refresh and commit `pnpm-lock.yaml` with your local pnpm 12 toolchain whenever `package.json` dependencies change; the Docker build and CI intentionally fail on a stale or incomplete lockfile. The Docker context excludes local environment files, `node_modules`, build outputs, `.git`, and delivered patches/bundles. Configure `GOTENBERG_ALLOWED_URLS` and any server-managed connections through runtime environment variables, not image build arguments. As with other deployments, **protect an instance carrying shared server credentials at the edge**. A real container build and gateway test remain outstanding before v1.1.0.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes, pull requests and manual dispatch. The
**quality** job checks Biome, TypeScript, Vitest unit tests, a production build,
and the built Nitro server's native TypeScript smoke test; it also fails if either previously
reported Rolldown warning returns. The
**integration** job invokes Vitest's Docker harness, which starts a disposable
`gotenberg/gotenberg:8.37.0` container with a local fixture server. CI never
contacts `demo.gotenberg.dev` to run tests.

CI uses `pnpm/setup@v3` to install Node.js 24 and **pnpm 12**, reading the
exact pnpm version from `packageManager` in `package.json` (currently
`pnpm@12.10.1`) automatically. Both jobs run `pnpm install --frozen-lockfile`.
After changing dependencies, update and commit `pnpm-lock.yaml` locally before
expecting CI to pass. The action uses Node.js 24, a cached pnpm store, and
frozen installation; no generated lockfiles are changed by incremental patches.

### Automated release regression matrix

| Gate | Local automated check | Remaining verification |
| --- | --- | --- |
| Conversion request validation, destination allowlist, same-origin restrictions (including TLS ingress override), and header isolation | Vitest proxy/security suites and dual-origin Nitro smoke | Browser-managed and server-managed deployments in staging, real TLS ingress |
| Gotenberg `400`, `401`, `403`, `409`, and `5xx` error propagation | Vitest negative-response matrix | Local Docker rerun against pinned Gotenberg 8.37.0 |
| Health/version, debug and metrics diagnostic response integrity | Vitest length/status validation and cancellation tests, including partial HTTP 206 and decompressed responses; built Nitro smoke checks | Real Gotenberg diagnostics through a reverse proxy |
| Binary/JSON/image/ZIP media types, binary file signatures, `202`/`204` webhook responses | Vitest proxy and signature tests plus Nitro smoke for mislabeled PDF | Real asynchronous callback delivery and binary results with Docker |
| Declared and undeclared output size limits, early EOF, cancellation, and timeout mapping | Vitest stream and gateway suites | Host-level buffering and timeout tests |
| Switching server and browser connections while in flight | Vitest concurrent-proxy regression | Manual tab-level connection switch |
| Built Nitro runtime, SPA/API routing, status/health, parallel credential isolation, PDF/ZIP responses, 401/trace handling, redirects, webhook acceptance, prompt cancellation before/during streaming, and truncated responses | `pnpm build && pnpm test:smoke` with native Node 24 TypeScript and a disposable mock upstream | Real Gotenberg behaviour and callback delivery still require Docker |
| Package checks and production build warnings | Biome, TypeScript, Vitest unit tests, Vite/Nitro build | CI run on GitHub Actions |
| Production container build reproducibility and least-privilege runtime | Vitest static Dockerfile/context contract checks (Node 24, pnpm 12, frozen lockfile, non-root) | Real Docker image build, launch and reverse-proxy test |
| Actual conversion routes, overlays and remote/webhook flows | Authored Vitest Docker suite | Must run against local pinned image; not executed in this environment |
| Dialog/drawer keyboard focus containment and restoration | Vitest modal-focus tests (no browser) | Manual keyboard, screen-reader, mobile and responsive-layout testing |
| Desktop, mobile, accessibility, deployment checks | — | Manual browser, mobile, accessibility and release review |

The modal focus tests use a small document fixture and do not substitute for browser accessibility audits. Check Tab, Shift+Tab, Escape, focus restoration and viewport resizing in an actual browser before release.

The unit suite alone does **not** certify `pnpm test` (which also invokes Docker).

The Nitro build config labels its function-named library chunk group (without
altering chunk names) and silences only `MODULE_LEVEL_DIRECTIVE` warnings about
third-party `"use client"` markers in the **non-RSC** Nitro server bundle.
Warnings from application files and all other Rolldown warnings still appear.

### Watermark and stamp appearance (v1.0.5)

Each watermark or stamp layer, including those added during PDF conversion, has an **Appearance settings** section for the default **pdfcpu** PDF engine. Set opacity (0–1), rotation (-180° to 180°), page position, relative or absolute scale, X/Y offset, and (for text layers) font size, font name, and hex colour. Selecting an explicit text size automatically switches to absolute scaling as required by pdfcpu. Blank inputs retain upstream defaults. Typed values are encoded into the same `watermarkOptions` or `stampOptions` JSON field used by Gotenberg; no new server API or dependency is needed.

The **Custom PDF-engine options JSON** control remains available for advanced or alternative engine settings. Editing a normal control retains all unrelated custom keys. For other PDF engines such as pdftk, consult that engine's supported options before using pdfcpu-specific controls. Switching a layer from text to image/PDF clears invalid text-only appearance keys.

### PDF attachment metadata editor (v1.0.5)

The standalone **Embed attachments** tool and conversion-time **PDF attachments** section now expose per-file MIME type and PDF/A `/AFRelationship` (`Source`, `Data`, `Alternative`, `Supplement`, `Unspecified`). Local upload filenames appear automatically; use **Add filename** for a remote `downloadFrom` attachment whose exact filename comes from `Content-Disposition`. These fields serialize into Gotenberg's standard `embedsMetadata` map. Custom JSON is still available for recovery and uncommon cases; validation uses the same metadata contract for both operation types and rejects missing local filename references when no remote attachments were supplied.
