# Using Gotenui

## Connections

Open **Connection settings** to select a Gotenberg instance. The public demo is the default unless your deployment provides another URL.

- **Browser connections** store the connection name, URL and authentication mode in your browser. Passwords and bearer tokens remain in tab memory and must be re-entered after refreshing. Authenticated profiles cannot make requests until their credentials are restored.
- **Managed connections** are configured by the deployment administrator. You can select them without seeing the stored upstream credentials. If a saved managed connection is unavailable, Gotenui retains the selected target instead of switching to the public demo. Select another connection explicitly in settings.

Browser and managed Basic authentication accept valid UTF-8 credentials (up to 255 username and 2,048 password UTF-16 code units) without control characters. Bearer tokens may contain up to 4,096 characters. Browser API requests refuse redirects so connection credentials and uploaded files cannot be forwarded to another destination.

Your deployment must allow the selected Gotenberg URL. Adding a browser connection does not add it to the server's allowlist.

## Conversions and PDF tools

HTML and Markdown source imports, including custom PDF header and footer files, require UTF-8. A selection of Markdown files must fit within the configured upload limit. Manual edits or a newer import supersede pending imports into the same editor.

Choose a tool in the sidebar or open search with **Ctrl+K** or **Cmd+K**. Gotenui provides individual controls for supported Gotenberg settings, including Office exports, Chromium rendering, PDF attachments and post-processing.

- For multi-file merges, arrange local uploads in the order they should appear.
- For metadata and bookmarks, use **Read existing PDF values** to load values into the editor before writing them back.
- PDF conversions, merges and splits can apply watermarks, stamps, rotation, attachments, Factur-X, flattening and encryption in the same request. For Merge PDFs, use the existing metadata editor above the post-processing panel.
- Advanced JSON is available for unusual Gotenberg options. You don't need it for the settings exposed in the form.

Gotenberg can return a PDF or a ZIP archive depending on the operation and number of outputs. Gotenui downloads the format actually returned.

With **Gotenberg 9**, the PDF pipeline builder accepts individual PDFs, uploaded ZIP archives of PDF sources, and remote PDF URLs. All Gotenberg 9 PDF tools accept ZIP inputs containing PDF sources; additional ZIP uploads can accompany any Gotenberg 9 conversion route. You can mix these inputs, or use a ZIP/remote URL without uploading individual PDFs. ZIPs must be uploaded through **PDF ZIP archives** to be unpacked; ZIPs fetched through `downloadFrom` remain ordinary files. Named pipeline assets (attachments, images, signing credentials, etc.) can be separate uploads **or entries in an uploaded ZIP**, referenced by their exact filename in the stage editor. Asset-only ZIPs still need a separate source PDF or a remote PDF input. On Gotenberg 9.2+, a remote download can also supply a stage asset when its `filename` matches the exact name referenced by the stage; otherwise the server resolves the downloaded filename. Gotenberg validates ZIP contents and enforces extraction limits; Gotenberg 8's tools and upload rules are unchanged.

With **Gotenberg 9.1 or later**, **Extract PDF text** produces a `.txt` file for one document or a ZIP for multiple files. Select pages using one-based ranges (such as `1-3,5` or `odd`); optional switches include invisible text, page artifacts and annotation text. This is PDF text extraction, **not OCR**: scanned images can yield an empty text file. **Extract PDF attachments** downloads embedded files with their original contents and extensions; supply an exact embedded filename to select one, or omit it to extract everything (multiple outputs produce a ZIP). Attachments can be binary or zero bytes long, and international filenames are preserved. Both operations are also terminal options in the PDF pipeline and in Chromium/Office conversion stages. A pipeline that edits a PDF before extraction (or extracts from a generated PDF) returns a ZIP containing the PDF alongside the extracted file(s). The UI exposes all 29 stages for Gotenberg major 9, with version checks for newer stage features. Gotenberg has no dedicated capabilities endpoint; an older or route-disabled 9.x instance may reject an extraction request. Use the latest Gotenberg 9 release for these operations. Missing standalone extraction endpoints return a descriptive error.

For Gotenberg 9 **Office to PDF**, a requested PDF/A or PDF/UA profile uses native LibreOffice export only when no PDF processing follows. **Merge**, **Split**, and custom pipeline stages automatically move conformance to a final PDF remediation stage; selecting **Native LibreOffice export** alongside those stages reports an error. Use PDF validation to check actual conformance rather than relying on HTTP 200 or a successful native export.

### Gotenberg 9.10 tracked changes in Office documents

On **Gotenberg 9.10+**, **Office to PDF** offers **Show tracked changes** under advanced settings. Enable it to preserve the visible markup for recorded insertions and deletions, including revision indicators in the margins, as supported by LibreOffice. Leave it off to accept changes for the purpose of the PDF export, retaining Gotenberg's default behaviour without modifying the original document. The setting is available only on Gotenberg 9.10+ and is rejected by the proxy on older versions. Gotenberg 9.10 also fixes macro execution when administrators enable LibreOffice macros on the server, which does not require a frontend setting.

### Gotenberg 9.9 Office locale and PDF stream compression

On **Gotenberg 9.9+**, **Office to PDF** has a **Document locale (BCP 47)** field, such as `en-AU`, `de-DE` or `zh-Hans-CN`. It controls locale-dependent date, number and currency formatting, plus fallback paper size for documents that set none. A document's own language remains unchanged. Leaving it empty retains the server default. The form validates the subset of BCP 47 tags accepted by Gotenberg 9.9 and rejects this field on earlier servers.

**Optimize PDFs** adds **Compress streams**, enabled by Gotenberg by default. It compresses previously uncompressed page-content and font streams without compressing XMP metadata. Use the advanced select to override this option, or set `"compressStreams": false`/`true` on the `optimize` PDF pipeline stage. Both forms require Gotenberg 9.9+; omission preserves the upstream default. Gotenberg 9.9 also fixes excessively large unsigned remediation output and a PDF/A-1 plus PDF/UA-1 colour-compliance issue. Signed remediation continues to append repairs to preserve signatures. No extra frontend setting is needed for those fixes.

### Gotenberg 9.8 Markdown extraction

On **Gotenberg 9.8+**, **Extract PDF text** can return **Markdown (.md)** as well as the previous plain-text `.txt`. Markdown extraction reconstructs headings, paragraphs, lists, tables, emphasis, code and links from a tagged PDF's structure tree (or estimates layout from untagged PDFs). In the PDF pipeline or the conversion-time PDF stage editor, use `{"op":"extract-text","format":"markdown"}` as the final stage. Chromium and LibreOffice automatically produce tagged PDFs when this extraction stage is requested. A standalone single-file extraction downloads `.md`, while a conversion followed by extraction returns a ZIP containing the generated PDF and Markdown. No OCR is performed. The option is rejected on versions before 9.8; leaving it unset retains `.txt` extraction on older servers.

Gotenberg 9.8 also publishes an [OpenAPI 3.1 description](https://gotenberg.dev/openapi.yaml) for client generation and fixes another symbolic TrueType font remediation edge case. These require no frontend options.

### Gotenberg 9.7 per-document merge bookmarks

On **Gotenberg 9.7+**, **Merge PDFs** offers **Add a bookmark for each input PDF**. Each input becomes a top-level bookmark at its first page, with any existing bookmarks nested underneath. By default Gotenberg chooses the source PDF's title metadata, falling back to its filename. Select **Filename only** to label every local upload using its original filename without the extension, rather than Gotenui's internal upload-order prefix. **Custom document labels (JSON)** accepts an object mapping original filenames to desired headings, for example `{"report.pdf":"Annual report","annex.pdf":"Appendix"}`. For duplicate uploaded filenames, one entry labels all matching files. Remotes and archive entries can be labelled using the name Gotenberg sees.

The PDF pipeline editor and Chromium/LibreOffice conversion pipeline accept the upstream `merge` stage option `"fileBookmarks":{}`. To choose the source order, set `"fileBookmarks":{"label":["filename"]}` or provide an explicit `"labels"` map keyed by input filenames. The pipeline remaps labels against the document names at **each** merge stage, including after rotation, selection, optimization or an earlier merge. A `split` can produce a varying number of files, so automatic labels are not invented for unknown parts. For specific parts, a custom label such as `"report_0.pdf"` is remapped to its numbered upload name when the source is known. Filename-keyed labels are NFC-normalized to match Gotenberg, including when no upload renaming is necessary. When a pipeline filename overlaps another input's original-name alias, the actual filename at the current stage takes precedence. Standalone Merge PDFs labels still use original upload names. After a `compose` stage or an unnamed remote input, use the actual filenames present at that merge stage, or omit custom labels and let Gotenberg derive them. Earlier 9.x versions reject this option before forwarding to the backend.

### Gotenberg 9.6 digital-signature removal

Gotenberg **9.6+** refuses to rewrite a signed PDF unless you expressly allow the original digital signatures to be removed. Supported rewriting tools offer the advanced **Remove digital signatures when rewriting** switch. The PDF pipeline and conversion stages accept `"dropSignatures":true` on `merge`, `split`, `select`, `delete`, `insert`, `compose`, `flatten-form`, `flatten-transparency`, `convert-colors`, `redact`, `optimize`, `encrypt`, `decrypt` and `remediate`. Other operations, including incremental edits such as rotation or stamping, do not accept the flag. Unchecked preserves Gotenberg's refusal to rewrite a signed input. The option is rejected on servers older than 9.6.

**Warning:** This removes the cryptographic signatures permanently, even though their visible appearance stays on the pages. The result is not digitally signed or verifiably approved. Keep the original signed PDF if that evidence matters. The `signed` field in PDF Information reports presence, not validity.

Gotenberg 9.6 also adds `CHROMIUM_MAX_MEMORY` and `LIBREOFFICE_MAX_MEMORY` settings. These are backend-container resource limits, not PDF Print form fields. Gotenberg 9.7 improves enforcement during process lifecycles.

### Gotenberg 9.5 paper sizes and signature detection

Gotenberg **9.5 or newer** accepts **A0, A1 and A2** in **Named paper size** for Chromium PDF and Office conversion, **Compose PDF pages**, and the JSON `compose` pipeline stage. Older Gotenberg 9 servers retain their existing paper sizes; the three new presets are disabled in the form and rejected before sending either a conversion or pipeline request. Custom page dimensions remain available on older versions.

**PDF information** includes the `signed` field for each uploaded PDF on Gotenberg 9.5+. `true` means at least one digital signature is present; it does **not** mean the signature is valid or trusted. Earlier servers omit this property. The JSON response is displayed and downloaded unchanged.

### Gotenberg 9.4 stamp positioning

On Gotenberg **9.4 or newer**, **Stamp PDFs** and **Watermark PDFs** offer an optional **Anchor position** setting for text, image and PDF overlays. Choose **center**, **top-left**, **top**, **top-right**, **left**, **right**, **bottom-left**, **bottom** or **bottom-right**. Gotenberg places the stamp in that part of each page as the viewer sees it, accounting for page rotation, even when a document contains different page sizes and orientations.

With an anchor, **X** and **Y** are optional offsets in PDF points: positive X moves right and positive Y moves up. Leaving either blank defaults that offset to zero. Without an anchor, the existing absolute PDF-coordinate behaviour remains unchanged (48 points from the bottom-left when the coordinates are blank). The **PDF pipeline builder** and Chromium/Office conversion pipeline also accept an optional `"position":"center"` (or one of the other eight values) on `stamp-text`, `stamp-image` and `stamp-pdf` stages. Set their `x` and `y` to zero or omit them for exact anchor placement. Earlier Gotenberg 9 servers continue to accept unanchored stamps, but reject anchored requests before submission.

### Gotenberg 9.3 server-side PDF limits

Gotenberg 9.3 adds two **server settings**, not conversion form fields:

- `PDF_MAX_RENDER_PIXELS` limits the number of pixels a PDF page may render (the default is 50 million; `0` uses Gotenberg's default). If **Render PDF pages** or a pipeline `render` stage exceeds the instance's limit, reduce the DPI. A Gotenberg administrator can change the limit based on available memory; rendered images may need about 16 bytes per pixel while being processed. `flatten-transparency` automatically reduces its rendering resolution to fit the limit.
- `PDF_DISABLE_STAGES=true` causes Chromium and LibreOffice **PDF conversions** to reject the `stages` field (including built-in merge/split and automatic PDF/A remediation). Remove the PDF processing settings to make a plain conversion, or ask an administrator to re-enable stages. PDF tools such as **Merge PDFs** still work unless the separate `PDF_DISABLE_ROUTES=true` setting also disables the PDF endpoints.

Gotenui preserves the HTTP error and displays specific advice when these limits are hit. The selected Gotenberg server does not advertise these flags through `/version` or `/health`, so the UI cannot determine their settings in advance. Set these variables on the **Gotenberg server/container**, not on Gotenui.

Before sending uploaded ZIP archives on Gotenberg 9, Gotenui reads only the bounded ZIP directory: PDF pipeline ZIPs must contain source PDFs and any **exactly referenced** stage assets; Office ZIPs must contain supported Office inputs and any exactly referenced conversion-stage assets (unless source documents are provided separately). It ignores macOS `__MACOSX` and `._` metadata, directory entries and symlinks as the upstream extractor does, normalises names to prevent collisions, and rejects unrelated or duplicate filenames that would shadow local uploads or generated HTML/Markdown files. ZIP64 directories are supported. Archives with encrypted entries, more than 10,000 entries or an index over 64 MiB must be repackaged or uploaded as individual files. Gotenui does not inspect the documents inside the ZIP; Gotenberg remains responsible for safe extraction and content validation.

## Results and presets

Completed operations download automatically. PDFs and supported raster images (PNG, JPEG and WebP) can also be previewed in the browser. Extracted attachments retain their original bytes and filenames, including empty files. A binary preview is available only when the attachment has a matching file signature, which does not establish that the entire file is valid or safe. Direct and completed batch ZIP downloads offer an optional **View archive contents** control; it lists a bounded number of filenames and declared sizes without unpacking the archive. **Clear** releases the current result from the tab.

Gotenberg 9 PDF validation reports are summarised only when their JSON is readable and at most 128 KB; the full downloaded report remains available otherwise. Non-compliant findings, invalid reports, and incomplete remediation diagnostic headers are shown as **Review required**, not as proof of successful conformance. Always validate the downloaded PDF when conformance matters. For timestamp stages, enter an absolute HTTP(S) timestamp authority URL without credentials, fragments, whitespace or backslashes. Gotenberg's network restrictions still govern where it can connect.

**Saved presets** store reusable operation settings in this browser, including valid signed numeric values. They do not store uploaded files, passwords, tokens, destructive redaction acknowledgements or callback details. Explicitly cleared optional settings remain cleared when restored. Presets are available only for the tool on which they were saved.

## Batch queue

Select **Add to batch** to collect configured operations, then start the queue from its panel. Up to two operations run at once. Once started, the queue **stays active** and new jobs run automatically, even after you clear completed jobs. Choose **Pause new jobs** before adding work you want to hold for a later manual start. Pausing does not cancel jobs already running. You can also cancel requests and retry failures.

Batch results remain in the current tab until downloaded or cleared. They do not download automatically, and the queue is lost when the tab is closed or reloaded. Cancelling a request may not stop processing already underway in Gotenberg. Completed PNG, JPEG and WebP jobs offer an opt-in **Preview image** control. It uses the existing download Blob URL without storing a second image; the image is only loaded after you open the preview. Closing the preview unmounts the image, and clearing the job revokes the download URL. SVG and other file types are not shown as batch image previews.

## Remote files and webhooks

The advanced inputs support fetching remote files and delivering conversion results to a webhook.

Remote files are downloaded by **Gotenberg**, not by your browser. The Gotenberg instance must permit the remote destination. Gotenberg 9.2+ accepts a downloaded filename override and otherwise uses the response's Content-Disposition filename or a filename with an extension from the URL. Earlier versions require the response's Content-Disposition filename. On older 9.x connections, an expected filename is only a preflight hint. Switching to an older connection with an explicit override blocks the draft until you clear it or explicitly choose **Use as expected filename instead**. Existing API clients using the legacy `name` hint keep their original behaviour.

Gotenui pins predictable remote filenames on Gotenberg 9.2+ when Chromium uploads, archives or conversion stages need stable resource names. It also pins downloads preceding an explicitly named remote Chromium resource, so an unpredictable Content-Disposition filename cannot displace that resource. Provide an explicit filename for any such download whose URL has no usable filename. Remote-only requests without protected names can still use server-resolved filenames.

Webhook requests may return **Accepted** before the conversion finishes. Gotenui does not receive webhook callbacks or maintain a job history. Check the destination service for delivery results. In Gotenberg 9, PDF inspection tools return JSON immediately and do **not** support webhooks; their advanced form hides that option and blocks a configured v8-specific webhook draft until you switch back or discard it. Other v9 webhook operations still require an events callback URL. On a healthy v8 or v9 connection, Gotenui selects the matching API automatically without a generic migration warning; unsupported settings and versions are explained only where relevant.

The proxy forwards callback URLs without normalising their path or query, preserving signed URLs. Percent-encode trailing spaces in callback URLs because HTTP headers strip trailing ASCII whitespace.

## Diagnostics

Use **Diagnostics** to check connectivity and, when available, read debug information or Prometheus-compatible metrics. These endpoints depend on your Gotenberg deployment and its access settings.

### Backend compatibility and HTTP status checks

Switching connections preserves the current tool draft, including source files and settings, while cancelling its in-flight request and clearing the previous connection's result. Existing batch jobs retain their original connection and verified API version. If the backend changes to another major or minor release before processing, the proxy refuses the request without forwarding the conversion. Refresh the connection and review the draft before running again or replacing the queued job. Patch updates within the same API minor version remain compatible. Until the current connection reports a supported version, the last confirmed layout is retained and run, queue and discard actions are paused. Confirm that retained documents, passwords, cookies, authentication headers and callback settings may be sent to the new connection before running, reading PDF structure or queuing the draft. If an option cannot be used by the new backend, running or queuing is blocked until you switch back or choose **Discard incompatible settings**. Remote file, webhook and Advanced JSON conflicts are shown separately so you can edit them without losing unrelated settings. Legacy v8 PDF post-processing is not automatically translated into v9 pipeline stages. Choose either raw `nativePdfa`/`nativePdfua` in Advanced JSON or the Office PDF conformance controls to avoid competing profile requests.

In Chromium's **Rendering & error checks** section, leave a status-code field blank to use the server default, or choose **Disable checks** to send an empty JSON array (`[]`). Enter comma-separated codes to check specific HTTP responses. Gotenberg defaults the main-page checks to all 4xx and 5xx responses. Screenshot viewport defaults are 800 × 600 pixels, with PNG output, pixel density 1 and JPEG quality 100 unless overridden. Screenshot tools on both majors also support print or screen media rendering. Chromium media features are sent as JSON objects on both majors, with legacy Advanced JSON name/value arrays normalised automatically.
