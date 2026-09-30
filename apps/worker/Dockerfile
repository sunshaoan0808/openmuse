# patchright 是 Playwright 的防检测分支，版本号与 Playwright 对齐：
# 基础镜像必须用同一版本，否则镜像里的 Chromium revision 与 patchright 期望的不一致。
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown pwuser:pwuser /data /app
COPY --chown=pwuser:pwuser src ./src
USER pwuser
ENV NODE_ENV=production WORKER_DATA_DIR=/data WORKER_HOST=0.0.0.0
EXPOSE 8790
CMD ["node", "--experimental-strip-types", "src/index.ts"]
