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

With **Gotenberg 9**, the PDF pipeline builder accepts individual PDFs, uploaded ZIP archives of PDF sources, and remote PDF URLs. You can mix these inputs, or use a ZIP/remote URL without uploading individual PDFs. ZIPs must be uploaded through **PDF ZIP archives** to be unpacked; ZIPs fetched through `downloadFrom` remain ordinary files. Gotenberg validates ZIP entries and enforces archive limits. Files referenced by pipeline stages (attachments, images, signing credentials, etc.) still require separate named uploads; the filename from a remote response cannot be used as a stage asset. Gotenberg 8's PDF tools and upload rules are unchanged.

For Gotenberg 9 **Office to PDF**, a requested PDF/A or PDF/UA profile uses native LibreOffice export only when no PDF processing follows. **Merge**, **Split**, and custom pipeline stages automatically move conformance to a final PDF remediation stage; selecting **Native LibreOffice export** alongside those stages reports an error. Use PDF validation to check actual conformance rather than relying on HTTP 200 or a successful native export.

Before sending uploaded ZIP archives on Gotenberg 9, Gotenui reads only the bounded ZIP directory: PDF pipeline ZIPs must contain PDF entries, Office ZIPs must contain supported Office input formats, and archive entries must not shadow other files or generated HTML/Markdown sources. For now, archives with an encrypted entry, a ZIP64 directory, more than 1,000 entries or an index over 512 KB must be repackaged or uploaded as individual files. Gotenui does not inspect the documents inside the ZIP; Gotenberg remains responsible for safe extraction and content validation.

## Results and presets

Completed operations download automatically. PDFs can also be previewed in the browser. **Clear** releases the current result from the tab.

**Saved presets** store reusable operation settings in this browser. They do not store uploaded files, passwords, tokens or callback details. Presets are available only for the tool on which they were saved.

## Batch queue

Select **Add to batch** to collect configured operations, then start the queue from its panel. Up to two operations run at once. You can pause waiting jobs, cancel requests and retry failures.

Batch results remain in the current tab until downloaded or cleared. They do not download automatically, and the queue is lost when the tab is closed or reloaded. Cancelling a request may not stop processing already underway in Gotenberg.

## Remote files and webhooks

The advanced inputs support fetching remote files and delivering conversion results to a webhook.

Remote files are downloaded by **Gotenberg**, not by your browser. The remote response needs a valid `Content-Type` and a `Content-Disposition` filename. The Gotenberg instance must permit the remote destination.

Webhook requests may return **Accepted** before the conversion finishes. Gotenui does not receive webhook callbacks or maintain a job history. Check the destination service for delivery results.

## Diagnostics

Use **Diagnostics** to check connectivity and, when available, read debug information or Prometheus-compatible metrics. These endpoints depend on your Gotenberg deployment and its access settings.
