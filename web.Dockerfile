FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY frontend ./frontend
RUN npm run build:web

FROM caddy:2-alpine
COPY --from=build /app/dist/web /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
