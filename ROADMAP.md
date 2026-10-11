# Gotenui roadmap

- **Baseline:** v1.0.48 (batch request transport regression coverage).
- **Scope:** Remaining Gotenberg 8.x capabilities, correctness fixes, usability, and release readiness.
- **Status:** Tracked implementation plan; checked tasks have shipped, remaining tasks are planned.

Gotenui already exposes the 22 Gotenberg conversion, screenshot, and PDF-engine routes, along with status, health, version, debug, legacy Prometheus metrics, `downloadFrom`, and asynchronous webhook submission. **Route coverage is not a substitute for release verification:** the feature-specific multipart, repeated-field, and request-header workflows have automated unit coverage, but real Gotenberg integration and browser/deployment checks must still be completed.

## Design constraints

- Remain stateless: no database, server sessions, persistent job queue, or uploaded-document storage in Gotenui.
- Let Gotenberg (or the operator's upstream gateway) authenticate and authorise its requests. Do not reintroduce Gotenui-only debug/profile access keys. Browser-managed secrets remain ephemeral; server-managed credentials are an operator deployment choice.
- Keep proxy safeguards even though Gotenberg owns authentication: exact backend allowlisting, same-origin checks, safe header forwarding, redirect blocking, request/response limits, and validation.
- `GOTENUI_SHOW_DEBUG` and `GOTENUI_SHOW_METRICS` remain **UI visibility** settings, not API access controls.
- Verify behaviour against the pinned local Gotenberg 8.37 integration image before assuming a documented field works. Keep the public demo out of automated tests.
- Prefer proper UI inputs for common tasks; keep Advanced JSON for less common scalar options. Never claim a job completed merely because a webhook request was accepted.

## Proposed delivery sequence

Versions are planning targets, **not commitments**. Each implementation patch should add focused Vitest unit tests and, where applicable, local Docker integration coverage. Manual UI checks come after the automated checks.

| Proposed patch | Priority | Deliverable | Scope |
| --- | --- | --- | --- |
| **v1.0.17** | Documentation | This roadmap | Track gaps, constraints, acceptance criteria, and references only. |
| **v1.0.18** | P0 | Merge ordering and request metadata | Done: ordered local merges, output filename, correlation ID, W3C trace context. |
| **v1.0.19** | Fix | Metadata assertion typecheck | Fix Node.js assertion matcher typing in the request-metadata regression test; no runtime behaviour change. |
| **v1.0.20** | P1 | Chromium document assets | Done: named header/footer HTML parts, Markdown templates and ordered multi-file sources with collision validation and tests. |
| **v1.0.21** | P1 | Conversion plus PDF post-processing | Done: per-conversion watermark/stamp, attachments, Factur-X, metadata, flattening and encryption with typed upload fields and validation. |
| **v1.0.22** | P1 | Multiple overlays | Done: repeated watermark/stamp field groups, ordered local and remote assets, validated multipart serialization and regression tests. |
| **v1.0.23** | P2 | Advanced conversion controls | Done: typed Chromium waits, output and browser-network controls; LibreOffice password, presentation export and PDF viewer options; route-aware validation and regression tests. |
| **v1.0.24** | Fix | Remote-overlay integration PNG | Replace corrupt fixture data and check PNG checksums in the non-Docker unit suite. |
| **v1.0.25** | P2 | Remote-input and webhook usability | Done: structured and legacy editors, redacted previews, explicit async acceptance, unit tests and authored Docker callback/download tests (Docker run outstanding). |
| **v1.0.26** | P1 | Automated release hardening | Done: output stream budgets, response media/status validation, gateway error tests, connection-isolation tests, CI pnpm action update, and release regression matrix. |
| **v1.0.27** | Fix | Gotenberg response format compatibility | Fix v1.0.26 regression rejecting single-result split PDFs and ZIP outputs from multi-document processing; add unit/Docker regressions, preserve strict unexpected-format rejection. |
| **v1.0.28** | Release | Built Nitro deployment smoke | Add a no-Docker release test for real SPA/API routing, runtime profiles, authentication isolation, PDF/ZIP compatibility, response protections and origin/allowlist enforcement; run in CI after build. |
| **v1.0.29** | Release | TypeScript smoke and gateway contract checks | Convert the smoke runner to native Node.js 24 TypeScript, include project scripts in typechecking, and extend the built-server test for webhook acceptance, upstream authentication errors and redirect rejection. |
| **v1.0.30** | Release | Keyboard accessibility hardening | Contain keyboard focus in connection/debug/metrics dialogs and open mobile navigation; restore focus on dismissal, hide closed mobile controls from tab order, and add non-browser focus regressions. |
| **v1.0.31** | Release | Live Nitro cancellation and isolation smoke | Fix the smoke helper overwriting caller abort signals; verify prompt abort before upstream headers and during streaming, truncated-response rejection, and overlapping browser/server credentials in the built app. |
| **v1.0.32** | Release | Container build reproducibility | Use Node.js 24 and pnpm 12 with a frozen lockfile instead of npm resolving dependencies anew, restrict the Docker build context, and run the packaged Nitro app as a non-root user; add a static packaging contract test (real image build outstanding). |
| **v1.0.33** | Release | Binary response signature hardening | Reject mislabeled PDF, ZIP and screenshot outputs before returning download headers. Inspect only the minimum file-signature bytes and replay the inspected stream without buffering the full result; extend unit and live Nitro smoke coverage. |
| **v1.0.34** | Release | Download disposition hardening | Force safe attachment filenames consistent with the verified output media type, prefer validated requested names, and avoid reflecting download headers on webhook acceptance; add unit and live Nitro smoke regressions. |
| **v1.0.35** | Release | Public-origin reverse-proxy compatibility | Allow a single explicitly configured public origin for TLS-terminating deployments; preserve strict origin/site rejection without trusting forwarded request headers, add proxy unit tests and a second built Nitro smoke instance. |
| **v1.0.36** | Fix | Multipart request header compatibility | Accept valid quoted boundaries and optional UTF-8 charset parameters in either order while retaining upload limits, field validation, and rejection of ambiguous MIME parameters; add unit and built Nitro smoke regressions. |
| **v1.0.37** | Release | Status probe response cleanup | Cancel unread upstream /health and /version error bodies without affecting authentication or health reporting; add deterministic cancellation regressions. |
| **v1.0.38** | Release | Diagnostic response integrity | Reject malformed and mismatched uncompressed Content-Length values on health/version, debug and metrics responses; maintain body-size caps, compressed-body compatibility and cancellation tests. |
| **v1.0.39** | Release | Diagnostic HTTP status compatibility | Reject successful-looking partial or unexpected 2xx upstream diagnostic responses; require HTTP 200 for health, version, debug and legacy metrics, cancelling unread bodies. Add unit and built Nitro smoke regressions. |
| **v1.0.40** | Fix | Conversion prefix integrity | Reject incomplete/invalid PDF version headers and declared uncompressed response lengths shorter than the binary signature or bytes already read for signature validation, before sending download headers. Retain PDF 1.x/2.0 compatibility and streaming. |
| **v1.0.41** | Usability | Diagnostics, button visibility and dark mode | Group the HEAD health probe inside always-accessible Diagnostics, keep debug and metrics actions independently gated, remove redundant debug warning, improve action contrast, and add an accessible persistent light/dark toggle. |
| **v1.0.42** | Usability | Tabbed diagnostics and theme selection | Show Debug and Prometheus as accessible tabs within one dialog, keep the probe width stable while loading, and provide a System/Light/Dark dropdown that can clear the saved override. |
| **v1.0.43** | Usability | Theme and sidebar icon polish | Add monitor/sun/moon indicators to the native theme select; use bookmark-specific read/write navigation icons and remove the decorative period from the sidebar brand. |
| **v1.0.44** | Usability | Result preview, HTML import, and theme menu | Add an on-demand, browser-local PDF preview with download/new-tab fallback and explicit result cleanup, import HTML source into the editor, remove the Prometheus warning, and render icon-only theme control with icon-and-label menu choices. |
| **v1.0.45** | Usability | Visual PDF structure editors | Add labelled XMP metadata fields and a nested bookmark editor to dedicated write operations. Keep lossless JSON fallback, validate bookmark titles/pages/trees server-side, and preserve Gotenberg multipart fields. |
| **v1.0.46** | Usability | Local conversion presets | Save, apply, update and delete named per-operation layout and conversion presets in browser storage. Strictly whitelist benign field types and reject unsafe or corrupted stored values. Do not store documents, URLs, credentials, callbacks or Advanced JSON. |
| **v1.0.47** | Optional usability | Browser-managed batch operations | In-tab queue for operation snapshots, bounded concurrent requests, per-job cancellation/retry, clearable downloads, truthful webhook acceptance, and regression tests. No persistent or server-side queue. |
| **v1.0.48** | Release | Batch transport contract regressions | Test queued requests through the real browser conversion client with a mocked same-origin fetch, including connection isolation, multipart uploads, cancellation, upstream errors/retry and asynchronous acceptance. |
| **v1.1.0 candidate** | Release | Final review | Manual browser/mobile testing, documentation verification, and release assessment. |

### v1.0.48 batch transport contract checks

The unit suite now exercises `BrowserBatchQueue` with its default `convertWithGotenberg` executor, instead of checking only an injected scheduler callback. The transport regressions verify browser-managed and server-managed connection isolation, snapshot integrity for HTML sources and multipart attachments, post-processing uploads, webhook `204` acceptance without download state, independent cancellation, and upstream `401` trace propagation across retries. All requests use a mocked same-origin `fetch`. These checks do not exercise actual browser rendering, the built Nitro server, or a live Gotenberg instance. Existing built-server smoke and local Docker suites remain separate release checks.

### v1.0.47 browser batch operations

Users can enqueue validated, independent operation requests without any server-side job storage. The queue is kept only in React/browser memory, not in `localStorage` or Gotenui server functions. Every request captures the current selected connection and authentication, source text, multipart files, conversion settings and webhook configuration when added. Up to two requests run concurrently, with start/pause, cancel-all, individual cancel, retry and clear controls. Cancellation uses `AbortSignal` on the same-origin fetch, and cancelling or closing the page does not guarantee an asynchronous webhook accepted by Gotenberg is cancelled upstream.

Up to 12 jobs, 32 MB of combined retained inputs and 200 MB of retained output Blobs are allowed. Completed and accepted requests release queued inputs and selected credentials. Failed and cancelled ones retain them in this tab for retry until removed. Every successful synchronous result has a download link and revocable object URL, with no automatic multi-download behaviour. Async webhooks are labelled **accepted, not delivered**. The UI reports job states rather than fabricated percentage progress. Unit tests cover bounded concurrency, pausing, cancellation during in-flight work, retries, connection/input snapshots, URL cleanup and resource limits. Browser-interaction and real Gotenberg testing are still separate release checks.

### v1.0.46 browser-local operation presets

Operations with reusable settings now offer named presets. A user can save, apply, update (by saving the same name) and delete up to 25 presets across operations. Presets are scoped to one operation and stored only in the browser under `gotenui.presets.v1`, with no server endpoint or user account. Storage failures are reported without claiming success. Applying a preset restores its eligible controls and their defaults, while leaving the current document uploads, source text, URLs and any entered credentials untouched.

A strict allowlist permits common toggle, select and numeric choices along with narrowly validated page dimensions, margins, page ranges and rendering delays. No file content, remote input URL, passwords, cookies, HTTP headers, webhook targets, PDF metadata, textual overlays, browser expressions, tracing values, output filenames, post-processing assets or free-form Advanced JSON can enter the saved format. Stored records have version, count and size limits and are validated again on load and apply. Preset names are stored too, so users should not include sensitive information in names. Presets remain local to each browser and are not synchronised between devices.

### v1.0.45 visual PDF editors

The **Write metadata** route now offers dedicated Title, Author, Subject, Creator, Producer, Copyright, and comma-separated Keywords fields. These are encoded in Gotenberg's existing `metadata` JSON multipart field. Editing a common field preserves unknown and advanced XMP properties already present in the JSON. An alternate JSON editor remains available for all supported ExifTool values. Invalid JSON or non-text common values are not silently rewritten.

The **Write bookmarks** route offers a nested tree with title, 1-based page number, add-child, add-top-level, delete, and sibling reordering controls. The same `bookmarks` form field is sent to Gotenberg. A raw JSON editor supports the documented per-filename bookmark maps as well as shared lists. A map is never silently converted into a shared list. The server validates titles, positive integer pages, nesting, and overall entry limits. Page numbers must refer to actual pages in each PDF, which Gotenberg checks during processing. Neither editor adds storage, server-side jobs, or new API routes. Automated tests cover both field serialization and invalid data. Manual browser verification remains outstanding.

### v1.0.44 document preview and appearance menu

Completed PDF results can be previewed on demand using the browser's built-in PDF viewer and the same in-memory Blob URL used for downloads. Download and open-in-new-tab remain available as fallbacks. Clearing the latest result revokes the URL and removes only that temporary result, not the session activity list. ZIP archives are never passed to the PDF viewer. Source editors for HTML PDF and screenshot routes now import local UTF-8 `.html` or `.htm` files up to 300 KB, without adding multipart assets or changing server-side validation. The optional source import replaces the editable `index.html` text.

The appearance control has an icon-only trigger and a keyboard-accessible menu with actual monitor, sun, and moon icons alongside System, Light, and Dark labels. Native HTML select options cannot display SVG icons, so the menu uses radio-style checked choices, arrow-key navigation, Home, End, Escape, and focus restoration. System remains the initial preference and clears any stored override. The Prometheus tab no longer displays a redundant warning card. The warning's operational context remains in the README. All changes are client-side and preserve stateless operation.

### v1.0.43 theme and sidebar icons

The selected theme preference is indicated by an accessible, decorative-only monitor (System), sun (Light), or moon (Dark) icon alongside the existing native select. The native dropdown retains its text options and keyboard behaviour; icons do not become part of its accessible label. Read/Write bookmarks use different bookmark-specific sidebar icons instead of identical braces. The brand text is now simply **Gotenui** without the decorative dot; the gopher SVG is unchanged. Unit tests verify the three selected-mode icons, the bookmark icons, and the displayed brand. Manual visual verification remains outstanding.

### v1.0.42 diagnostic tabs and theme selection

**Debug** and **Prometheus** now share the Diagnostics dialog as keyboard-navigable tabs, while the health probe remains visible above them with a fixed-width action in idle and probing states. Both feature flags still gate their respective tab content independently. Switching tabs preserves the loaded output and filters, and cancels an in-flight read for the panel that is no longer selected; no server-side state is introduced. The theme control is a native **System / Light / Dark** select with System as the default. Explicit Light/Dark overrides continue using `gotenui.color-theme.v1`; choosing System removes that key so subsequent OS colour-scheme changes apply again. Non-browser tests cover tab semantics, keyboard selection, visibility, stable probe width, and preference persistence. Manual browser, mobile, and assistive-technology verification remains outstanding.

### v1.0.41 appearance and diagnostics

The header now has a light/dark toggle that defaults to the operating system preference and stores an explicit override in browser `localStorage` (`gotenui.color-theme.v1`). Sonner notifications and the native form colour scheme follow the same selection. Appearance settings are client-only and independent of connection profiles, server credentials, or uploads. An accent **Test connection** action and tinted secondary/danger buttons are more distinguishable on both backgrounds.

The **Diagnostics** dialog is always reachable and contains the selected connection's authenticated `HEAD /health` probe, even when both optional diagnostic feature flags are false. Debug JSON and legacy metrics remain separately gated by their respective UI flags, and the redundant debug warning banner is removed. The upstream authentication and proxy security contract is unchanged. Non-browser Vitest coverage checks saved appearance preferences, control contrast classes, and conditional diagnostic action visibility. **Visual desktop/mobile and assistive-technology verification remains outstanding.**

### P0 — Correctness and request contracts

#### 1. Merge ordering

**Previously:** The Merge PDFs workbench allows drag reordering and states that the visible file order determines the result. Gotenberg actually merges PDFs in **alphanumeric filename order** (numbers first, then letters). With Gotenberg 8.37+, files sharing a filename are retained and their upload order resolves the tie.

- [x] Preserve displayed order for **local uploads** using numbered temporary filenames without altering file contents. Rewrite filename-keyed bookmarks for those uploads, retain original names in prefixes, and allow duplicate filenames. Remote merge inputs still use Gotenberg filename sorting.
- [x] Cover differing filenames, numeric prefixes, and duplicate filenames in local Docker integration tests; assert bookmarked page order, not only PDF validity.
- [x] Explain local upload ordering and remote filename sorting in the UI.

#### 2. Output filename, request ID, and tracing

**Previously:** `outputName` named the **browser download**, not the upstream `Gotenberg-Output-Filename` request header. Gotenui read the returned `Gotenberg-Trace`, but had no explicit request-trace field or distributed trace-context control.

- [x] Reuse the existing browser output-name field for `Gotenberg-Output-Filename` on file-producing requests, plus a separate optional `Gotenberg-Trace` input. Validate fields server-side; metadata-read routes only apply the browser filename.
- [x] Distinguish correlation ID from W3C `traceparent` and optional `tracestate`; validate context before forwarding.
- [x] Preserve Gotenberg-generated filenames and traces when omitted; explicitly forward only validated metadata from the body, not arbitrary browser headers, cookies, or credentials.
- [x] Add unit tests for upstream request headers, rejected responses, returned filenames, and async webhook trace correlation, plus local Docker integration contracts.

### P1 — Document creation and post-processing

#### 3. Custom Chromium headers and footers

**Current gap:** URL-to-PDF has no supporting-file upload flow, so the user cannot supply `header.html` or `footer.html`. HTML/Markdown users may be able to attach these as generic assets, but there is no dedicated validated workflow.

- [x] Expose optional HTML header and footer editors or uploads on the applicable PDF conversion operations.
- [x] Send named `header.html` and `footer.html` files through the correct Gotenberg multipart `files` field; reject duplicate or reserved filenames.
- [x] Explain that headers/footers run in an isolated Chromium context: use complete HTML, inline assets, and suitable page margins; external resources and scripts are unavailable.
- [x] Cover URL/HTML/Markdown PDF output and invalid header/footer fixtures. Avoid showing PDF header controls on screenshot-only operations.

#### 4. Custom Markdown templates and multiple Markdown files

**Current gap:** The client synthesises one fixed `index.html` template and one `document.md` file. Gotenberg accepts a custom `index.html` containing `{{ toHTML "file.md" }}` calls and multiple `.md` files.

- [x] Allow the template to be edited or uploaded, with a working generated default.
- [x] Support multiple named Markdown files and deterministic ordering without filename collisions; keep optional non-Markdown assets.
- [x] Reject missing/duplicate reserved filenames and provide useful feedback for invalid template references.
- [x] Test a custom template, multiple Markdown files, local assets, and backwards-compatible default output.

#### 5. One-step conversion and PDF-engine post-processing

**Previous gap:** Gotenberg supports several PDF-engine features directly on Chromium and LibreOffice conversion routes. Advanced JSON can express some scalar parameters, but Gotenui does not fully map feature-specific attachments and field combinations into those requests.

- [x] Inventory supported conversion-route options for stamping, watermarking, attachments, Factur-X, encryption, metadata, and PDF/A/PDF/UA. Expose only valid operation-specific combinations.
- [x] Route `stamp`, `watermark`, `embeds`, and `facturxXml` files using their documented multipart field names, including support for remote descriptors where Gotenberg permits them.
- [x] Avoid two conversions or a server-side job store when Gotenberg can do the work in one request.
- [x] Test representative Chromium and LibreOffice conversion-plus-processing scenarios; check incompatible and missing inputs.

**v1.0.21 status:** The four PDF conversion workbenches gained one watermark and stamp each, multiple local or remote attachments, a local Factur-X XML file, metadata, flattening, and password/permissions controls in one upstream request. PDF/A/UA remain in Advanced options. The proxy validates the dedicated multipart fields. **v1.0.22** extends the overlays to repeated ordered groups, including the standalone watermark/stamp PDF tools. Docker regression cases are included for later execution (Docker deliberately excluded).

#### 6. Multiple ordered watermarks and stamps

**Prior gap:** Each operation had a single watermark/stamp configuration. Gotenberg accepts repeated `*Source`, `*Expression`, `*Pages`, and `*Options` form fields and consumes corresponding uploaded overlay files in order.

- [x] Add repeatable overlay groups with add, remove, and reorder controls.
- [x] Serialize **repeated multipart fields with `FormData.append`**, not a flat object using `FormData.set`.
- [x] Match local and `downloadFrom` overlay assets to their corresponding entries and prevent ambiguous file ordering (remote-first per overlay type).
- [x] Test mixed text/image/PDF overlays, missing assets, and their application order with unit tests and Docker integration cases. The remote PNG fixture was repaired in v1.0.24 after real Gotenberg runs exposed a bad IDAT checksum; full Docker re-verification remains outstanding in this environment.

### P2 — Advanced controls and usability

#### 7. Common Chromium options

**v1.0.23 status:** Chromium PDF and screenshot operations now expose route-aware waits and browser network settings; PDF routes additionally expose one-page rendering, CSS sizing and tagged/outlined output. Browser cookie/header inputs are validated before becoming multipart form fields, and proxy HTTP headers remain isolated.

- [x] Prioritise `singlePage`, `preferCssPageSize`, `waitForSelector` / `waitForExpression`, cookies, supported extra HTTP headers, and tagged-PDF/accessibility controls after checking exact applicability by route.
- [x] Provide typed validation, clear defaults, and relevant hints. Respect Chromium route differences and server-enforced URL restrictions.
- [x] Test representative options without accidentally forwarding sensitive browser headers to Gotenberg.

#### 8. Common LibreOffice options

**v1.0.23 status:** Office conversion supports source-file opening passwords, presentation notes/slides export, bookmarks/index/form-field settings and PDF viewer options with upstream defaults. Source passwords remain separate from output encryption.

- [x] Add source-document password input, appropriate presentation export options, PDF viewer preferences, and other frequently used export controls.
- [x] Keep source-opening passwords distinct from output-PDF encryption settings; do not persist passwords or log them.
- [x] Document format-specific behaviour and test representative Office/PDF fixtures.

#### 9. Structured remote inputs and async webhooks

**v1.0.25 status:** Structured remote-file and webhook editors now produce the same validated payload schema as before; legacy JSON remains available as an alternative. Gotenui shows acceptance and trace IDs only, not completion status or callback history. The new Docker success/error/retry/events cases await execution against the pinned image.

- [x] Replace or complement JSON textareas with repeatable remote-file entries (URL, optional headers, destination field) and webhook settings (success, error/events URLs, method, optional headers).
- [x] Add safe preview/redaction of sensitive fields and clear descriptions of `Content-Disposition` requirements and Gotenberg outbound URL filtering.
- [ ] **Execute** the authored real remote-download and webhook success, error, retry, and events Docker tests against a local, disposable receiver. Unit coverage of that receiver is complete; actual Gotenberg delivery remains unverified until Docker is run.
- [x] Label `204` as **accepted for asynchronous processing**, not converted or delivered. Show the correlation ID and the external receiver host without exposing token-bearing URL paths; never imply Gotenui tracks completion.
- [x] Do not introduce a persistent callback inbox or background queue as an accidental dependency. If callback history becomes a requirement, design it as a separate opt-in integration.

### Optional / deferred

#### 10. OIDC token acquisition

**Current state:** Since v1.0.4, Gotenui supports deployment-managed OAuth2 client-credentials acquisition and in-memory token renewal for service accounts. This is not user-interactive OIDC and does not store refresh tokens. Existing browser-provided bearer tokens remain supported. Gotenberg/gateways still enforce all permissions.

- [x] Support optional service-to-service access-token acquisition from a fixed, operator-configured HTTPS endpoint; renew before expiry, deduplicate concurrent acquisitions, invalidate on HTTP 401, and keep tokens out of browser storage.
- [x] Isolate tokens by upstream destination and IdP configuration; never forward one to unrelated browser connections or telemetry exporters.
- [ ] Only scope interactive OIDC Authorization Code + PKCE login after a concrete identity-provider/gateway requirement is identified.
- [ ] If interactive access is needed, define redirect registration, state/nonce validation, token expiry and refresh behaviour, and safe ephemeral handling; avoid `localStorage` secrets by default.

## Verification and release gates

**v1.0.40 conversion prefix integrity:** PDF signature checks now require a complete supported `%PDF-1.x` or `%PDF-2.0` version header rather than accepting the incomplete `%PDF-` prefix. For uncompressed conversion responses, a declared `Content-Length` smaller than the required binary header or the bytes already read during preflight fails with HTTP 502 and cancels upstream before download headers are returned. Compressed upstream responses continue using decoded-byte streaming limits without comparing compressed lengths. Vitest and the built Nitro mock-upstream smoke test cover this failure; full-document validity and real-Gotenberg integration remain separate concerns.

**v1.0.39 diagnostic HTTP statuses:** Gotenberg documents HTTP 200 as the successful GET response for /health, /version, /debug and legacy /prometheus/metrics. A gateway could previously return valid-looking JSON or metrics with HTTP 201 or 206, and Gotenui would accept the incomplete or unexpected result. Full status polling now rejects non-200 health and ignores non-200 optional versions; debug and metrics return a gateway error for unexpected successful statuses. Rejected response bodies are cancelled. Twelve unit tests reproduced the old behaviour, and four built-Nitro smoke checks exercise it through same-origin API routes. Full Gotenberg and ingress verification remains outstanding.

**v1.0.38 diagnostic lengths:** Full health/version polling, the debug JSON viewer, and legacy metrics now verify valid uncompressed upstream Content-Length declarations against the actual bounded response body. Invalid, truncated, or overlong replies cannot be presented as valid diagnostics; malformed or oversized declarations cancel unread bodies. Because fetch transparently decompresses upstream responses, encoded length declarations are not compared to decoded bytes, but the decoded payloads remain size-limited. New non-Docker unit tests reproduced the original acceptance defects and verify success, rejection, cancellation and compressed-response compatibility. Real Gotenberg and ingress testing remain outstanding.

**v1.0.37 status cleanup:** The periodic full status request now cancels unread upstream /health responses on HTTP errors and /version responses on authentication failures or non-200 results. The browser still receives the existing status/error contract, including protected-version authentication failures; no upstream error body is exposed. Focused unit tests first reproduced the uncancelled streams, then verified cleanup. Real Gotenberg Docker and browser testing remain outstanding.

**v1.0.36 multipart compatibility:** Nitro now accepts standard quoted multipart boundaries, optional UTF-8 charset parameters in either order, and valid dotted boundary names. Duplicate boundaries, unsupported charsets, unrecognised parameters, and malformed quoting remain invalid. Request body size limits, trusted connection selection, allowlisting, and server-side field validation are unchanged. Unit tests use real Node 24 FormData bytes and the built Nitro smoke test submits a quoted multipart header to the API. Real Gotenberg Docker integration and live reverse-proxy deployments remain separate verification gates.

**v1.0.35 reverse-proxy origin:** An operator may set `GOTENUI_PUBLIC_ORIGIN` to the browser-visible HTTP(S) origin when TLS termination or reverse-proxy routing causes Nitro's internal `Request.url` origin to differ. The override replaces, rather than supplements, the implicit origin for the CSRF check. Arbitrary forwarded-host/protocol headers remain untrusted and `Sec-Fetch-Site` enforcement is unchanged. Vitest and a second built Nitro process cover the public-HTTPS/internal-HTTP mismatch, rejection of other origins, and no upstream request on denial. Manual ingress/TLS and browser verification remain outstanding.

**v1.0.34 download headers:** Before serving a successful conversion, Gotenui now builds `Content-Disposition: attachment` from a sanitized name rather than blindly relaying the upstream value. The filename extension follows the verified response content type (including PDF/ZIP variations), with validated `outputName` taking precedence over upstream suggestions. This prevents a gateway from changing the browser disposition to `inline` or assigning an HTML/executable-looking suffix to PDF, ZIP, image or JSON responses. Webhook `202`/`204` acceptance retains correlation IDs but does not forward irrelevant file-download headers. Unit tests and built Nitro smoke checks cover these contracts; actual Gotenberg integration and manual browser behaviour remain outstanding.

**v1.0.33 binary response signatures:** The proxy now inspects the leading 3–12 bytes of PDF, ZIP, PNG, JPEG and WebP responses before sending a successful download response. This rejects HTML or other mislabeled gateway fallbacks even when they claim a permitted media type. PDF and ZIP can still vary by route exactly as in v1.0.27. JSON metadata remains non-binary and is not subject to signature sniffing. The rest of each response remains streaming with the existing decoded-byte limit, truncation checks and cancellation propagation. Unit tests cover split signature chunks, valid/invalid types, early upstream cancellation, and browser-download cancellation; a non-Docker Nitro smoke checks HTTP 502 for mislabeled PDFs. Full Gotenberg and browser verification remains outstanding.

**v1.0.32 image packaging:** The Dockerfile now uses Corepack and the package-manager version pinned in `package.json`, installs with `pnpm install --frozen-lockfile`, builds using `pnpm build`, and copies only Nitro output into a non-root runtime image. The unit suite verifies these packaging invariants and the Docker context exclusions. A real container build/run (with an updated, committed lockfile) is still required; this review did not run Docker.

**v1.0.31 live cancellation smoke:** The native TypeScript `pnpm test:smoke` runner now combines its request timeout with any caller abort signal instead of replacing it. The built Nitro deployment is exercised with a disposable, deliberately delayed mock upstream to verify client abort propagation before headers and after a streamed PDF chunk, with explicit prompt-abort deadlines. Concurrent browser/server-managed requests retain independent upstream credentials, and an incorrect declared response length causes a rejected client download. These are genuine HTTP streaming checks against the built server, **not** a substitute for Gotenberg Docker integration or manual browser testing.

**v1.0.30 keyboard focus checks:** Focus management now covers the connection, debug and metrics dialogs plus the mobile navigation drawer. Keyboard Tab and Shift+Tab remain within the active overlay, Escape closes it, and focus returns to the invoking element where it still exists. The closed mobile drawer is CSS-hidden and its opener exposes expanded state. Vitest verifies focus filtering, wrapping, Escape, outside-focus recapture and cleanup using document test doubles. **Manual browser, viewport-resize and screen-reader verification remains outstanding.**

**v1.0.29 smoke verification:** `pnpm test:smoke` runs `scripts/smoke-production.ts` directly with Node.js 24 (no TypeScript runner or generated script). The runner is included in `tsc --noEmit`. Additional built-server cases check 204 webhook acceptance and correlation headers without implying job completion, preservation of upstream HTTP 401 with trace but no cookie forwarding, and a same-upstream redirect target that must never be fetched. These are mocked-contract checks, not live Gotenberg validation.

**v1.0.28 packaged-runtime smoke:** `pnpm test:smoke` starts the built Nitro Node server and uses an isolated local HTTP fixture in place of Gotenberg. It checks SPA/icon delivery, live Nitro API routes, runtime configuration, independent browser/server credentials, health/version, PDF/ZIP conversion responses, trace/filename headers, invalid/oversized responses, and cross-origin/allowlist rejection. CI runs this immediately after `pnpm build`. It neither executes Gotenberg conversion engines nor replaces the outstanding Docker and manual release gates.

**v1.0.27 response compatibility:** Enforce operation-aware PDF/ZIP allowances for splits, multiple independent Office/PDF documents, and conversions with a split step. Keep strict HTML, JSON, image, HTTP status, size, and stream checks. Unit tests cover these outcomes; Docker rerun is required to close the release gate.

**v1.0.26 automated hardening:** Successful synchronous conversion responses must be HTTP 200 with the expected PDF, image, ZIP, or JSON media type, and an actual body. Unexpected partial content and asynchronous acceptance without a webhook produce a gateway error. Nitro streams binary results with a configurable 100 MB default limit, rejects oversized declared lengths before streaming, terminates oversized undeclared streams, rejects early EOF for declared lengths, and propagates cancellation upstream. Unit coverage verifies error propagation for 400/401/403/409/5xx, stream failures, timeout/abort mapping, and independent credentials when requests overlap. GitHub Actions now uses `pnpm/setup@v3`; actual CI and Docker execution remain outstanding. The final regression matrix is in `README.md`.

- [ ] Every implemented item has unit tests for validation and multipart serialization plus local Docker integration tests for the actual Gotenberg behaviour.
- [x] Add unit regression coverage for upstream `400`/`401`/`403`/`409`/`5xx`, malformed results, timeouts, cancellation, redirects, request/output-size limits, and credential-header isolation.
- [ ] Validate the same error/timeout cases against real Gotenberg and the deployment edge (including streaming output failures).
- [x] Cover overlapping browser-managed and server-managed proxy requests with independent credentials in unit tests.
- [ ] Manually switch connections while a browser conversion is in flight and verify cancellation and activity state.
- [ ] Keep destination allowlisting and origin checks in Gotenui while leaving upstream authentication to Gotenberg or an operator-controlled gateway.
- [x] Run a built Nitro Node production smoke test against a loopback mock backend in CI, independent of Docker.
- [ ] Run the attached Biome binary with `check --write`, project typechecking, Vitest unit/integration tests, and production build before release where dependencies and Docker are available.
- [ ] Leave generated files such as `pnpm-lock.yaml` untouched in incremental patches; complete manual desktop/mobile and accessibility checks **after** automated coverage.

## Upstream references

Review the documentation for the version being targeted before implementing a feature:

- [Gotenberg routes](https://gotenberg.dev/docs/getting-started/routes)
- [PDF merge ordering](https://gotenberg.dev/docs/manipulate-pdfs/merge-pdfs)
- [Convert URL to PDF: header and footer files](https://gotenberg.dev/docs/convert-with-chromium/convert-url-to-pdf)
- [Convert HTML to PDF](https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf)
- [Convert Markdown to PDF: templates and multiple files](https://gotenberg.dev/docs/convert-with-chromium/convert-markdown-to-pdf)
- [LibreOffice conversion options](https://gotenberg.dev/docs/convert-with-libreoffice/convert-to-pdf)
- [Webhook and remote download behaviour](https://gotenberg.dev/docs/webhook-download)
- [PDF watermarks](https://gotenberg.dev/docs/manipulate-pdfs/watermark-pdfs) and [PDF stamps](https://gotenberg.dev/docs/manipulate-pdfs/stamp-pdfs)

## Follow-on patches (post-v1.0.4)

- **v1.0.5 — Native overlay appearance:** Expose the default pdfcpu engine's opacity, rotation, position, relative size, offset, text size, font and colour as ordinary controls for repeated conversion-time and standalone watermark/stamp groups. Keep `watermarkOptions`/`stampOptions` JSON as an advanced fallback for PDF-engine-specific keys; never discard unknown keys when editing the normal controls. Drop text-only options when switching a layer to an image/PDF source.
- **v1.0.6 — First-class upstream parity:** Visual conversion/merge metadata, filename-specific merge bookmark editing with automatic page offsets, native LibreOffice text/tiled watermark appearance, Office export/viewer settings, remaining standalone encryption permissions, screenshot speed encoding, and read-into-write metadata/bookmark flows. Each is backed by multipart validation and unit tests; advanced JSON remains a fallback.
- **Potential next step:** Browser-level interaction and accessibility verification. The existing Docker integration contract is assumed passing for this patch, per the release request. Interactive OIDC remains deferred pending a concrete identity-provider requirement.

**v1.0.5 extension:** First-class per-file attachment MIME type and PDF/A associated-file relationship controls were implemented for standalone embedding and conversion-time PDF attachments. Remote attachment filenames can be registered manually; the JSON field remains an optional advanced mode. The two entry points share the same validation rules.
