# Gotenui roadmap

- **Baseline:** v1.0.29 (native Node.js TypeScript release smoke with additional negative/async cases; v1.0.28 deployment coverage retained).
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
| **v1.1.0 candidate** | Release | Final review | Manual browser/mobile testing, documentation verification, and release assessment. |

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

**Current state:** Gotenui can forward browser-provided bearer tokens, but it does not implement OIDC sign-in or refresh tokens. This is **not required** for normal Gotenberg deployments and should not introduce a second Gotenui-only authorisation system.

- [ ] Only scope this after a concrete upstream identity-provider or gateway requirement is identified.
- [ ] If needed, define a stateless or delegated token-acquisition flow, token expiry/refresh behaviour, and safe ephemeral handling; avoid `localStorage` secrets by default.
- [ ] Preserve Gotenberg/gateway decisions about access and keep unrelated connection profiles isolated.

## Verification and release gates

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
