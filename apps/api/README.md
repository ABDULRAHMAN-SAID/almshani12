# منصّة — الخادم (apps/api)

Express + better-sqlite3، يعمل بـ `tsx` مع استيرادات بامتداد `.ts` صريح.

```bash
npm run dev          # تشغيل التطوير (يهيّئ القاعدة ويطبّق الترحيلات عند الإقلاع)
npm test             # node:test على قاعدة في الذاكرة (tests/*.test.ts)
npx tsc --noEmit     # فحص الأنواع
```

## الترقية والترحيلات (Upgrading / migrations)

المخطّط مرقّم بـ `PRAGMA user_version` (`src/db/migrations.ts`، الإصدار الحالي `SCHEMA_VERSION`، ويعلنه `GET /api/health` في `schemaVersion`).

- **قاعدة جديدة**: تُبنى من `src/db/schema.sql` بشكلها النهائي ويُختم `user_version` مباشرة — لا ترحيلات ولا نسخة احتياطية.
- **قاعدة قديمة** (`user_version` أقل من الإصدار الحالي): قبل تطبيق أي ترحيل معلّق يأخذ الخادم نسخة احتياطية تلقائية بـ `VACUUM INTO`
  بجانب ملف القاعدة باسم `<DB_FILE>.bak-v<الإصدار القديم>-<طابع زمني>` (مثال: `data/manassah.db.bak-v0-1788705691568`).
  **إن فشل أخذ النسخة يرفض الخادم الإقلاع.** بعد كل ترحيل يُفحص `PRAGMA foreign_key_check` ويُرفض الإقلاع عند أي خلل.
- في الاختبارات (`NODE_ENV=test`) وقاعدة `:memory:` لا تُؤخذ نسخة.

خذ نسخة يدوية أيضاً قبل نشر إصدار يحمل ترحيلات (أوقف الخادم أولاً كي يكون ملف WAL مفرَّغاً):

```bash
cp data/manassah.db data/manassah.db.bak
```

للرجوع: أوقف الخادم، أعد الملف (`cp data/manassah.db.bak data/manassah.db`)، واحذف `data/manassah.db-wal` و`data/manassah.db-shm` إن وُجدا، ثم شغّل الإصدار السابق.
