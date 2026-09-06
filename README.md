# منصّة — منصّة تعليم عُمانية (Android · iOS · Web)

منصّة واحدة متكاملة للطالب العُماني: **ملخّصات وكتب المنهج** (قراءة محمية داخل التطبيق)، **حصص مباشرة مدفوعة مع معلّمين معتمدين** (حجز بتقويم المعلّم، قاعة مباشرة، حضور مسجَّل)، و**دورات مسجّلة** مع اختبارات و«راجع نقاط ضعفك» — كلّها مرتبطة بالطالب نفسه وصفّه وموادّه.

> الاسم والشعار والألوان تُغيَّر من مكان واحد: `packages/shared/src/brand.ts` و`packages/tokens/src/index.ts`.

## ربط الخدمات (الدليل الكامل)

كل خدمة أدناه **اختيارية**: بلا مفاتيح تعمل المنصّة كما هي (رمز ثابت، بطاقة تجريبية، قاعة داخلية). ضع مفاتيح خدمة واحدة فتعمل تلك الخدمة وحدها.
**كيف تتأكد:** لوحة الإدارة ← **الربط والخدمات** (`/admin` ← `/system`) تعرض حالة كل عنصر (جاهز / ناقص / غير مفعّل) مع المتغيّرات الناقصة وزر **فحص الاتصال الآن** يجرّب الاتصال الحقيقي بكل خدمة؛ أو من الطرفية `npm run doctor -w apps/api` (نفس الفحص، سطر لكل عنصر؛ `-- --strict` يعيد رمز خروج 1 إن فشل عنصر جاهز). الخادم التجريبي الحيّ (Actions ← live-server) يشغّل الطبيب تلقائياً ويضع النتيجة في التعليق والملخّص.

| الخدمة | ماذا تعطيك | أين تحصل على المفاتيح | المتغيّرات | كيف تتأكد |
| --- | --- | --- | --- | --- |
| [رموز التحقّق](#رموز-تحقق-حقيقية) | دخول حقيقي برمز SMS / واتساب / بريد | Twilio · Gmail/SMTP · Resend · بوابة محلية | `TWILIO_*` `SMTP_*` `RESEND_API_KEY` `SMS_HTTP_*` | الربط والخدمات ← الدخول |
| [ثواني](#ثواني) | دفع ببطاقات عُمانية (UAT ثم live) | thawani.om ← بوابة التاجر | `THAWANI_SECRET_KEY` `THAWANI_PUBLISHABLE_KEY` `THAWANI_WEBHOOK_SECRET` `THAWANI_MODE` | الدفع ← ثواني (يظهر الوضع uat/live) |
| [Stripe](#stripe) | بطاقات دولية | dashboard.stripe.com ← Developers ← API keys | `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` | الدفع ← Stripe |
| [Google Sign-In](#google-sign-in) | زر «الدخول بحساب Google» (ويب + جوال) | console.cloud.google.com ← OAuth clients | `GOOGLE_CLIENT_IDS` | الدخول ← Google |
| [Apple Sign-In](#apple-sign-in) | زر «الدخول بحساب Apple» (ويب + iOS) | developer.apple.com ← Identifiers | `APPLE_CLIENT_IDS` `APPLE_SERVICES_ID` | الدخول ← Apple |
| [LiveKit](#livekit) | فيديو جماعي للجوال والحصص الكبيرة | cloud.livekit.io ← Settings ← Keys | `ROOM_PROVIDER=livekit` `LIVEKIT_URL` `LIVEKIT_API_KEY` `LIVEKIT_API_SECRET` | الغرف ← LiveKit |
| [TURN](#turn) | فيديو WebRTC يعمل عبر شبكات الجوال والجدران النارية | Twilio (نفس المفاتيح) · metered.ca · coturn خاص | `TURN_URL/USERNAME/CREDENTIAL` أو `METERED_API_KEY` `METERED_DOMAIN` أو مفاتيح Twilio | الغرف ← TURN |
| [Sentry](#sentry) | تنبيه فوري بأخطاء الخادم | sentry.io ← Project ← Client Keys | `SENTRY_DSN` `SENTRY_TRACES` | المراقبة ← Sentry |
| [Web Push](#web-push) | إشعارات المتصفح (تُولَّد المفاتيح تلقائياً) | لا شيء — أو ثبّت مفاتيحك | `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | الإشعارات ← المتصفح |
| [Expo Push](#expo-push) | إشعارات تطبيق Android/iOS | expo.dev ← EAS projectId (+ Access token اختياري) | `EXPO_ACCESS_TOKEN` + `extra.eas.projectId` في app.json | الإشعارات ← Expo |
| [البريد](#رموز-تحقق-حقيقية) | إيصالات الدفع وتأكيد الحجز واعتماد المعلّم | نفس مزوّد بريد الرموز | `MAIL_RECEIPTS` + `SMTP_*`/`RESEND_API_KEY` | البريد |
| [النسخ الاحتياطية](#النسخ-الاحتياطية) | نسخة تلقائية من قاعدة البيانات | لا شيء | `BACKUP_ENABLED` `BACKUP_KEEP` `BACKUP_EVERY_HOURS` | البيانات ← النسخ (زر «نسخة احتياطية الآن») |
| [النطاق وHTTPS](#النطاق-وhttps) | عنوان عام مشفّر بأمر واحد | نطاق + خادم Docker | `DOMAIN` `PUBLIC_URL` `CORS_ORIGINS` | الخادم ← العنوان العام |
| [صورة GHCR](#صورة-ghcr) / [Fly · Render](#fly--render-بنقرة) | نشر تلقائي من GitHub | أسرار `FLY_API_TOKEN` أو `RENDER_DEPLOY_HOOK_URL` | `GHCR_IMAGE` | Actions ← deploy |

**أين تضع القيم:** `apps/api/.env` محلياً · `.env` بجانب `docker-compose.yml` أو `deploy/` · لوحة Render (Environment) · `fly secrets set` · أسرار GitHub (Settings ← Secrets ← Actions) للخادم التجريبي الحيّ. القالب الكامل بتعليقات: `apps/api/.env.production.example`.

<a id="ثواني"></a>
### ثواني (Thawani) — بطاقات عُمانية
1. **تجربة فوراً (UAT):** مفاتيح بيئة الاختبار العامة موجودة في وثائق ثواني (docs.thawani.om) — ضعها مع `THAWANI_MODE=uat` و`PAYMENT_PROVIDERS=thawani,wallet,manual,mock`. الخادم التجريبي الحيّ يستعملها تلقائياً. بطاقة الاختبار: `4242 4242 4242 4242`، أي تاريخ مستقبلي، أي CVV.
2. **حقيقي (live):** سجّل تاجراً في thawani.om ← بوابة التاجر ← **API Keys** ← انسخ Secret Key وPublishable Key ← `THAWANI_MODE=live` (افتراضي في الإنتاج) وأزل `mock` من `PAYMENT_PROVIDERS`.
3. **Webhook (اختياري):** في بوابة التاجر أضف الرابط `https://<نطاقك>/api/payments/webhook/thawani` وضع السرّ في `THAWANI_WEBHOOK_SECRET`. حتى بدونه الطلب يُؤكَّد بسؤال ثواني عن الجلسة عند عودة المستخدم (`/pay/success`) — الـ webhook يسرّع الأمر فقط ولا يُوثَق بجسمه أبداً.
4. **تأكّد:** الربط والخدمات ← الدفع ← ثواني ✅ (uat/live) ← «فحص الاتصال الآن» يقول «المفتاح مقبول». في التطبيق يظهر شعار «وضع التجربة» على البوابة في UAT.

<a id="stripe"></a>
### Stripe — بطاقات دولية
dashboard.stripe.com ← Developers ← **API keys** ← `STRIPE_SECRET_KEY=sk_test_…` (الوضع يُستنتج من البادئة؛ `sk_live_…` للحقيقي). Webhook: Developers ← Webhooks ← Add endpoint `https://<نطاقك>/api/payments/webhook/stripe` (حدث `checkout.session.completed`) ← `STRIPE_WEBHOOK_SECRET=whsec_…`. أضف `stripe` إلى `PAYMENT_PROVIDERS`. بطاقة الاختبار نفسها `4242 4242 4242 4242`.

<a id="google-sign-in"></a>
### Google Sign-In
1. console.cloud.google.com ← مشروع ← **APIs & Services ← OAuth consent screen** (External، اسم التطبيق والشعار) ← **Credentials ← Create credentials ← OAuth client ID**.
2. أنشئ ثلاثة عملاء: **Web application** (Authorized JavaScript origins = `https://<نطاقك>` وعند التطوير `http://localhost:8081`)، **iOS** (Bundle ID من `apps/mobile/app.json`)، **Android** (اسم الحزمة + بصمة SHA-1 من `eas credentials`).
3. الخادم: `GOOGLE_CLIENT_IDS=<web>.apps.googleusercontent.com,<ios>…,<android>…` (الويب أولاً). التطبيق الأصلي: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` و`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` عند البناء.
4. يظهر زر Google في شاشة الدخول تلقائياً. المستخدم الذي بريده الموثّق يطابق حساباً موجوداً يُربط به. تأكّد: الربط والخدمات ← الدخول ← Google ✅.
5. النوافذ المنبثقة لـ Google وApple تعيد الرمز عبر `postMessage`، والخادم يرسل `Cross-Origin-Opener-Policy: same-origin-allow-popups` لهذا — أي وكيل عكسي أمامه (Caddy/Nginx/Cloudflare) يجب ألّا يفرض `same-origin` أشدّ منه.

<a id="apple-sign-in"></a>
### Apple Sign-In
1. developer.apple.com ← **Certificates, Identifiers & Profiles ← Identifiers** ← App ID للتطبيق ← فعّل **Sign in with Apple**.
2. للويب: **Identifiers ← Services IDs ← +** (مثل `om.example.app.web`) ← Configure ← Domains = `<نطاقك>`، Return URLs = `https://<نطاقك>/login`.
3. الخادم: `APPLE_CLIENT_IDS=<Bundle ID>` (التطبيق) و`APPLE_SERVICES_ID=<Services ID>` (الويب) — كلاهما يُقبل جمهوراً للرمز، ويكفي أحدهما لتفعيل الزرّ على منصّته. في `app.json` مفعَّل `usesAppleSignIn` وإضافة `expo-apple-authentication`.
4. iOS يعرض الزر الأصلي، والويب زر Apple JS. Apple يرسل الاسم مرة واحدة فقط عند أول دخول ويُحفَظ حينها.

<a id="livekit"></a>
### LiveKit Cloud — فيديو جماعي
cloud.livekit.io ← مشروع ← **Settings ← Keys ← Create key** ← `LIVEKIT_URL=wss://<project>.livekit.cloud` `LIVEKIT_API_KEY` `LIVEKIT_API_SECRET` و`ROOM_PROVIDER=livekit`. القاعة الداخلية (WebRTC ثنائي) تبقى للويب؛ LiveKit للجوال والحصص الجماعية. تأكّد: الغرف ← LiveKit ← فحص الاتصال (يوقّع رمزاً ويصل للخادم).

<a id="turn"></a>
### TURN — فيديو عبر شبكات الجوال
STUN العام يكفي على الشبكات المفتوحة؛ خلف 4G/الجدران النارية تحتاج مرحّل TURN. ثلاثة خيارات (الأول المتاح يُستعمل: ثابت ← Twilio ← Metered):
- **Twilio (بلا مفاتيح إضافية):** إن كان لديك `TWILIO_ACCOUNT_SID` و`TWILIO_AUTH_TOKEN` للرموز تُجلب بيانات TURN مؤقّتة من Twilio تلقائياً (خدمة Network Traversal — مدفوعة بالاستهلاك).
- **Metered:** metered.ca ← **TURN Server** ← أنشئ تطبيقاً ← `METERED_API_KEY` و`METERED_DOMAIN` (النطاق الفرعي بلا `.metered.live`). `TURN_SOURCE=metered` يفضّله على Twilio.
- **ثابت / coturn خاص:** `TURN_URL=turn:turn.example.om:3478` `TURN_USERNAME` `TURN_CREDENTIAL`.
`TURN_TTL` (٣٦٠٠) صلاحية البيانات المؤقّتة (تُخزَّن مؤقّتاً في الذاكرة). تأكّد: الغرف ← TURN ← فحص الاتصال يعرض المصدر وعدد الخوادم.

<a id="sentry"></a>
### Sentry — تتبّع الأخطاء
sentry.io ← Create project (Node) ← **Client Keys (DSN)** ← `SENTRY_DSN=https://…@….ingest.sentry.io/…`. الأخطاء ≥ 500 والاستثناءات غير المعالَجة تُرسَل تلقائياً؛ `SENTRY_TRACES=0.1` يفعّل تتبّع الأداء لعشر الطلبات. بلا DSN لا يُحمَّل شيء.

<a id="web-push"></a>
### Web Push — إشعارات المتصفح (تلقائي)
لا يحتاج حساباً: عند أول تشغيل يُولَّد زوج مفاتيح VAPID ويُحفَظ في `DATA_DIR/.vapid.json`. إن كان لديك أكثر من خادم أو أردت تثبيتها: `npx web-push generate-vapid-keys` ← `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY`، و`VAPID_SUBJECT=mailto:admin@<نطاقك>`. يحتاج HTTPS (أو localhost). المستخدم يفعّلها من الإعدادات ← **التنبيهات**. تأكّد: الإشعارات ← المتصفح ✅ والمفتاح العام من `GET /api/push/public-key`.

<a id="expo-push"></a>
### Expo Push — إشعارات التطبيق
expo.dev ← مشروع EAS ← انسخ **Project ID** إلى `apps/mobile/app.json` ← `extra.eas.projectId` (بدونه التطبيق لا يطلب رمز إشعارات). اختيارياً **Access tokens** ← `EXPO_ACCESS_TOKEN` على الخادم (يرفع الحدود ويؤمّن الإرسال). البناء بـ `eas build` يضيف ملفات Firebase/APNs تلقائياً. تأكّد: الإشعارات ← Expo ← فحص الاتصال يصل إلى خدمة Expo.

<a id="النسخ-الاحتياطية"></a>
### النسخ الاحتياطية
تلقائية عند التشغيل ثم كل `BACKUP_EVERY_HOURS` (٢٤) ساعة إلى `DATA_DIR/backups/manassah-YYYYMMDD-HHMMSS.db` (نسخة متّسقة عبر `VACUUM INTO`)، مع الاحتفاظ بآخر `BACKUP_KEEP` (٧). فوراً: الربط والخدمات ← **نسخة احتياطية الآن** أو `POST /api/admin/system/backup`. انسخ المجلّد إلى خارج الخادم دورياً (أمر جاهز في `deploy/README.md`). الاستعادة: أوقف الخادم واستبدل `manassah.db` بالنسخة.

<a id="النطاق-وhttps"></a>
### النطاق وHTTPS (خادم خاص بأمر واحد)
سجّل **A** للنطاق يشير إلى خادمك ← `cp apps/api/.env.production.example .env` ← ثم:
```bash
DOMAIN=app.example.om docker compose -f deploy/docker-compose.prod.yml up -d
```
Caddy يصدر شهادة Let's Encrypt تلقائياً ويمرّر كل شيء إلى التطبيق. الخطوات كاملة (Ubuntu، Docker، الجدار الناري، أول مدير، النسخ الاحتياطية) في **`deploy/README.md`**. `PUBLIC_URL` يصبح `https://<DOMAIN>` تلقائياً؛ حدّد `CORS_ORIGINS` في الإنتاج.

<a id="صورة-ghcr"></a>
### صورة GHCR
`.github/workflows/deploy.yml` يبني عند كل دفعة إلى `main` (أو يدوياً) صورة `ghcr.io/<owner>/<repo>:latest` و`:<sha>` بصلاحيات `GITHUB_TOKEN` وحدها. اجعل الحزمة عامة من صفحة Packages (Package settings ← Change visibility) إن أردت سحبها بلا تسجيل دخول؛ وظيفة Fly في الملف نفسه لا تحتاج ذلك — تسحب الصورة بـ `GITHUB_TOKEN` وتدفعها إلى سجلّ Fly قبل النشر. على الخادم: `docker pull ghcr.io/<owner>/<repo>:latest && docker tag … manassah:latest` ثم أمر `deploy/` أعلاه بلا بناء. `GHCR_IMAGE` يظهر اسم الصورة في لوحة الإدارة.

<a id="fly--render-بنقرة"></a>
### Fly · Render بنقرة
- **Fly:** مرة واحدة `fly launch --copy-config --yes && fly volumes create data --size 1` ثم أضف سرّ المستودع `FLY_API_TOKEN` (`fly tokens create deploy`) — بعدها كل دفعة إلى `main` تنشر الصورة المبنية تلقائياً.
- **Render:** أنشئ الخدمة من `render.yaml` (Blueprint) ← Settings ← **Deploy Hook** ← انسخ الرابط إلى سرّ `RENDER_DEPLOY_HOOK_URL`.
- بلا هذين السرّين تُبنى الصورة فقط ويطبع كل نشر سبب تخطّيه.

## البنية

```
apps/
  mobile/    تطبيق Expo (React Native + Expo Router) — Android/iOS/Web، عربي أوّلاً، RTL أصلي
  api/       خادم Node 22 + Express + SQLite (WAL) + Socket.IO — كل الصلاحيات تُفرض هنا
  admin/     لوحة الإدارة (Vite + React) — تُخدَم من /admin عبر خادم الـ API بعد البناء
packages/
  shared/    العقود (Zod → TypeScript)، الهوية (brand)، الترجمة ar/en، دوال المال
  tokens/    رموز التصميم: الألوان، الخط، المقاسات، الزوايا، الحركة
docs/BLUEPRINT.md   التدقيق، المعمارية، نموذج البيانات، خريطة الشاشات، نظام التصميم، المراحل، المخاطر
legacy/     الإصدار الأول (يعمل مستقلاً) — محفوظ للمرجع
```

## التشغيل

```bash
npm install                     # Node >= 22.18
cp apps/api/.env.example apps/api/.env
npm run seed                    # بيانات تطوير (منهج عُماني، معلّمون معتمدون، كتب PDF، دورات، حجوزات) — ليست للإنتاج
npm run api                     # http://localhost:4000
npm run mobile                  # Expo (a للأندرويد، i لـ iOS، w للويب)
npm run admin                   # لوحة الإدارة على http://localhost:5173  (أو admin:build ثم /admin من الخادم)
npm run test:api                # ٣٦ اختباراً للمسارات الحسّاسة
npm run typecheck               # كل الحزم
```

حسابات التطوير (رمز التحقّق دائماً `000000` خارج الإنتاج):

| الدور | الهاتف |
|---|---|
| طالب (الصف ١٢) | `90000010` |
| معلّم فيزياء معتمد | `91000001` |
| مدير عام / مالية / مراجع / دعم | `90000001` / `90000002` / `90000003` / `90000004` |

## ما الذي يعمل الآن

- **الدخول** برمز تحقّق (هاتف/بريد)، جلسات بتجديد دوري وكشف إعادة الاستخدام. Apple/Google: يعملان بمجرد ضبط معرّفات العملاء (راجع «ربط الخدمات»).
- **الرئيسية** بالترتيب الملزم: حصّتك القادمة → احجز معلّماً → أكمل من حيث توقّفت → ملخّصات صفّك → الدورات → المعلّمون المميّزون → الأكثر طلباً → حلّ مسائل → عروض.
- **المكتبة**: فلاتر (النوع/المادة/الصف/الفصل/السعر/التقييم/الترتيب)، صفحة كتاب كمتجر محترف، **قارئ داخل التطبيق** (pdf.js مستضاف ذاتياً، روابط موقّعة قصيرة العمر مرتبطة بالمستخدم، علامة مائية، معاينة محدودة، تقدّم وإشارات مرجعية).
- **المعلّمون**: بحث بفلاتر، ملف بأسعار ٣٠/٤٥/٦٠ فردي/جماعي وباقات بتوفير ظاهر، **تقويم** (أيام العمل، الفترات، خانات، استراحات، إجازات)، حجز في شاشة واحدة، **منع الحجز المزدوج بقيد قاعدة البيانات**، مهلة دفع تُحرّر الموعد، **سياسة إلغاء من الإعدادات لا من الشيفرة**، إعادة جدولة.
- **القاعة المباشرة**: تنشأ من حجز رسمي فقط برمز محدود المدة؛ حضور/دردشة/يد/سبّورة/مشاركة شاشة/مؤقّت/مؤشّر اتصال وإعادة اتصال بلا طرد؛ الفيديو **WebRTC على الويب** وعبر LiveKit للجوال بضبط `ROOM_PROVIDER=livekit`.
- **الدورات**: مشغّل (سرعات، ±١٠ث، حفظ الموضع، إكمال)، اختبارات تُصحَّح في الخادم مع الشرح وتوزيع الموضوعات.
- **الدفع** منفصل عن الواجهة: طلبات/مدفوعات/استرجاعات/أرباح/سحوبات/كوبونات؛ مزوّد قابل للتبديل (mock، محفظة، تحويل بنكي، Thawani، Stripe) مع تحقّق توقيع الـ webhook. **لا تُخزَّن بيانات بطاقات**.
- **الأدوار** تُفرض في الخادم على كل مسار؛ هاتف الطالب وبريده لا يظهران للمعلّمين؛ إبلاغ/حظر؛ سجلّ عمليات.
- **لوحة الإدارة**: تحقّق المعلّمين بالمستندات، مراجعة المحتوى بقائمة تحقّق، الحجوزات والنزاعات، الطلبات/التحويلات/الاسترجاع، السحوبات، الكوبونات، شجرة المنهج، المستخدمون والأدوار، البلاغات، الإعدادات (سياسة الإلغاء، العمولة، المهل)، سجلّ العمليات.

## ما يحتاج ضبطاً قبل الإنتاج

- مزوّد رموز التحقّق (SMS/واتساب/بريد — راجع «رموز تحقّق حقيقية» أدناه) ومفاتيح Thawani، ومفاتيح Apple/Google للدخول الاجتماعي.
- LiveKit (أو بديله) لفيديو الجوال — المزوّد الداخلي يقدّم الدردشة والحضور والإشارات فقط على الجوال.
- الإشعارات الفورية تعمل: المتصفح (VAPID تلقائي) والتطبيق (Expo مع `projectId`) — الإشعارات داخل التطبيق فورية عبر Socket.IO.
- واجهة إنشاء الدورات للمعلّم (الـ API جاهز: أقسام، دروس، رفع فيديو، اختبارات، إرسال للمراجعة) — رفع الكتب يعمل من التطبيق.
- الإنتاج يبدأ بـ `seedCatalog` فقط (منهج بلا مستخدمين ولا محتوى). لا أرقام مزيّفة.

### نسخة أحادية الملف (للإرسال أو الاستضافة في أي مكان)

```bash
npm run web:single            # → apps/mobile/dist-single/index.html (نحو 7 ميغابايت)
```

ملف HTML واحد يحوي التطبيق كاملاً في وضع العرض: الحزمة، الخطوط، pdf.js، وملفات الكتب التجريبية مضمَّنة داخله،
ولا يطلب أي شيء من الشبكة. يعمل من أي مسار استضافة عبر http/https (يعيد ضبط مساره إلى الجذر قبل تشغيل الموجّه)؛
فتحه من القرص مباشرة (file://) لا يعمل لأن الموجّه يحتاج عنوان http. يستعمل `EXPO_PUBLIC_DEMO=1` مثل `docs/app` تماماً،
والحسابات التجريبية نفسها.

## النشر على الإنترنت (خادم حقيقي)

خادم واحد يشغّل كل شيء: الـ API، الغرف المباشرة (Socket.IO)، تطبيق الويب من الجذر `/`، ولوحة الإدارة من `/admin`.
كل الطرق أدناه تستعمل `Dockerfile` في جذر المستودع.

### الطريقة الأسهل: Render (بنقرة)
1. افتح https://dashboard.render.com → **New → Blueprint** → اختر هذا المستودع (الفرع `main` أو فرع العمل).
2. Render يقرأ `render.yaml` ويبني الصورة وينشرها. العنوان العام يُضبط تلقائياً.
3. بعد دقائق: افتح `https://<اسم-الخدمة>.onrender.com` — التطبيق يعمل، و`/admin` لوحة الإدارة، و`/api/health` للفحص.

### Fly.io
```bash
fly launch --copy-config --yes     # يقرأ fly.toml
fly volumes create data --size 1   # قرص دائم لقاعدة البيانات والملفات
fly deploy
```

### أي خادم فيه Docker (VPS)
```bash
PUBLIC_URL=https://manassah.example.om docker compose up -d --build
```
ثم ضع Nginx/Caddy أمامه لشهادة HTTPS — أو بأمر واحد مع Caddy مضمَّن: `DOMAIN=app.example.om docker compose -f deploy/docker-compose.prod.yml up -d` (راجع `deploy/README.md`).

### أول تشغيل على خادم فارغ
| المتغيّر | القيمة | الأثر |
| --- | --- | --- |
| `ALLOW_DEMO_SEED=1` | افتراضي في القوالب | بيانات عرض كاملة: طالب `90000010`، معلّم `91000001`، فريق `90000001`–`04` |
| `ALLOW_DEMO_SEED=0` + `ADMIN_PHONE=9xxxxxxx` | للإنتاج | المنهج العُماني فقط + حساب مدير أوّل برقمك |
| `OTP_FIXED_CODE=000000` | مؤقّت | رمز دخول ثابت حتى ربط مزوّد — اجعله `none` بعد الربط |

القيم كلها في `apps/api/.env.production.example`.

<a id="رموز-تحقق-حقيقية"></a>
### رموز تحقّق حقيقية (SMS / واتساب / بريد)
بلا أي مزوّد يعمل الخادم في الوضع التجريبي: الرمز `000000` ويُعاد في الاستجابة. بمجرد وضع مفاتيح مزوّد واحد (في المتغيّرات أو الأسرار) يصبح الدخول حقيقياً لتلك القناة:
الشخص يكتب رقمه أو بريده ويصله رمز حقيقي. المزوّد يُكتشف تلقائياً من المفاتيح الموجودة (`SMS_PROVIDER`/`EMAIL_PROVIDER` اختياريان لتثبيته). كل المتغيّرات موثّقة في `apps/api/.env.example`.

**1) البريد عبر Gmail (مجاني، ٥ دقائق)**
1. حساب Google ← **الأمان** ← فعّل **التحقق بخطوتين**.
2. ابحث في صفحة الأمان عن **App passwords** (كلمات مرور التطبيقات) ← أنشئ واحدة باسم `manassah` ← انسخ الكلمة المكوّنة من 16 حرفاً.
3. ضع القيم:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
EMAIL_FROM=منصّة <you@gmail.com>
```
(بديل بلا Gmail: أنشئ مفتاحاً في resend.com وضع `RESEND_API_KEY=re_...` مع `EMAIL_FROM` لدومين موثّق هناك.)

**2) الرسائل النصية وواتساب عبر Twilio Verify (الأنسب لعُمان)**
1. أنشئ حساباً في https://www.twilio.com/try-twilio ← من الـ Console انسخ **Account SID** و**Auth Token**.
2. القائمة ← **Verify** ← **Services** ← **Create new** (اسم الخدمة هو ما يظهر في الرسالة) ← انسخ **Service SID** (يبدأ بـ `VA`). فعّل قناة **WhatsApp** من إعدادات الخدمة إن أردتها.
3. ضع القيم:
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
- واتساب عبر Verify يُرسَل من مرسل Twilio المشترك — **لا تحتاج رقم واتساب خاصاً بك** ولا موافقة Meta؛ يظهر خيار «واتساب» في شاشة الدخول تلقائياً. (`OTP_WHATSAPP=0` يخفيه.)
- **الحساب التجريبي (Trial) في Twilio يرسل فقط إلى الأرقام التي تتحقّق منها أنت في الـ Console** (Phone Numbers ← Verified Caller IDs)؛ أي رقم آخر يعطي «حساب Twilio تجريبي…». بعد شحن الرصيد (Upgrade) يُرسَل لأي رقم في الدول المسموحة.
- بديل بدون Verify (رقم/خدمة رسائل خاصة بك): `TWILIO_FROM=+1415…` أو `TWILIO_MESSAGING_SERVICE_SID=MG…`، ولواتساب رقم معتمد في `TWILIO_WHATSAPP_FROM`.

**3) بوابة SMS محلية (Unifonic / Omantel / Ooredoo) عبر HTTP**
أي بوابة تقبل طلب HTTP تعمل عبر `SMS_HTTP_URL` مع قالب جسم. العناصر `{to}` (E.164)، `{to_digits}` (أرقام فقط بلا +)، `{text}` (نص الرسالة كاملاً)، `{code}` تُستبدل تلقائياً. مثال Unifonic:
```env
SMS_HTTP_URL=https://el.cloud.unifonic.com/rest/SMS/messages
SMS_HTTP_METHOD=POST
SMS_HTTP_HEADERS={"Accept":"application/json"}
SMS_HTTP_BODY={"AppSid":"YOUR_APP_SID","SenderID":"MANASSAH","Recipient":"{to_digits}","Body":"{text}"}
SMS_HTTP_OK='"success":true'
```
إن كان جسم القالب JSON يُرسَل كـ `application/json`، وإلا كـ `application/x-www-form-urlencoded` مع ترميز القيم (فيبقى `+` في الرقم سليماً). `SMS_HTTP_OK` نص يجب أن يظهر في الاستجابة لاعتبار الإرسال ناجحاً (اختياري؛ بدونه يكفي 2xx) — ضعه بين علامتي اقتباس مفردتين في `.env` كما في المثال حتى تقرأه dotenv وdocker compose وfly بالشكل نفسه، وفي أسرار GitHub اكتب القيمة نفسها بلا العلامتين المفردتين. مثال GET: `SMS_HTTP_URL=https://gw.example.om/send?user=U&pass=P&to={to_digits}&msg={text}` مع `SMS_HTTP_METHOD=GET`.

**أين تضع القيم**
- **الخادم التجريبي الحيّ (GitHub Actions):** المستودع ← **Settings ← Secrets and variables ← Actions ← New repository secret**، سرّ لكل متغيّر بنفس الاسم (مثل `TWILIO_ACCOUNT_SID`، وكذلك `SMS_HTTP_OK` و`OTP_WHATSAPP` و`SMS_PROVIDER` و`EMAIL_PROVIDER` إن احتجتها). عند التشغيل التالي يظهر في التعليق والملخّص سطر «رموز حقيقية — هاتف/واتساب/بريد».
- **Docker / Render / Fly:** في `.env` بجانب `docker-compose.yml` (أو `docker compose` مع المتغيّرات)، أو من لوحة Render (Environment)، أو `fly secrets set KEY=VALUE`. القالب الكامل في `apps/api/.env.production.example`.

**القواعد**
- حسابات العرض (`9000000x`، `9100000x`) وأهداف `OTP_TEST_TARGETS` تبقى على الرمز `000000` حتى مع مزوّد حقيقي؛ الأرقام والبرائد الحقيقية تصلها رموز حقيقية ولا يُقبل لها الرمز الثابت أبداً ولا يُعاد في الاستجابة.
- في الإنتاج بعد ربط مزوّد: `OTP_FIXED_CODE=none` (يلغي الرمز الثابت لغير حسابات العرض). تجربة على رقمك أنت قبل ذلك؟ أضفه إلى `OTP_TEST_TARGETS`.
- الحماية من الإرسال المفرط (SMS pumping): `SMS_ALLOWED_COUNTRIES=+968` (`*` = الكل)، `OTP_SEND_PER_TARGET_HOUR=5`، `OTP_SEND_PER_DAY=300`، `OTP_RESEND_COOLDOWN=30` ثانية. الرموز تنتهي بعد `OTP_TTL` (٥ دقائق) وبعد ٥ محاولات خاطئة.
- حالة الربط بلا أسرار: `/api/health` (`otp`) أو لوحة الإدارة ← الإعدادات ← **الاتصال والإرسال**.

### خادم تجريبي حيّ بنقرة (لتجربة الكاميرا والمايك)
لا يحتاج أي حساب استضافة: `.github/workflows/live-server.yml` يبني المشروع على GitHub Actions ويشغّل الخادم ببيانات العرض
ويفتح نفقاً عاماً HTTPS عبر Cloudflare. الرابط يظهر في **Summary** صفحة التشغيل، ويعمل حتى ٥ ساعات.
- التشغيل: Actions ← **live-server** ← **Run workflow** (أو **Re-run all jobs** على آخر تشغيل).
- لتدخل لوحة الإدارة برقمك أنت: Settings ← Secrets and variables ← Actions ← New repository secret باسم `ADMIN_PHONE` وقيمته رقمك (مثل `98XXXXXX`). عند كل تشغيل يصبح رقمك مديراً تلقائياً.
- تجربة الحصة المباشرة: افتح الرابط على جهازين، ادخل كمعلّم `91000001` وكطالب `90000010`، ثم الحصص ← الحصة القادمة ← **دخول الحصة** ← اسمح للكاميرا والمايك.
- الفيديو يمرّ مباشرة بين الجهازين (WebRTC) عبر STUN عام ومرحّل TURN مجاني في وضع التجربة. للإنتاج اضبط `TURN_URL` و`TURN_USERNAME` و`TURN_CREDENTIAL` (coturn أو Twilio/Metered).

### ربط التطبيق بخادمك
- **الويب:** التطبيق المخدوم من الخادم نفسه متصل تلقائياً (نفس العنوان).
- **النسخة التجريبية (GitHub Pages / الملف الواحد):** الإعدادات ← **الخادم والاتصال** ← اكتب عنوان خادمك ← **اختبار الاتصال** ← **حفظ**. تتحوّل النسخة من بيانات محلية إلى خادمك مباشرة، ويمكن العودة للتجريبية بزر واحد.
- **Android/iOS:** اضبط `EXPO_PUBLIC_API_URL=https://…` عند البناء، أو من الإعدادات داخل التطبيق.

### المظهر والخيارات
الإعدادات ← **المظهر**: وضع نهاري/ليلي/تلقائي (وزر سريع في أعلى الشاشات الرئيسية)، حجم الخط (عادي/كبير)، اللغة. التفضيلات تُحفَظ على الجهاز.
