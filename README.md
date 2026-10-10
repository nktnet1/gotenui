# Gotenui

A **fully static** Gotenberg document workbench built with TanStack Start (SPA mode), React 19, TypeScript 7, Tailwind CSS 4, shadcn-style UI components, Valibot, url-join, Biome and Sonner. No Gotenui server, database, authentication API, or Gotenui runtime environment variables are required.

## Features

- **22 Gotenberg operations**, covering Chromium URL/HTML/Markdown conversions and screenshots, LibreOffice conversions, and PDF-engine tools.
- Browser-managed uploads, merge ordering, HTML and Markdown editors, format and layout options, advanced Gotenberg fields, downloads, and previews for images and JSON.
- **Configurable Gotenberg base URL**, via the first-run connection screen and **Settings → Connection settings** at any time. Test the connection before or after saving.
- The URL is stored per browser and site origin in `localStorage` under `gotenui.backend-url.v1`. Nothing needs rebuilding when the URL changes. Inputs and generated files are **not** stored in localStorage.
- Health and version checks, file validation, error messages, cancellation and a three-minute client-side request timeout.

## Development

Requires Node.js **24+** and a browser-reachable Gotenberg 8.x service.

```sh
pnpm install
pnpm dev
```

Visit `http://localhost:3100`. On first launch, enter `http://localhost:3000` for a Gotenberg instance accessible to **your browser**, or `/gotenberg` when you have configured the optional same-origin proxy shown below. Changing the address takes effect immediately and survives reloads. Optionally set `VITE_GOTENBERG_DEFAULT_URL` at **build time** to prepopulate a first-run backend URL; it is validated with Valibot and exposed publicly in the built JavaScript, so do not put credentials or secrets in it.

Run `pnpm format`, `pnpm check`, `pnpm typecheck` and `pnpm test` after installing dependencies.

## Static production build

```sh
pnpm build
```

**Deploy the contents of `static/`** to any static file host, CDN, object storage, Nginx, Apache, etc. The build enables TanStack Start's `spa.enabled` mode and generates an `index.html` shell; the post-build script verifies and copies the static client assets into `static/`. The rest of TanStack's build output, when present, **is not required at runtime**. `pnpm preview` starts a tiny zero-dependency static-file server for local testing.

For Nginx, see `deploy/nginx.conf`. For Netlify, `public/_redirects` adds the index.html fallback. With a single UI route, the app doesn't require deep-link handling beyond normal SPA fallback.

The included `Dockerfile` uses a Node build stage **only at build time**; the running container is Nginx serving plain HTML, CSS and JavaScript. The optional `deploy/compose.example.yml` bundles a local Gotenberg container with that static site and is bound to `127.0.0.1` for local evaluation.

## Gotenberg connectivity, CORS and HTTPS

Since Gotenui has no backend, all requests (including document uploads) are sent by the **browser directly to Gotenberg**. Gotenberg generally does not enable cross-origin browser calls for you. For a Gotenberg server at another origin, configure CORS at the proxy in front of Gotenberg, including `Access-Control-Allow-Origin` for the **exact** Gotenui site origin, and appropriate `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` if preflight is used. To read filenames or the `Gotenberg-Trace` response header cross-origin, expose `Content-Disposition, Gotenberg-Trace`. Do **not** use wildcard allow-origin for an authenticated deployment.

**Recommended: a same-origin proxy.** Serve the static files at `https://documents.example.com`, proxy `https://documents.example.com/gotenberg/` to a Gotenberg server on a private network, and save `/gotenberg` in Connection settings. This avoids browser CORS restrictions entirely. The included Nginx config demonstrates the path mapping. It does **not** implement authentication: protect the UI and proxied Gotenberg API using your existing identity-aware proxy, private network/VPN, or equivalent.

`http://localhost:3000` in the browser means **the user's computer**, not the Docker host or CDN. If Gotenui is hosted over HTTPS, use HTTPS for the Gotenberg endpoint (or the same-origin proxy); browsers typically block mixed-content HTTP calls. Browsers may also enforce additional Private Network Access checks on requests to local IPs.

The client uses native `multipart/form-data` requests without custom request headers to reduce preflight requirements. Custom download filenames are applied **locally** when saving, not via the Gotenberg-Output-Filename header. Requests include cookies only for same-origin gateways; cross-origin requests do not include cookies or credentials.

## Security and privacy

A static application cannot keep a backend password or enforce access control. Gotenberg is a powerful document-rendering service and **must not be publicly exposed without an authentication gateway and network restrictions**. Protect it especially against SSRF through URL rendering and unauthorized access to local network resources. The UI's file/field validation only improves usability; callers can bypass any browser restriction by calling Gotenberg themselves.

The configured URL is **not a secret**. It is visible to everyone using this browser profile and site origin; do not place passwords, API keys or tokens in it. Files stay in browser memory until directly posted to Gotenberg; the UI keeps only a short in-memory activity list, and downloading files uses temporary browser object URLs. Depending on its deployment, Gotenberg or its gateways may log or cache requests: apply your own retention and privacy controls.

## API support

The UI covers the 22 operations described in the supplied Gotenberg 8.x API reference, including archive and accessible PDF conversion, metadata and bookmark JSON, image/PDF watermarks and stamps, attachments, and Factur-X. Chromium HTML/Markdown asset names are flat, and Markdown is wrapped with the required `index.html` template.

Uploads are capped at 100 MiB per conversion by the UI (the Gotenberg server or gateway may have stricter limits). For safety and simplicity, `downloadFrom`, webhook endpoints and arbitrary file overrides are not part of the advanced-fields editor. No generated code, node_modules, lockfiles or build artifacts are included in the ZIP.
