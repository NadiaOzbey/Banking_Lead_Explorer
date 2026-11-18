FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY backend ./backend
RUN npm run build:api && cp -r backend/migrations dist/api/migrations && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/api ./dist/api
USER node
EXPOSE 3000
CMD ["node", "dist/api/server.js"]
