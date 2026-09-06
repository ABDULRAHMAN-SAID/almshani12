# منصّة — صورة واحدة تشغّل الـ API والغرف المباشرة وتخدم تطبيق الويب ولوحة الإدارة من نفس العنوان.
# البناء: docker build -t manassah .   التشغيل: docker compose up -d   (أو انشرها على Render / Fly / Railway)
FROM node:22-bookworm-slim

# better-sqlite3 يحتاج أدوات بناء أصلية
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
COPY packages/tokens/package.json packages/tokens/
RUN npm ci --legacy-peer-deps

COPY . .
# لوحة الإدارة (/admin) وتطبيق الويب (الجذر) يُبنيان داخل الصورة
RUN npm run admin:build && npm run web:build

ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 DATA_DIR=/data TRUST_PROXY=true
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "-w", "apps/api"]
