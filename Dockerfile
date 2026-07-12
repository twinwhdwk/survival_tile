FROM node:16-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects PORT (defaults to 8080) and server.js honors it. Setting it
# here too keeps the container self-consistent with EXPOSE and makes a plain
# `docker run` land on 8080 instead of a random port.
ENV PORT=8080
COPY package.json package-lock.json ./
# Runtime only needs production deps: webpack.server.config.js uses
# webpack-node-externals, so node_modules is NOT bundled into
# dist/server.bundle.js and must exist at runtime. All of server.js/Room.js's
# npm imports (express, helmet, compression, socket.io) live in "dependencies",
# so --omit=dev installs exactly what's required.
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
EXPOSE 8080
CMD ["node", "dist/server.bundle.js"]
