# ---------- 构建 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- 运行 ----------
FROM node:22-bookworm-slim
# ffmpeg：合成整条视频；fonts-noto-cjk：字幕中文字体；tini：正确转发信号
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Shanghai PORT=5173 DATA_DIR=/data WEB_DIR=/app/dist/web
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY deploy/backup.mjs ./deploy/backup.mjs
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server.js"]
