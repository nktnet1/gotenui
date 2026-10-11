FROM node:24-alpine AS build
WORKDIR /app
# Use the same package manager and lockfile as CI and local builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
# Vite/TanStack Start embeds PUBLIC_ values in the browser build.
# Pass them as build arguments; runtime environment changes cannot rewrite assets.
ARG PUBLIC_GOTENBERG_DEFAULT_URL=https://demo.gotenberg.dev
ARG PUBLIC_GOTENUI_MAX_UPLOAD_BYTES=4000000
ENV PUBLIC_GOTENBERG_DEFAULT_URL=${PUBLIC_GOTENBERG_DEFAULT_URL} \
    PUBLIC_GOTENUI_MAX_UPLOAD_BYTES=${PUBLIC_GOTENUI_MAX_UPLOAD_BYTES}
RUN pnpm build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3100
CMD ["node", ".output/server/index.mjs"]
