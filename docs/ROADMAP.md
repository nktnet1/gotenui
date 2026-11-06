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
- [x] **Previous integration suites:** The user confirmed that both pinned v8.40.0 and v9.0.0 suites pass after patch 3. **Patch 4 expands the PDF test matrix; those new cases still require Docker-backed verification.** Docker is unavailable in this authoring environment.
- [x] **Patch 4:** Add a version-specific standalone PDF adapter covering the 15 existing tools, retain all v8 endpoints and inputs, and encode supported v9 operations as ordered `/forms/pdf/pipe` stages or v9 read routes. Incompatible v8 semantics (behind-content watermarks, flattening annotations, lossy optimisation, legacy filename bookmark maps, and extended metadata) are never silently translated.
- [x] **Patch 4:** Read v9 metadata/bookmark output back into the existing editors, display PDF/A remediation diagnostics returned by the upstream, and add v9 form controls for new foreground overlays and form-only flattening.
- [ ] **Patch 4 integration verification:** Run the newly expanded real-image PDF test suite against both `gotenberg/gotenberg:8.40.0` and `gotenberg/gotenberg:9.0.0`, including content-level PDF assertions and remediation responses.

### Compatibility baseline after patch 4 (v1.0.3)

| Capability                                  | Gotenberg 8                                                | Gotenberg 9                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health, version, connection selection       | Existing support                                           | Existing support                                                                                                                                                                                                                  |
| URL/HTML/Markdown screenshots (synchronous) | Existing support                                           | Version-aware media settings and webhooks (events callback required); integration verification pending                                                                                                                            |
| URL/HTML/Markdown to PDF                    | Existing support                                           | Form adapter, native controls, PDF/A remediation, and events webhooks; complex post-processing still unavailable                                                                                                                  |
| LibreOffice to PDF                          | Existing support                                           | Form adapter, native PDF/A/UA, merge/split stages, viewer and watermark mappings; complex post-processing still unavailable                                                                                                       |
| 15 PDF tools                                | Existing support (subject to existing v8 minimum versions) | Version-aware v9 `/forms/pdf/pipe`, `/forms/pdf/metadata` and `/forms/pdf/bookmarks`. Some advanced v8 options require a separate workflow or are explicitly rejected; newly expanded real-image tests await Docker verification. |
| Webhooks and async jobs                     | Existing support                                           | URL + required events callback; removed error callback rejected before upstream                                                                                                                                                   |
| Metrics                                     | Existing legacy/OTel paths                                 | OTel exporter support needs verification; legacy `/prometheus/metrics` route was removed                                                                                                                                          |

Gotenui's v8 tools retain their v8 paths and field encodings. **Standalone v9 PDF tools are implemented in patch 4, pending real-image verification.** Complex v8 conversion post-processing remains unavailable on v9 until the ordered pipeline builder is implemented. Unsupported or non-equivalent fields must fail visibly rather than be ignored.

## Migration workstreams (in dependency order)

### 2. Version-aware conversion request/response adapters — critical

- [x] Keep the existing v8 request builder unchanged, and add v9-specific encoding for Chromium PDF and LibreOffice conversion. Avoid renaming shared fields globally because v8 still requires the old names.
- [x] Chromium: rename `nativePageRanges` → `nativePages`, `generateDocumentOutline` → `nativeBookmarks`, `generateTaggedPdf` → `nativeTaggedPdf`, `waitWindowStatus` → `waitForWindowStatus`; convert media-feature arrays to v9 objects; expose `paperSize`.
- [ ] Confirm the remaining v9 Chromium advanced/reliability field changes against the running v9.0.0 image.
- [x] LibreOffice: map `exportBookmarks` → `nativeBookmarks`, `nativePageRanges` → `nativePages`, `singlePageSheets` → `singlePage`, compression fields to `native*`, `generateTaggedPdf` → `nativeTaggedPdf`, and map viewer preferences, watermark colour/rotation, and native PDF/A/PDF/UA. Omit removed `firstPageOnLeft` in the v9 UI and reject it server-side. `exportBookmarks=true` remains a v8 default but is translated for v9.
- [x] Implement limited ordered v9 `stages` for conversion-time Office merge/split/select, Chromium PDF/A/UA remediation, and PDF/A-4 + PDF/UA-2 native-export safety.
- [ ] Migrate the remaining conversion post-processing (encryption, metadata, watermarks, attachments and other overlays) to validated ordered v9 stages. The v9 proxy **rejects** v8 post-processing payloads in the meantime, rather than silently changing their semantics.
- [ ] Support v9 image/ZIP responses through the bounded proxy, MIME/signature validation, safe filenames, previews and batch downloads. Preserve v8 handling.
- [x] Handle v9 webhooks using `Gotenberg-Webhook-Url` **and** `Gotenberg-Webhook-Events-Url`. The UI already has an events URL input; reject v8-only error URL/method fields on v9 and preserve them unchanged for v8.
- [ ] Improve version-specific webhook editor guidance and callback progress display.

### 3. PDF operation migration and pipeline builder — critical

Gotenberg 9 removes the 15 `POST /forms/pdfengines/*` routes used here, replacing them with individual `POST /forms/pdf/{operation}` routes and `POST /forms/pdf/pipe` for an ordered JSON array of `stages`. A path-only replacement is insufficient: flat form keys, file inputs, JSON responses and post-processing are different.

- [x] Add a version-aware PDF adapter for the existing tools: merge, split, PDF/A (`remediate`), optimise, rotate, flatten form, encrypt, watermark/stamp, read/write metadata, read/write bookmarks, attachments (`attach`) and Factur-X (`remediate` plus its profile/invoice inputs).
- [ ] Build an ordered, validated v9 pipeline UI with explicit stage ordering, inputs and outputs (including `select` for `splitUnify`), preview, and safe composition with conversion endpoints.
- [x] Update PDF metadata/bookmarks editors and read-back/import for the v9 response structures. Differentiate v8 watermarks behind content from v9 foreground stamp behaviour; do not quietly alter a user's intended visual result.
- [x] Preserve all v8 PDF routes and v8 field behaviours behind the version-specific adapter.

### 4. Missing Gotenberg 9 stages — high

The supplied v9 `pkg/modules/pdf/stages.go` registers **26 stage types**. Of these, the following **13 are not existing distinct Gotenui workflows**:

- [ ] `select` (select/unify PDF pages), `delete`, `insert`.
- [ ] `set-form` (fill forms), `flatten-transparency`, `convert-colors`, `redact`, `autotag`.
- [ ] `detach` (remove embedded attachments), `decrypt`, `sign`, `timestamp`, `render` (pages to images).

Implement these as v9-only workflows initially when v8 has no equivalent, and let v9 users compose them in the pipeline. Treat redaction and digital-signature operations as high-integrity tasks requiring meaningful validation and feedback.

### 5. PDF inspection, compliance and metadata — high

The supplied v9 `pkg/modules/pdf/routes.go` exposes **six read endpoints**: `metadata`, `bookmarks`, `info`, `validate`, `attachments` and `form`. The UI currently has v8 metadata and bookmark reading, which also need v9 migration; the following four read workflows are missing:

- [ ] `info`: page count, PDF version, encrypted/tagged/linearised flags and form-field presence.
- [ ] `validate`: PDF/A, PDF/UA and Factur-X conformance; surface per-file violations, not only a success status.
- [ ] `attachments`: list PDF-embedded files.
- [ ] `form`: list interactive PDF form fields and values.
- [ ] Expose additional v9 PDF/A profiles and PDF/UA-2 where supported; distinguish native export from post-processing remediation.
- [x] Forward and display `Gotenberg-Remediation-Residual` and `Gotenberg-Remediation-Rolled-Back`. A successful HTTP response alone does **not** establish PDF/A/PDF/UA compliance.

### 6. Remaining v9 compatibility and polish — medium

- [x] Refuse legacy `downloadFrom` attachment/watermark/stamp destinations and unmigrated multipart `embeds` uploads on v9 instead of silently treating them as conversion inputs; keep ordinary remote Office inputs on both versions.
- [ ] Archive inputs (`archives`), further remote-input fields and format-specific upload validation.
- [ ] Revisit allowed Office extensions (including EPUB removal), named paper-size presets, native compression choices and Gotenberg 9 options for each tool.
- [ ] Distinguish Gotenberg 8 legacy Prometheus `/prometheus/metrics` from Gotenberg 9 exporter-based metrics; do not rely on the deleted route.
- [x] Route standalone v9 PDF tool documentation links to the new pipeline and read API pages; retain v8 links for v8 connections. Additional v9 documentation polish remains.
- [ ] Test switching v8 ↔ v9 connections while a tool or batch queue is selected, status refreshes, and version/header mismatches.
- [x] Add a CI matrix for pinned **Gotenberg 8.40.0** and **9.0.0** real-image integration tests, with basic conversions, screenshots, auth, native field mappings, webhooks and limited stages.
- [ ] Expand v9 real-image fixtures for missing PDF endpoints, complex pipeline ordering, read JSON, ZIP/image outputs, metadata import and remediation headers. Patch 4 adds all existing PDF tool endpoints plus split ZIP and metadata/bookmark import unit coverage; comprehensive new-stage fixtures remain.
- [ ] Observe successful runs of the **new PDF integration cases** on both pinned Gotenberg images in a Docker-enabled environment; patch 3 suites previously passed according to the user, but unit tests alone cannot verify patch 4 PDF stage execution.

## Acceptance criteria for complete dual-version support

1. A Gotenberg 8 connection continues to expose every currently working v8 tool, including its form fields, presets, webhooks and PDF post-processing.
2. A Gotenberg 9 connection exposes all migrated conversion and PDF operations, using the v9 API without emitting removed v8 keys; v9-only functions are discoverable and gated appropriately on v8.
3. No frontend or direct proxy request is routed through the wrong major-version adapter, including after a connection swap or upstream upgrade.
4. Unknown/unsupported majors are explained clearly. Offline behaviour remains diagnosable without silently forcing a request through v8 APIs.
5. Unit and real-upstream compatibility tests pass for **both** major versions. The audit is complete only after explicit validation against running v8 and v9 servers, not merely source inspection.
