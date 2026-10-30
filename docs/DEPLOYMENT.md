# Deployment

Gotenui needs a running Gotenberg 8.x instance and a server runtime for its same-origin API proxy. The UI alone cannot make conversions.

Gotenberg **8.39.0+** is recommended for the latest conversion controls and security fixes. PDF/A-4 and Chromium console-message checks require 8.39, while LibreOffice tagged PDF export requires 8.38. The example Compose configuration pins 8.39.0 for reproducibility; update the image tag as security releases arrive.

### Securing untrusted conversions

Gotenberg 8.32+ does **not** deny private-IP outbound requests by default. If users can submit untrusted URLs, HTML, remote files, documents or webhook destinations, configure the Gotenberg container with `--chromium-deny-private-ips`, `--libreoffice-deny-private-ips`, `--api-download-from-deny-private-ips` and `--webhook-deny-private-ips` as appropriate. Check any configured allow-list patterns: matching entries bypass the private-IP checks. Internal network access may need a deliberately scoped exception.

Gotenberg 8.38 isolates Chromium cookies and storage between conversions by default. Do not enable `--chromium-shared-browser-context` on a multi-user instance; that flag restores the previous shared-session behaviour. The Gotenui proxy does not replace the backend's outbound-network policy or security updates.

Gotenberg 8.39 fixes an ExifTool metadata-writing vulnerability. Gotenui rejects known ExifTool option aliases and filesystem pseudo-tags in its metadata editors, but **upgrading Gotenberg is still required** to obtain the full backend fix. Since 8.38, Gotenberg's `--api-body-limit` counts multipart headers and boundaries too, so allow some headroom beyond the maximum file size.

## Docker Compose

From the repository root:

```sh
docker compose -f deploy/compose.example.yml up --build
```

Open <http://localhost:3100>. The example starts Gotenui and Gotenberg. It binds Gotenui to localhost and leaves the public demo as the initial browser connection.

To select the local container by default, set these values **before building**:

```dotenv
PUBLIC_GOTENBERG_DEFAULT_URL=http://gotenberg:3000
GOTENBERG_ALLOWED_URLS=https://demo.gotenberg.dev,http://gotenberg:3000
```

Gotenui sends requests through its server-side proxy. The browser does not need to resolve the Docker hostname, but the URL must be reachable from the Gotenui container and included in the allowlist.

## Node and hosted deployments

Node.js 24 and pnpm 12 are required.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Set `PORT=3100` to serve the Node app at `http://localhost:3100`. Keep runtime environment variables on your host, not in committed source files.

Vercel and other Nitro-compatible platforms must deploy both the UI and the `/api/gotenberg/*` routes. The repository includes `vercel.json` for Vercel.

On Vercel, the sidebar shows `commit-` followed by the first seven characters of the Git commit SHA instead of the package version. Vite embeds Vercel's `VERCEL_GIT_COMMIT_SHA` into the browser bundle at build time, without broadening the app's `PUBLIC_` environment-variable policy. Enable **Automatically expose System Environment Variables** in Vercel's project settings if your project does not already expose them. Deployments without that Git metadata, and non-Vercel builds, continue showing the package version. The displayed revision updates on the next deployment, not at runtime.

## Environment variables

| Variable                          | Purpose                                               | Default                      |
| --------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `PUBLIC_GOTENBERG_DEFAULT_URL`    | Browser's initial Gotenberg URL                       | `https://demo.gotenberg.dev` |
| `PUBLIC_GOTENUI_MAX_UPLOAD_BYTES` | Browser upload limit in bytes                         | `4000000`                    |
| `GOTENBERG_ALLOWED_URLS`          | Comma-separated list of permitted upstream base URLs  | Public demo only             |
| `GOTENUI_BASIC_AUTH_USERNAME`     | Optional site-wide Basic Auth username                | Unset                        |
| `GOTENUI_BASIC_AUTH_PASSWORD`     | Optional site-wide Basic Auth password                | Unset                        |
| `GOTENUI_MAX_REQUEST_BYTES`       | Maximum complete request size in bytes                | `4200000`                    |
| `GOTENUI_MAX_RESPONSE_BYTES`      | Maximum streamed output size in bytes                 | `100000000`                  |
| `GOTENUI_SERVER_CONNECTIONS`      | Server-managed connection profiles as a JSON array    | Unset                        |
| `GOTENUI_PUBLIC_ORIGIN`           | Browser-visible origin behind a TLS-terminating proxy | Request origin               |
| `GOTENUI_SHOW_DEBUG`              | Show the debug action                                 | `true`                       |
| `GOTENUI_SHOW_METRICS`            | Show the metrics action                               | `true`                       |

The `PUBLIC_` variables are **build-time settings**. Supply them as Docker build arguments or Compose `build.args`, then rebuild to change them. They are visible to browsers and must not contain secrets. All other settings above are server runtime variables.

A custom browser default must also appear in `GOTENBERG_ALLOWED_URLS`. Only exact approved base URLs can be used.

The browser limit applies to uploaded files. The request limit applies to the complete multipart request, including overhead. Raise both for large uploads on hosts that support them. Hosting providers and Gotenberg may enforce their own limits.

See [`.env.example`](../.env.example) for configuration examples.

## Optional site login

Set both variables at runtime to enable browser-native Basic Auth for the UI routes and API:

```dotenv
GOTENUI_BASIC_AUTH_USERNAME=admin
GOTENUI_BASIC_AUTH_PASSWORD=replace-with-a-strong-password
```

Leave both unset to disable it. Incomplete configuration fails closed. Use HTTPS when exposing the app over a network. Public static assets may remain accessible without a login challenge. Site login is separate from credentials used to connect to Gotenberg.

## Upstream authentication

For one upstream protected by Basic Auth, configure all three variables on the Gotenui server:

```dotenv
GOTENBERG_ALLOWED_URLS=https://pdf.example.com
GOTENBERG_BASIC_AUTH_URL=https://pdf.example.com
GOTENBERG_BASIC_AUTH_USERNAME=service
GOTENBERG_BASIC_AUTH_PASSWORD=replace-with-a-secret
```

Alternatively, configure named connections using `GOTENUI_SERVER_CONNECTIONS`. Profiles support Basic Auth, bearer tokens and OAuth2 client credentials. For example:

```dotenv
GOTENBERG_ALLOWED_URLS=https://pdf.example.com
GOTENUI_SERVER_CONNECTIONS=[{"id":"main","name":"Main","url":"https://pdf.example.com","auth":{"type":"oauth2","tokenUrl":"https://login.example.com/oauth2/token","clientId":"gotenui","clientSecret":"replace-with-a-secret"}}]
```

OAuth2 service tokens are acquired and renewed server-side. This is not interactive user sign-in. Anyone who can use a managed profile can act with its configured upstream permissions, so enable site authentication when appropriate.

## Diagnostics and reverse proxies

To read metrics from a separate OpenTelemetry Prometheus exporter, add `metricsUrl` and optional `metricsAuth` to a server-managed profile. The exporter URL must end in `/metrics`. Gotenui does not send Gotenberg conversion credentials to that exporter. For a separate Gotenberg container, the exporter must bind to a network interface accessible to Gotenui. Refer to [Gotenberg telemetry](https://gotenberg.dev/docs/telemetry) for exporter setup.

`GOTENUI_SHOW_DEBUG` and `GOTENUI_SHOW_METRICS` only hide actions in the UI. They do not block the corresponding API routes. Gotenberg remains responsible for access to its diagnostics endpoints.

If a TLS-terminating reverse proxy makes Nitro see a different origin than the browser, set `GOTENUI_PUBLIC_ORIGIN` to the exact public origin, such as `https://pdf.example.com`. Leave it unset when the forwarded request already has the correct origin.
