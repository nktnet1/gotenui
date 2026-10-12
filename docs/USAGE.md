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
- PDF conversions can apply watermarks, stamps, attachments and other post-processing in the same request.
- Advanced JSON is available for unusual Gotenberg options. You don't need it for the settings exposed in the form.

Gotenberg can return a PDF or a ZIP archive depending on the operation and number of outputs. Gotenui downloads the format actually returned.

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
