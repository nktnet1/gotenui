# Using Gotenui

## Connections

Open **Connection settings** to select a Gotenberg instance. The public demo is the default unless your deployment provides another URL.

- **Browser connections** store the connection name, URL and authentication mode in your browser. Passwords and bearer tokens remain in tab memory and must be re-entered after refreshing.
- **Managed connections** are configured by the deployment administrator. You can select them without seeing the stored upstream credentials.

Your deployment must allow the selected Gotenberg URL. Adding a browser connection does not add it to the server's allowlist.

## Conversions and PDF tools

Choose a tool in the sidebar or open search with **Ctrl+K** or **Cmd+K**. Gotenui provides individual controls for supported Gotenberg settings, including Office exports, Chromium rendering, PDF attachments and post-processing.

- For multi-file merges, arrange local uploads in the order they should appear.
- For metadata and bookmarks, use **Read existing PDF values** to load values into the editor before writing them back.
- PDF conversions, merges and splits can apply watermarks, stamps, rotation, attachments, Factur-X, flattening and encryption in the same request. For Merge PDFs, use the existing metadata editor above the post-processing panel.
- Advanced JSON is available for unusual Gotenberg options. You don't need it for the settings exposed in the form.

Gotenberg can return a PDF or a ZIP archive depending on the operation and number of outputs. Gotenui downloads the format actually returned.

With **Gotenberg 9**, the PDF pipeline builder accepts individual PDFs, uploaded ZIP archives of PDF sources, and remote PDF URLs. All Gotenberg 9 PDF tools accept ZIP inputs containing PDF sources; additional ZIP uploads can accompany any Gotenberg 9 conversion route. You can mix these inputs, or use a ZIP/remote URL without uploading individual PDFs. ZIPs must be uploaded through **PDF ZIP archives** to be unpacked; ZIPs fetched through `downloadFrom` remain ordinary files. Named pipeline assets (attachments, images, signing credentials, etc.) can be separate uploads **or entries in an uploaded ZIP**, referenced by their exact filename in the stage editor. Asset-only ZIPs still need a separate source PDF or a remote PDF input. A remote download's filename cannot be used as a stage asset. Gotenberg validates ZIP contents and enforces extraction limits; Gotenberg 8's tools and upload rules are unchanged.

With **Gotenberg 9.1 or later**, **Extract PDF text** produces a `.txt` file for one document or a ZIP for multiple files. Select pages using one-based ranges (such as `1-3,5` or `odd`); optional switches include invisible text, page artifacts and annotation text. This is PDF text extraction, **not OCR**: scanned images can yield an empty text file. **Extract PDF attachments** downloads embedded files with their original contents and extensions; supply an exact embedded filename to select one, or omit it to extract everything (multiple outputs produce a ZIP). Attachments can be binary or zero bytes long, and international filenames are preserved. Both operations are also terminal options in the PDF pipeline and in Chromium/Office conversion stages. A pipeline that edits a PDF before extraction (or extracts from a generated PDF) returns a ZIP containing the PDF alongside the extracted file(s). Gotenberg 9.0 hides these stage choices and rejects 9.1-only operations rather than attempting an unsupported route.

For Gotenberg 9 **Office to PDF**, a requested PDF/A or PDF/UA profile uses native LibreOffice export only when no PDF processing follows. **Merge**, **Split**, and custom pipeline stages automatically move conformance to a final PDF remediation stage; selecting **Native LibreOffice export** alongside those stages reports an error. Use PDF validation to check actual conformance rather than relying on HTTP 200 or a successful native export.

Before sending uploaded ZIP archives on Gotenberg 9, Gotenui reads only the bounded ZIP directory: PDF pipeline ZIPs must contain source PDFs and any **exactly referenced** stage assets; Office ZIPs must contain supported Office inputs and any exactly referenced conversion-stage assets (unless source documents are provided separately). It ignores macOS `__MACOSX` and `._` metadata, directory entries and symlinks as the upstream extractor does, normalises names to prevent collisions, and rejects unrelated or duplicate filenames that would shadow local uploads or generated HTML/Markdown files. For now, archives with encrypted entries, a ZIP64 directory, more than 1,000 entries or an index over 512 KB must be repackaged or uploaded as individual files. Gotenui does not inspect the documents inside the ZIP; Gotenberg remains responsible for safe extraction and content validation.

## Results and presets

Completed operations download automatically. PDFs and raster images can also be previewed in the browser. Direct and completed batch ZIP downloads offer an optional **View archive contents** control; it lists a bounded number of filenames and declared sizes without unpacking the archive. **Clear** releases the current result from the tab.

Gotenberg 9 PDF validation reports are summarised only when their JSON is readable and at most 128 KB; the full downloaded report remains available otherwise. Non-compliant findings, invalid reports, and incomplete remediation diagnostic headers are shown as **Review required**, not as proof of successful conformance. Always validate the downloaded PDF when conformance matters. For timestamp stages, enter an absolute HTTP(S) timestamp authority URL without credentials, fragments, whitespace or backslashes. Gotenberg's network restrictions still govern where it can connect.

**Saved presets** store reusable operation settings in this browser. They do not store uploaded files, passwords, tokens or callback details. Presets are available only for the tool on which they were saved.

## Batch queue

Select **Add to batch** to collect configured operations, then start the queue from its panel. Up to two operations run at once. Once started, the queue **stays active** and new jobs run automatically, even after you clear completed jobs. Choose **Pause new jobs** before adding work you want to hold for a later manual start. Pausing does not cancel jobs already running. You can also cancel requests and retry failures.

Batch results remain in the current tab until downloaded or cleared. They do not download automatically, and the queue is lost when the tab is closed or reloaded. Cancelling a request may not stop processing already underway in Gotenberg. Completed PNG, JPEG and WebP jobs offer an opt-in **Preview image** control. It uses the existing download Blob URL without storing a second image; the image is only loaded after you open the preview. Closing the preview unmounts the image, and clearing the job revokes the download URL. SVG and other file types are not shown as batch image previews.

## Remote files and webhooks

The advanced inputs support fetching remote files and delivering conversion results to a webhook.

Remote files are downloaded by **Gotenberg**, not by your browser. The remote response needs a valid `Content-Type` and a `Content-Disposition` filename. The Gotenberg instance must permit the remote destination.

Webhook requests may return **Accepted** before the conversion finishes. Gotenui does not receive webhook callbacks or maintain a job history. Check the destination service for delivery results. In Gotenberg 9, PDF inspection tools return JSON immediately and do **not** support webhooks; their advanced form hides that option and keeps any v8-specific webhook draft out of v9 requests. Other v9 webhook operations still require an events callback URL. On a healthy v8 or v9 connection, Gotenui selects the matching API automatically without a generic migration warning; unsupported settings and versions are explained only where relevant.

## Diagnostics

Use **Diagnostics** to check connectivity and, when available, read debug information or Prometheus-compatible metrics. These endpoints depend on your Gotenberg deployment and its access settings.
