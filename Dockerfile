# Railway build. Same steps as the default Railpack build (npm install, next build, next start), but in
# /srv/nightshift instead of /app: built at /app, Next.js prerendered the home page (/) as a copy of the /app page,
# so the landing page (engine scene) never shipped. Every Railway build since 21 Nov showed / and /app at the same size.
FROM node:22-bookworm-slim
WORKDIR /srv/nightshift
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["npm", "run", "start"]
