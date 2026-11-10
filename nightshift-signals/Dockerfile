# One image for both backend services (api and worker); each Railway service picks its start
# command from its own config file (railway.api.json / railway.worker.json).
# Build context: this directory (nightshift-signals/).
FROM node:22-slim

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

RUN npm install -g pnpm@11.8.0

WORKDIR /app

# Sources are TypeScript run through tsx (no build step), so the whole workspace source is copied.
COPY . .

# Only what the api and worker need (plus the root for tsx); skips the web and mobile apps.
# NODE_ENV=production would drop devDependencies, and tsx is one, so install with dev deps.
RUN pnpm install --frozen-lockfile --prod=false \
      --filter nightshift-signals \
      --filter "@nightshift-signals/api..." \
      --filter "@nightshift-signals/worker..."

EXPOSE 8787

# Default: the API. The worker service overrides this with its start command.
CMD ["pnpm", "--filter", "@nightshift-signals/api", "start"]
