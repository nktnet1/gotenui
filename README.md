# Gotenui

A web interface for [Gotenberg](https://gotenberg.dev/). Convert documents, capture web pages and work with PDFs without making API requests yourself.

## What you can do

- Convert websites, HTML, Markdown and Office files to PDF.
- Capture website, HTML and Markdown screenshots.
- Merge, split, optimise, rotate, flatten and encrypt PDFs.
- Manage watermarks, stamps, attachments, bookmarks and metadata; extract embedded files and page text with Gotenberg 9.1+.
- Create PDF/A and PDF/UA documents and Factur-X invoices.
- Save reusable settings and run a batch of operations in your browser.

## Getting started

1. Open your Gotenui deployment.
2. Choose a tool from the sidebar or press **Ctrl+K** (or **Cmd+K** on macOS) to search.
3. Enter a URL, paste content or upload files, depending on the tool.
4. Adjust the options and select **Run operation**.
5. Download the result or preview it in your browser.

The public Gotenberg demo is selected by default. Use **Connection settings** to select another instance if your deployment allows it.

Gotenui doesn't keep uploaded documents or completed conversions on its server. Files are sent to the selected Gotenberg instance for processing. Avoid sending confidential documents to a public demo.

## Documentation

- [Using Gotenui](docs/USAGE.md) — connections, batch processing and advanced tools
- [Deployment](docs/DEPLOYMENT.md) — self-hosting, environment variables and authentication
- [Development](docs/DEVELOPMENT.md) — local setup, architecture and tests

Gotenui supports Gotenberg 8.x and major version 9. All 28 Gotenberg 9.1 PDF pipeline operations are available in the ordered editor, including standalone PDF text/attachment extraction. ZIP inputs are supported on Gotenberg 9 conversion routes, and embedded attachments retain their extension and Unicode name. Gotenui checks the selected instance's authenticated `/version` for major-version compatibility; Gotenberg does not expose a dedicated capabilities endpoint, so it cannot pre-disable individual 9.1 additions on an older 9.x server. Use the latest Gotenberg 9 release for full coverage; unavailable extraction routes produce a clear upstream error. See the [compatibility roadmap](docs/ROADMAP.md) for route coverage, legacy differences, and test status.
