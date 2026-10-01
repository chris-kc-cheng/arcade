# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY . .
CMD ["npm", "run", "dev"]

FROM dependencies AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.js"]
