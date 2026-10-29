# Factura agent. Runs anywhere Docker runs (Render, Railway, Fly.io, a VPS).
# State lives in Postgres when DATABASE_URL is set; otherwise mount a persistent volume at /data.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
EXPOSE 8402
CMD ["node", "--import", "tsx", "src/index.ts"]
