# Host-agnostic: works anywhere that takes a Dockerfile and can mount a volume
# (Fly.io, Railway, Render). The one hard requirement is a PERSISTENT DISK for
# the cache. The sync writes match and timeline JSON to disk, so a platform with
# an ephemeral filesystem re-fetches everything on every cold start and burns
# the Riot rate limit for nothing.

FROM node:20-alpine

WORKDIR /app

# tsx runs the TypeScript server directly, so devDependencies are needed at
# runtime too. Not the leanest image, but it keeps one source of truth.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
# point at the mounted volume, not the image's own filesystem
ENV WINCON_DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

# RIOT_API_KEY is supplied as a platform secret, never baked into the image
CMD ["npm", "run", "start"]
