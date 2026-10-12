# Gotenui

A web interface for [Gotenberg](https://gotenberg.dev/). Convert documents, capture web pages and work with PDFs without making API requests yourself.

## What you can do

- Convert websites, HTML, Markdown and Office files to PDF.
- Capture website, HTML and Markdown screenshots.
- Merge, split, optimize, rotate, flatten and encrypt PDFs.
- Manage watermarks, stamps, attachments, bookmarks and metadata.
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

Gotenui is designed for Gotenberg 8.x.
