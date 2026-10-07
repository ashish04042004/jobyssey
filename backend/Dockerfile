# One image, two entrypoints: `node src/server.js` (API) and `node src/worker.js`.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY prisma ./prisma
COPY prisma.config.js ./
RUN npx prisma generate

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
