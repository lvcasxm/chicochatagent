# ChicoChat+ — imagem única: a API serve a interface na mesma origem (ADR-041).
# Nenhum segredo entra na imagem: tudo vem do ambiente na hora de executar (ADR-042).
# syntax=docker/dockerfile:1

# --- Construção da interface -------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN NODE_ENV=production npm run build -w @chicochat/web

# --- Execução ------------------------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist

# Usuário sem privilégios (o `node` já existe na imagem). A API só escreve no banco e em /tmp.
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node` como processo principal (sem `npm` no meio) para o SIGTERM chegar à API.
CMD ["node_modules/.bin/tsx", "apps/api/src/server.ts"]
