# Gotenui roadmap: Gotenberg 8 and 9

**Goal:** one UI that supports both Gotenberg 8 and Gotenberg 9, chosen automatically from each connection's `/version` response. Do not remove Gotenberg 8 behaviour to add Gotenberg 9.

**Status:** v9 migration in progress. This is a plan and compatibility inventory, **not a claim that every v9 feature works today**. Findings were checked against the supplied Gotenberg 9 source (`pkg/modules/pdf/`, `pkg/modules/chromium/routes.go`, `pkg/modules/libreoffice/` and `pkg/modules/webhook/`) and this project's existing operation registry, request builder and API proxy.

## Progress and compatibility contract

- [x] **Patch 1:** Parse Gotenberg major/minor/patch versions from the existing status API, including version prefixes and prerelease suffixes; avoid guessing from an unavailable `/version` response.
- [x] **Patch 1:** Declare support per tool. All current operations retain Gotenberg 8 support; URL, HTML and Markdown **screenshots** also use their unchanged v9 Chromium routes. Other v9 operations are disabled instead of sending known-incompatible v8 form fields/routes.
- [x] **Patch 1:** Show an explanation in the workspace and unavailable-tool controls. An unknown/unsupported _online_ version is not silently treated as v8; offline troubleshooting remains available. v9 screenshot webhooks remain blocked until the v9 callback model is implemented.
- [ ] **Next:** Make the API proxy select and validate a version-specific adapter **server-side**, including for direct API callers, queued jobs and connections that change version between checks. The current patch prevents unsupported **UI-originated** operations after status detection; it does **not** provide authoritative upstream-version negotiation per conversion request.
- [ ] **Next:** Cover the v8 and v9 implementations with tests using both actual Gotenberg images (or equivalent upstream contract fixtures). Unknown/unreachable versions and version changes must have deterministic handling.

### Compatibility baseline after patch 1

| Capability                                  | Gotenberg 8                                                | Gotenberg 9                                                                              |
| ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Health, version, connection selection       | Existing support                                           | Existing support                                                                         |
| URL/HTML/Markdown screenshots (synchronous) | Existing support                                           | Shared routes exposed; integration verification pending                                  |
| URL/HTML/Markdown to PDF                    | Existing support                                           | Disabled until conversion/form adapter lands                                             |
| LibreOffice to PDF                          | Existing support                                           | Disabled until conversion/form adapter lands                                             |
| 15 PDF tools                                | Existing support (subject to existing v8 minimum versions) | Disabled until PDF API migration                                                         |
| Webhooks and async jobs                     | Existing support                                           | Disabled for v9 screenshots until event-header compatibility is implemented              |
| Metrics                                     | Existing legacy/OTel paths                                 | OTel exporter support needs verification; legacy `/prometheus/metrics` route was removed |

For now **do not use v9 as the default for existing conversion or PDF workflows**. Gotenui's v8 tools retain their v8 paths and field encodings. Any future operation that supports v9 must explicitly opt in only after its complete request and response contract has been verified.

## Migration workstreams (in dependency order)

### 2. Version-aware conversion request/response adapters — critical

- [ ] Keep the existing v8 request builder unchanged, and add v9-specific encoding for Chromium PDF and LibreOffice conversion. Avoid renaming shared fields globally because v8 still requires the old names.
- [ ] Chromium: rename `nativePageRanges` → `nativePages`, `generateDocumentOutline` → `nativeBookmarks`, `generateTaggedPdf` → `nativeTaggedPdf`; consider `paperSize`; confirm defaults and all advanced/reliability fields.
- [ ] LibreOffice: rename `exportBookmarks` → `nativeBookmarks`, `nativePageRanges` → `nativePages`, `singlePageSheets` → `singlePage`, image-quality/compression fields to `native*`, and `generateTaggedPdf` → `nativeTaggedPdf`. Adapt viewer preferences, watermark colour/rotation, and native PDF/A/PDF/UA fields and values; remove v9-only unsupported fields such as `firstPageOnLeft`. `exportBookmarks=true` is currently a v8 default, so it must not leak into v9.
- [ ] Ensure PDF post-processing on conversion uses ordered v9 `stages` rather than v8 form fields. Model v9's page-range, merge/split, encryption, metadata, PDF/A and watermark semantics explicitly.
- [ ] Support v9 image/ZIP responses through the bounded proxy, MIME/signature validation, safe filenames, previews and batch downloads. Preserve v8 handling.
- [ ] Handle v9 webhooks using `Gotenberg-Webhook-Url` **and** `Gotenberg-Webhook-Events-Url`. The UI already has an events URL input; retire v8-only error URL/method headers **only for v9**. Preserve v8 behavior for v8 connections.

### 3. PDF operation migration and pipeline builder — critical

Gotenberg 9 removes the 15 `POST /forms/pdfengines/*` routes used here, replacing them with individual `POST /forms/pdf/{operation}` routes and `POST /forms/pdf/pipe` for an ordered JSON array of `stages`. A path-only replacement is insufficient: flat form keys, file inputs, JSON responses and post-processing are different.

- [ ] Add a version-aware PDF adapter for the existing tools: merge, split, PDF/A (`remediate`), optimise, rotate, flatten form, encrypt, watermark/stamp, read/write metadata, read/write bookmarks, attachments (`attach`) and Factur-X (`remediate` plus its profile/invoice inputs).
- [ ] Build an ordered, validated v9 pipeline UI with explicit stage ordering, inputs and outputs (including `select` for `splitUnify`), preview, and safe composition with conversion endpoints.
- [ ] Update PDF metadata/bookmarks editors and read-back/import for the v9 response structures. Differentiate v8 watermarks behind content from v9 foreground stamp behaviour; do not quietly alter a user's intended visual result.
- [ ] Preserve all v8 PDF routes and v8 field behaviours behind the version-specific adapter.

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
- [ ] Forward and display `Gotenberg-Remediation-Residual` and `Gotenberg-Remediation-Rolled-Back`. A successful HTTP response alone does **not** establish PDF/A/PDF/UA compliance.

### 6. Remaining v9 compatibility and polish — medium

- [ ] Archive inputs (`archives`), remote-input fields and format-specific upload validation.
- [ ] Revisit allowed Office extensions (including EPUB removal), named paper-size presets, native compression choices and Gotenberg 9 options for each tool.
- [ ] Distinguish Gotenberg 8 legacy Prometheus `/prometheus/metrics` from Gotenberg 9 exporter-based metrics; do not rely on the deleted route.
- [ ] Make tool-specific API documentation links version-aware as upstream v9 documentation becomes available.
- [ ] Test switching v8 ↔ v9 connections while a tool or batch queue is selected, status refreshes, and version/header mismatches.
- [ ] Add integration fixtures for v8 and v9: same basic conversion output, unsupported field rejection, webhook events, PDF stage ordering, read JSON, ZIP/image outputs, metadata import and remediation headers.

## Acceptance criteria for complete dual-version support

1. A Gotenberg 8 connection continues to expose every currently working v8 tool, including its form fields, presets, webhooks and PDF post-processing.
2. A Gotenberg 9 connection exposes all migrated conversion and PDF operations, using the v9 API without emitting removed v8 keys; v9-only functions are discoverable and gated appropriately on v8.
3. No frontend or direct proxy request is routed through the wrong major-version adapter, including after a connection swap or upstream upgrade.
4. Unknown/unsupported majors are explained clearly. Offline behaviour remains diagnosable without silently forcing a request through v8 APIs.
5. Unit and real-upstream compatibility tests pass for **both** major versions. The audit is complete only after explicit validation against running v8 and v9 servers, not merely source inspection.
