# النشر على خادم خاص (VPS) بأمر واحد — HTTPS تلقائي

هذا المجلّد يشغّل المنصّة كاملة (الـ API، الغرف المباشرة، تطبيق الويب من `/`، لوحة الإدارة من `/admin`) خلف **Caddy** الذي يصدر شهادة HTTPS تلقائياً من Let's Encrypt.
يكفي خادم Ubuntu صغير (1 vCPU / 1 GB) ونطاق يشير إليه.

## 1) الخادم
```bash
# Ubuntu 22.04/24.04 — ثبّت Docker (يشمل docker compose)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
git clone <رابط-المستودع> manassah && cd manassah
```

## 2) النطاق (DNS)
في لوحة مزوّد النطاق أضف سجلّ **A** باسم `app` (أو `@`) يشير إلى عنوان IP الخادم. انتظر حتى يعمل `ping app.example.om`.
افتح المنفذين **80** و**443** في جدار الحماية (`sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp`) — Caddy يحتاجهما لإصدار الشهادة.

## 3) ملف البيئة
```bash
cp apps/api/.env.production.example .env
nano .env
```
الحدّ الأدنى للإنتاج الحقيقي:
| المتغيّر | القيمة |
| --- | --- |
| `PUBLIC_URL` | `https://app.example.om` (نفس النطاق) |
| `ALLOW_DEMO_SEED=0` + `ADMIN_PHONE=9xxxxxxx` | بلا بيانات عرض؛ رقمك يصبح **المدير الأوّل** عند أول تشغيل |
| `OTP_FIXED_CODE=none` بعد ربط مزوّد رموز | راجع «رموز تحقّق حقيقية» في README الجذر |
| `CORS_ORIGINS=https://app.example.om` | حدّد النطاقات المسموحة |
كل مفاتيح الخدمات (ثواني، Google/Apple، LiveKit، TURN، Sentry، …) اختيارية وموثّقة في الملف نفسه وفي README الجذر «ربط الخدمات».

## 4) التشغيل
```bash
DOMAIN=app.example.om docker compose -f deploy/docker-compose.prod.yml up -d
```
- أول بناء يستغرق دقائق (يبني لوحة الإدارة وتطبيق الويب داخل الصورة).
- تحقّق: `curl https://app.example.om/api/health` ثم افتح `https://app.example.om` و`/admin`.
- الدخول برقمك (`ADMIN_PHONE`) ← لوحة الإدارة ← **الربط والخدمات** لرؤية حالة كل خدمة والضغط على «فحص الاتصال الآن».
- بديل عن البناء على الخادم: اسحب الصورة الجاهزة التي يبنيها `.github/workflows/deploy.yml`:
  `docker pull ghcr.io/<owner>/<repo>:latest && docker tag ghcr.io/<owner>/<repo>:latest manassah:latest` ثم الأمر نفسه أعلاه.

## 5) التحديث
```bash
git pull
DOMAIN=app.example.om docker compose -f deploy/docker-compose.prod.yml up -d --build
```

## 6) البيانات والنسخ الاحتياطية
- كل شيء في الـ volume `manassah-data` (داخل الحاوية `/data`): قاعدة البيانات `manassah.db`، الملفات `storage/`، الأسرار المولَّدة (`.jwt_secret`، `.vapid.json`)، والنسخ الاحتياطية `backups/manassah-YYYYMMDD-HHMMSS.db`.
- النسخ الاحتياطية تلقائية كل `BACKUP_EVERY_HOURS` (٢٤) ساعة ويُحتفظ بآخر `BACKUP_KEEP` (٧) — أو فوراً من لوحة الإدارة ← الربط والخدمات ← «نسخة احتياطية الآن».
- نسخ المجلّد إلى خارج الخادم:
```bash
docker run --rm -v manassah-data:/data -v "$PWD":/out alpine tar czf /out/manassah-data.tgz -C /data .
```
- الاستعادة: أوقف الحاويات، فكّ الأرشيف داخل الـ volume بنفس الطريقة، ثم `up -d`.

## 7) السجلّات والأعطال
```bash
docker compose -f deploy/docker-compose.prod.yml logs -f manassah   # سجلّ التطبيق
docker compose -f deploy/docker-compose.prod.yml logs -f caddy      # الشهادة/الوكيل
```
اضبط `SENTRY_DSN` لتصلك الأخطاء (≥ 500) إلى Sentry تلقائياً.
