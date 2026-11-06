# Gotenui roadmap: Gotenberg 8 and 9

**Goal:** one UI that supports both Gotenberg 8 and Gotenberg 9, chosen automatically from each connection's `/version` response. Do not remove Gotenberg 8 behaviour to add Gotenberg 9.

**Status:** v9 migration in progress. This is a plan and compatibility inventory, **not a claim that every v9 feature works today**. Findings were checked against the supplied Gotenberg 9 source (`pkg/modules/pdf/`, `pkg/modules/chromium/routes.go`, `pkg/modules/libreoffice/` and `pkg/modules/webhook/`) and this project's existing operation registry, request builder and API proxy.

## Progress and compatibility contract

- [x] **Patch 1:** Parse Gotenberg major/minor/patch versions from the existing status API, including version prefixes and prerelease suffixes; avoid guessing from an unavailable `/version` response.
- [x] **Patch 1:** Declare support per tool. All current operations retain Gotenberg 8 support; URL, HTML and Markdown **screenshots** also use their unchanged v9 Chromium routes. Other v9 operations are disabled instead of sending known-incompatible v8 form fields/routes.
- [x] **Patch 1:** Show an explanation in the workspace and unavailable-tool controls. An unknown/unsupported _online_ version is not silently treated as v8; offline troubleshooting remains available. v9 screenshot webhooks remain blocked until the v9 callback model is implemented.
- [x] **Patch 2:** The proxy fetches the selected, authenticated upstream `/version` **for every conversion request** (including queued and direct API calls), refuses unknown/unsupported majors, and chooses a v8 or v9 request adapter. A connection changing versions cannot silently send the wrong form.
- [x] **Patch 2:** Pin the real integration-test matrix to **`gotenberg/gotenberg:8.40.0` and `gotenberg/gotenberg:9.0.0`**, verify `/version` against the selected image, and add version-specific assertions. Unit tests test both major-version encodings without Docker.
- [x] **Patch 3:** Run both pinned Docker images by default in local `pnpm test`/`pnpm test:integration`, stream image-pull progress, and name each CI matrix job by version. The earlier local integration command exercised **only v8.40.0** unless `GOTENBERG_TEST_VERSION` was set; the four v9-only cases were skipped, not passed.
- [x] **Previous integration suites:** The user confirmed both pinned v8.40.0 and v9.0.0 suites passing after patch 3 and, again, after the expanded PDF test fixes in v1.0.6. New tests introduced by v1.0.7 still require a Docker-backed run.
- [x] **Patch 4:** Add a version-specific standalone PDF adapter covering the 15 existing tools, retain all v8 endpoints and inputs, and encode supported v9 operations as ordered `/forms/pdf/pipe` stages or v9 read routes. Incompatible v8 semantics (behind-content watermarks, flattening annotations, lossy optimisation, legacy filename bookmark maps, and extended metadata) are never silently translated.
- [x] **Patch 4:** Read v9 metadata/bookmark output back into the existing editors, display PDF/A remediation diagnostics returned by the upstream, and add v9 form controls for new foreground overlays and form-only flattening.
- [x] **Patch 4 integration verification (user-run):** The expanded PDF integration cases through v1.0.6 were confirmed passing on both pinned images after the pipeline-test corrections. Additional remediation-header edge cases remain in the workstreams below.
- [x] **Patch 5 (v1.0.4):** Register 17 Gotenberg 9-only workflows: all 13 previously missing PDF processing stages (`select`, `delete`, `insert`, `set-form`, `flatten-transparency`, `convert-colors`, `redact`, `autotag`, `detach`, `decrypt`, `sign`, `timestamp`, `render`) and the four inspection endpoints (`info`, `validate`, `attachments`, `form`). The v8 catalogue and PDF request adapter are unchanged; v9-only tools explain their version requirement on v8.
- [x] **Patch 5:** Strictly validate stage inputs, PDF form JSON, page selections, certificate uploads, redaction confirmation/coordinates and timestamp URLs. Accept v9 rendering responses as PNG, JPEG or ZIP, while preserving the proxy's response size, MIME and signature checks. Show per-document validation conformance and a bounded list of violations, including when HTTP 200 reports a noncompliant document.
- [x] **Patch 5:** Add per-operation unit tests and pinned-v9 integration cases for inspection, page modifications, conversion, compliance, form read/write, encryption/decryption, attachments, signing and rendered images. Signing credentials and the interactive form fixture are generated during the test rather than checked into the repository.
- [x] **Patch 5 integration verification (user-run):** The two compact-JSON inspection assertion failures were fixed in v1.0.5. The user subsequently confirmed both pinned integration suites pass after the v1.0.6 test-harness corrections.
- [x] **Patch 6 (v1.0.5):** Add a Gotenberg 9-only, accessible PDF pipeline builder with all 26 supported processing stages, move-up/down ordering, per-stage JSON settings, named auxiliary uploads, credential-masked preview and a redaction confirmation. The browser and server validate stage names, options, ordering, required uploads, and redaction acknowledgement. Support PDF, ZIP, PNG and JPEG results as appropriate, without changing any Gotenberg 8 request adapters.
- [x] **Patch 6:** Correct the two v9 integration assertions for compact JSON inspection results; keep the stricter response checks for PDFs, ZIPs and images. Add unit and real-image integration cases for the standalone pipeline, including multi-stage page editing, attachments, and rendering.
- [x] **Patch 6 integration verification (user-run):** Both pinned images were exercised locally; two test-harness regressions surfaced (the v9-only pipeline tool was included in the v8 smoke list, and an edited-and-rendered v9 pipeline expected an image instead of the PDF-plus-image ZIP).
- [x] **Patch 7 (v1.0.6):** Run the pinned v8 and v9 integration suites concurrently using isolated Vitest processes and Docker instances, retain live pull logs and aggregate failures, exclude v9-only tools from the v8 smoke list, and check both files within the v9 edited-and-rendered ZIP.
- [x] **Patch 7 integration verification (user-run):** The user confirmed that **both** `gotenberg/gotenberg:8.40.0` and `gotenberg/gotenberg:9.0.0` integration suites pass after v1.0.6. This covers the pre-v1.0.7 integration cases, including the corrected pipeline and ZIP assertions.
- [x] **Patch 8 (v1.0.7):** `pnpm test` concurrently launches the unit suite and the already-parallel v8/v9 integration suites, retains live stdout/stderr and aggregates failures. A sequential opt-out is available through `GOTENUI_TEST_SEQUENTIAL=1` for limited-memory hosts. CI already runs quality and both pinned integration jobs in parallel.
- [x] **Patch 8:** Allow PDF conversions on v9 to use the visual ordered-stage editor and named stage-file uploads, while preserving the original Chromium/LibreOffice routes and Gotenberg 8 conversion forms. The client, batch queue, and server validate uploaded filenames, sizes, stage operations and ordering, redaction acknowledgement, and version compatibility. Built-in merge/split precede user stages; automatic PDF/A/UA remediation follows them.
- [ ] **Patch 8 integration verification:** Execute the newly added HTML metadata and Office attachment conversion-time pipeline cases on `gotenberg/gotenberg:9.0.0`. No Docker daemon is available in the patch authoring environment.

### Compatibility baseline after patch 8 (v1.0.7)

| Capability                                  | Gotenberg 8                                                | Gotenberg 9                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health, version, connection selection       | Existing support                                           | Existing support                                                                                                                                                            |
| URL/HTML/Markdown screenshots (synchronous) | Existing support                                           | Version-aware media settings and webhooks (events callback required); verified in pinned integration suite                                                                  |
| URL/HTML/Markdown to PDF                    | Existing support                                           | Form adapter, native controls, PDF/A remediation, and events webhooks; explicit ordered v9 stages available; non-equivalent legacy v8 options remain unavailable            |
| LibreOffice to PDF                          | Existing support                                           | Form adapter, native PDF/A/UA, merge/split stages, viewer and watermark mappings; explicit ordered v9 stages available; non-equivalent legacy v8 options remain unavailable |
| 15 original PDF tools                       | Existing support (subject to existing v8 minimum versions) | Version-aware v9 pipeline and read routes. Non-equivalent advanced settings are explicitly rejected; expanded Docker PDF tests confirmed through v1.0.6.                    |
| 18 new PDF workflows                        | Not exposed; v9-only tools are unavailable on v8           | 13 independent processing tools, four inspection tools, and the ordered pipeline builder; real-image cases confirmed through v1.0.6.                                        |
| PDF validation and image output             | Existing v8 behaviour                                      | Per-file conformance and violations surfaced, including noncompliance on HTTP 200; PNG/JPEG/ZIP responses accepted with signature verification.                             |
| Webhooks and async jobs                     | Existing support                                           | URL + required events callback; removed error callback rejected before upstream                                                                                             |
| Metrics                                     | Existing legacy/OTel paths                                 | OTel exporter support needs verification; legacy `/prometheus/metrics` route was removed                                                                                    |

Gotenui's v8 tools retain their v8 paths and field encodings. **All original standalone PDF tools are implemented for v9 in patch 4, 17 additional tools in patch 5, and the ordered PDF pipeline builder in patch 6. Conversion-time stages are added in patch 8. Existing integration cases through patch 7 were confirmed passing by the user; the new patch 8 cases await Docker verification.** Legacy v8 post-processing forms are still unavailable on v9 because their effects are not all equivalent. Users can deliberately configure compatible v9 stages in the new conversion-time editor. Unsupported or non-equivalent fields must fail visibly rather than be ignored.

## Migration workstreams (in dependency order)

### 2. Version-aware conversion request/response adapters — critical

- [x] Keep the existing v8 request builder unchanged, and add v9-specific encoding for Chromium PDF and LibreOffice conversion. Avoid renaming shared fields globally because v8 still requires the old names.
- [x] Chromium: rename `nativePageRanges` → `nativePages`, `generateDocumentOutline` → `nativeBookmarks`, `generateTaggedPdf` → `nativeTaggedPdf`, `waitWindowStatus` → `waitForWindowStatus`; convert media-feature arrays to v9 objects; expose `paperSize`.
- [ ] Confirm the remaining v9 Chromium advanced/reliability field changes against the running v9.0.0 image.
- [x] LibreOffice: map `exportBookmarks` → `nativeBookmarks`, `nativePageRanges` → `nativePages`, `singlePageSheets` → `singlePage`, compression fields to `native*`, `generateTaggedPdf` → `nativeTaggedPdf`, and map viewer preferences, watermark colour/rotation, and native PDF/A/PDF/UA. Omit removed `firstPageOnLeft` in the v9 UI and reject it server-side. `exportBookmarks=true` remains a v8 default but is translated for v9.
- [x] Implement limited ordered v9 `stages` for conversion-time Office merge/split/select, Chromium PDF/A/UA remediation, and PDF/A-4 + PDF/UA-2 native-export safety.
- [x] Expose applicable conversion-time encryption, metadata, foreground stamping, attachments, redaction and other source-defined v9 stages through the validated visual editor, including named asset uploads and batch queue support (patch 8). Decryption is deliberately excluded for newly generated PDFs. The v9 proxy **continues to reject** v8 post-processing payloads: those options have no universally equivalent v9 encoding and must be explicitly configured as v9 stages instead.
- [x] Support image/ZIP responses for the standalone v9 `render` operation through the bounded proxy, with MIME/signature validation and browser downloads. Preserve v8 handling.
- [ ] Verify the full v9 archive/image response matrix for conversion-time pipelines, including safe filenames and previews. Stage-specific MIME acceptance and signature verification are implemented; new live-image assertions still need a Docker run.
- [x] Handle v9 webhooks using `Gotenberg-Webhook-Url` **and** `Gotenberg-Webhook-Events-Url`. The UI already has an events URL input; reject v8-only error URL/method fields on v9 and preserve them unchanged for v8.
- [ ] Improve version-specific webhook editor guidance and callback progress display.

### 3. PDF operation migration and pipeline builder — critical

Gotenberg 9 removes the 15 `POST /forms/pdfengines/*` routes used here, replacing them with individual `POST /forms/pdf/{operation}` routes and `POST /forms/pdf/pipe` for an ordered JSON array of `stages`. A path-only replacement is insufficient: flat form keys, file inputs, JSON responses and post-processing are different.

- [x] Add a version-aware PDF adapter for the existing tools: merge, split, PDF/A (`remediate`), optimise, rotate, flatten form, encrypt, watermark/stamp, read/write metadata, read/write bookmarks, attachments (`attach`) and Factur-X (`remediate` plus its profile/invoice inputs).
- [x] Build an ordered, validated v9 **standalone PDF-input** pipeline UI with stage ordering, PDF/ZIP/image output handling, named auxiliary uploads, `select`, and secret-masked preview (patch 6).
- [x] Compose the same stages directly after Chromium/LibreOffice conversions, without a separate PDF upload (patch 8). Legacy v8 post-processing options remain rejected on v9 when their semantics differ.
- [x] Update PDF metadata/bookmarks editors and read-back/import for the v9 response structures. Differentiate v8 watermarks behind content from v9 foreground stamp behaviour; do not quietly alter a user's intended visual result.
- [x] Preserve all v8 PDF routes and v8 field behaviours behind the version-specific adapter.

### 4. Missing Gotenberg 9 stages — high

The supplied v9 `pkg/modules/pdf/stages.go` registers **26 stage types**. Of these, the following **13 are not existing distinct Gotenui workflows**:

- [x] `select` (select/unify PDF pages), `delete`, `insert` (patch 5; live-image verification pending).
- [x] `set-form` (fill forms), `flatten-transparency`, `convert-colors`, `redact`, `autotag` (patch 5; live-image verification pending).
- [x] `detach` (remove embedded attachments), `decrypt`, `sign`, `timestamp`, `render` (pages to images; patch 5; live-image verification pending).

These stages are available as individual v9-only workflows and through the standalone, ordered pipeline composer added in patch 6. Pipeline composition directly after Chromium/LibreOffice conversion is available from patch 8 (new live integration cases pending). Redaction requires explicit acknowledgement and validated rectangles; signing requires uploaded credentials. Verify results before using redacted or signed documents in security-critical workflows.

### 5. PDF inspection, compliance and metadata — high

The supplied v9 `pkg/modules/pdf/routes.go` exposes **six read endpoints**: `metadata`, `bookmarks`, `info`, `validate`, `attachments` and `form`. The UI currently has v8 metadata and bookmark reading, which also need v9 migration; the following four read workflows were missing before patch 5:

- [x] `info`: page count, PDF version, encrypted/tagged/linearised flags and form-field presence (patch 5).
- [x] `validate`: PDF/A, PDF/UA and Factur-X conformance; surface per-file violations, not only a success status (patch 5).
- [x] `attachments`: list PDF-embedded files (patch 5).
- [x] `form`: list interactive PDF form fields and values (patch 5).
- [x] Expose all 14 source-defined validation profiles and supported PDF/A + PDF/UA pairs through the v9 validation form (patch 5).
- [ ] Extend the original conversion-time remediation forms to every supported v9 profile, distinguishing native export from post-processing remediation.
- [x] Forward and display `Gotenberg-Remediation-Residual` and `Gotenberg-Remediation-Rolled-Back`. A successful HTTP response alone does **not** establish PDF/A/PDF/UA compliance.

### 6. Remaining v9 compatibility and polish — medium

- [x] Refuse legacy `downloadFrom` attachment/watermark/stamp destinations and unmigrated multipart `embeds` uploads on v9 instead of silently treating them as conversion inputs; keep ordinary remote Office inputs on both versions.
- [ ] Archive inputs (`archives`), further remote-input fields and format-specific upload validation.
- [ ] Revisit allowed Office extensions (including EPUB removal), named paper-size presets, native compression choices and Gotenberg 9 options for each tool.
- [ ] Distinguish Gotenberg 8 legacy Prometheus `/prometheus/metrics` from Gotenberg 9 exporter-based metrics; do not rely on the deleted route.
- [x] Route standalone v9 PDF tool documentation links to the new pipeline and read API pages; retain v8 links for v8 connections. Additional v9 documentation polish remains.
- [ ] Test switching v8 ↔ v9 connections while a tool or batch queue is selected, status refreshes, and version/header mismatches.
- [x] Add a CI matrix for pinned **Gotenberg 8.40.0** and **9.0.0** real-image integration tests, with basic conversions, screenshots, auth, native field mappings, webhooks and limited stages.
- [x] Add v9 integration fixtures for all four read endpoints and locally testable new stages (including signing), form read/write, PDF content checks and ZIP/image output; patch 5. Timestamp stage encoding and URL validation have unit coverage only; no external timestamp authority is called by tests.
- [x] Add standalone multi-stage integration cases for merge/select/metadata, attachments, and rendered images (patch 6; execution pending).
- [ ] Extend real-image integration coverage to complex remediation headers and timestamp authorities. Patch 8 adds HTML and Office conversion-time pipeline assertions; those await a Docker-backed run.
- [x] The user confirmed that the **expanded PDF integration cases** through v1.0.6 pass on both pinned images, including the corrected compact JSON response assertions and staged ZIP rendering. New conversion-time stage cases from v1.0.7 still require live Docker verification.

## Acceptance criteria for complete dual-version support

1. A Gotenberg 8 connection continues to expose every currently working v8 tool, including its form fields, presets, webhooks and PDF post-processing.
2. A Gotenberg 9 connection exposes all migrated conversion and PDF operations, using the v9 API without emitting removed v8 keys; v9-only functions are discoverable and gated appropriately on v8.
3. No frontend or direct proxy request is routed through the wrong major-version adapter, including after a connection swap or upstream upgrade.
4. Unknown/unsupported majors are explained clearly. Offline behaviour remains diagnosable without silently forcing a request through v8 APIs.
5. Unit and real-upstream compatibility tests pass for **both** major versions. The audit is complete only after explicit validation against running v8 and v9 servers, not merely source inspection.
