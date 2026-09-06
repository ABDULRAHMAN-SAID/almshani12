// يُدرج إعداد توقيع الإصدار (من gradle.properties: MANASSAH_UPLOAD_*) في build.gradle الذي يولّده Expo،
// ويجعل نوع البناء release يستعمله بدل مفتاح التطوير. الاستعمال: node scripts/android-signing.mjs android/app/build.gradle
import fs from 'node:fs';

const file = process.argv[2] || 'android/app/build.gradle';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('signingConfigs.release')) { console.log('إعداد التوقيع موجود مسبقاً'); process.exit(0); }

const head = '    signingConfigs {\n';
if (!s.includes(head)) throw new Error('signingConfigs block not found in ' + file);
s = s.replace(head, `${head}        release {
            storeFile file(MANASSAH_UPLOAD_STORE_FILE)
            storePassword MANASSAH_UPLOAD_STORE_PASSWORD
            keyAlias MANASSAH_UPLOAD_KEY_ALIAS
            keyPassword MANASSAH_UPLOAD_KEY_PASSWORD
        }
`);

const buildTypes = s.indexOf('buildTypes {');
const release = s.indexOf('release {', buildTypes);
if (buildTypes < 0 || release < 0) throw new Error('release buildType not found in ' + file);
const patched = s.slice(release).replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release');
if (patched === s.slice(release)) throw new Error('release signingConfig line not found');
s = s.slice(0, release) + patched;
fs.writeFileSync(file, s);
console.log('release signing config inserted into ' + file);
