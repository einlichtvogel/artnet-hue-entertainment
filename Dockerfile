# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY custom_ts_declarations ./custom_ts_declarations
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node README.md LICENSE.txt ./
COPY --chown=node:node docs ./docs

RUN mkdir /data \
    && chown node:node /data

USER node

VOLUME ["/data"]
EXPOSE 6454/udp

ENTRYPOINT ["node", "build/cli.js"]
CMD ["run", "--config", "/data/config.json"]
