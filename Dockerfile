FROM node:22-alpine
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries (incl. Alpine/musl), so no compiler toolchain is needed.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
  && node -e "new (require('better-sqlite3'))(':memory:')"
COPY server ./server
COPY public ./public
COPY templates ./templates
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
