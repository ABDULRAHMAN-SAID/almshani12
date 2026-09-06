/**
 * رموز التصميم — المصدر الواحد للألوان والخطوط والمسافات، بسِمَتين: فاتحة وداكنة.
 * الاتجاه: قويّ وبسيط ومرتّب — للطلاب من الصف الخامس إلى الثاني عشر:
 * ألوان عُمانية مشبعة (أحمر، أخضر، ذهبي)، زوايا مستديرة كبيرة، خط كبير وواضح، وأهداف لمس كبيرة.
 *
 * `colors` و`subjectColors` كائنان «حيّان»: قراءتهما تعطي قيم السِمة النشطة لحظة القراءة.
 * أوراق الأنماط تُبنى عبر `themed()` كي تُعاد لكل سِمة. القيم أرقام خام لتعمل في React Native مباشرة.
 */

/* ---------- السِمة الفاتحة ---------- */
const light = {
  bg: {
    base: '#FBF7F0',      // خلفية الشاشة — كريمي دافئ
    subtle: '#F2ECE0',    // خلفيات ثانوية، Skeleton
    card: '#FFFFFF',
    inverse: '#1E2430',
  },
  brand: {
    primary: '#D7263D',      // الأحمر العُماني — مشبع وواضح، للفعل الرئيسي
    primaryDark: '#A81C2F',  // حافة الزر السفلية وحالة الضغط
    primarySoft: '#FDE9EC',  // خلفية خفيفة للشارات والأيقونات
    green: '#159A5B',        // الأخضر العُماني — النجاح، «في مكتبتك»، الحضور
    greenDark: '#0F7A47',
    greenSoft: '#E3F5EB',
    gold: '#E8B830',         // شارة «معتمد»، التقييم، المكافآت
    goldDark: '#B98C14',
    goldSoft: '#FFF4D6',
  },
  text: {
    primary: '#1E2430',
    secondary: '#5F6B7A',
    tertiary: '#98A2B3',
    inverse: '#FFFFFF',
    onPrimary: '#FFFFFF',
    link: '#1D6FB8',
  },
  state: {
    success: '#159A5B',
    successSoft: '#E3F5EB',
    info: '#1D6FB8',          // الحصص والشرح
    infoSoft: '#E5F0FB',
    warning: '#E0891A',
    warningSoft: '#FFF1DE',
    warningText: '#B36A0E',
    danger: '#B3261E',        // أخطاء فقط
    dangerSoft: '#FBEAE8',
    live: '#FF3B30',
  },
  border: {
    default: '#EDE6D8',
    strong: '#DCD3C1',
    focus: '#D7263D',
  },
  overlay: 'rgba(30,36,48,0.55)',
  skeleton: '#EFE8DB',
  /** لون الظل — أدفأ في الفاتح، وغير مرئي تقريباً في الداكن */
  shadowColor: '#5A4A2A',
};
export type Colors = typeof light;

/* ---------- السِمة الداكنة (الوضع الليلي) — أسود دافئ لا رمادي باهت ---------- */
const dark: Colors = {
  bg: {
    base: '#0E0F12',
    subtle: '#1B1D23',
    card: '#181A20',
    inverse: '#FFFFFF',
  },
  brand: {
    primary: '#E6394F',
    primaryDark: '#B81F33',
    primarySoft: '#3A1B22',
    green: '#22B36A',
    greenDark: '#188A50',
    greenSoft: '#12301F',
    gold: '#F0C24A',
    goldDark: '#F3CD62',
    goldSoft: '#3A2F14',
  },
  text: {
    primary: '#F3F4F6',
    secondary: '#A6ADBA',
    tertiary: '#6B7280',
    inverse: '#0E0F12',
    onPrimary: '#FFFFFF',
    link: '#6EB4F5',
  },
  state: {
    success: '#22B36A',
    successSoft: '#12301F',
    info: '#5AA7F2',
    infoSoft: '#132A40',
    warning: '#F2A33A',
    warningSoft: '#3A2A12',
    warningText: '#F2A33A',
    danger: '#F26B62',
    dangerSoft: '#3D1A18',
    live: '#FF453A',
  },
  border: {
    default: '#262932',
    strong: '#343845',
    focus: '#E6394F',
  },
  overlay: 'rgba(0,0,0,0.7)',
  skeleton: '#23262E',
  shadowColor: '#000000',
};

/** ألوان المواد — مشبعة ومبهجة، تلازم المادة في كل مكان. المفتاح يُخزَّن في subjects.color_key */
const subjectLight = {
  math:      { main: '#2F6FED', soft: '#E6EEFF' },
  physics:   { main: '#7A5AF8', soft: '#EFEBFF' },
  chemistry: { main: '#0EA5A5', soft: '#E0F7F7' },
  biology:   { main: '#3FA34D', soft: '#E6F6E8' },
  arabic:    { main: '#F08A24', soft: '#FFF1E3' },
  english:   { main: '#E5488A', soft: '#FDE8F1' },
  islamic:   { main: '#1F8A70', soft: '#E3F4EF' },
  social:    { main: '#B5651D', soft: '#F9EBDD' },
  default:   { main: '#5F6B7A', soft: '#EEF1F5' },
};
export type SubjectColors = typeof subjectLight;
export type SubjectColorKey = keyof SubjectColors;
const subjectDark: SubjectColors = {
  math:      { main: '#5B8DEF', soft: '#16243D' },
  physics:   { main: '#9A82FF', soft: '#221B3F' },
  chemistry: { main: '#2BC4C4', soft: '#0F2E2E' },
  biology:   { main: '#5CBF69', soft: '#132D18' },
  arabic:    { main: '#F5A04A', soft: '#3A2410' },
  english:   { main: '#F06AA0', soft: '#3A1626' },
  islamic:   { main: '#3BB08F', soft: '#0F2E25' },
  social:    { main: '#D4844A', soft: '#3A2314' },
  default:   { main: '#9AA3B2', soft: '#22262E' },
};

/** أيقونة كل مادة (Ionicons) — تُرسم على الأغلفة والبلاطات بدل الصور */
export const subjectIcons: Record<SubjectColorKey, string> = {
  math: 'calculator', physics: 'planet', chemistry: 'flask', biology: 'leaf',
  arabic: 'book', english: 'language', islamic: 'moon', social: 'earth', default: 'school',
};

/* ---------- السِمة النشطة ---------- */
export type ThemeName = 'light' | 'dark';
export const themes: Record<ThemeName, { colors: Colors; subjectColors: SubjectColors }> = {
  light: { colors: light, subjectColors: subjectLight },
  dark: { colors: dark, subjectColors: subjectDark },
};
let active: ThemeName = 'light';
const listeners = new Set<(t: ThemeName) => void>();
export const getTheme = (): ThemeName => active;
export const isDark = (): boolean => active === 'dark';
export function setTheme(t: ThemeName): void {
  if (t === active) return;
  active = t;
  listeners.forEach(l => l(t));
}
export function onThemeChange(l: (t: ThemeName) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** كائن حيّ: كل قراءة تمرّ على السِمة النشطة (يدعم الوصول المتداخل، والنشر، وعامل in) */
function live<T extends object>(read: () => T): T {
  const cache = new Map<PropertyKey, object>();
  return new Proxy({} as T, {
    get(_, key) {
      const v = (read() as Record<PropertyKey, unknown>)[key];
      if (v && typeof v === 'object') {
        let p = cache.get(key);
        if (!p) { p = live(() => (read() as Record<PropertyKey, object>)[key]); cache.set(key, p); }
        return p;
      }
      return v;
    },
    has(_, key) { return key in read(); },
    ownKeys() { return Reflect.ownKeys(read()); },
    getOwnPropertyDescriptor(_, key) {
      const v = (read() as Record<PropertyKey, unknown>)[key];
      return v === undefined ? undefined : { enumerable: true, configurable: true, writable: false, value: v };
    },
  });
}
export const colors: Colors = live(() => themes[active].colors);
export const subjectColors: SubjectColors = live(() => themes[active].subjectColors);

/**
 * ورقة أنماط تتبع السِمة: تُبنى مرة لكل سِمة وتُقرأ منها الخاصية المطلوبة لحظة الرسم.
 * الاستعمال: const styles = themed((c, sc) => StyleSheet.create({ card: { backgroundColor: c.bg.card } }));
 */
export function themed<T extends object>(factory: (c: Colors, sc: SubjectColors) => T): T {
  const built: Partial<Record<ThemeName, T>> = {};
  const current = () => (built[active] ??= factory(themes[active].colors, themes[active].subjectColors));
  return new Proxy({} as T, {
    get(_, key) { return (current() as Record<PropertyKey, unknown>)[key]; },
    has(_, key) { return key in current(); },
    ownKeys() { return Reflect.ownKeys(current()); },
    getOwnPropertyDescriptor(_, key) {
      const v = (current() as Record<PropertyKey, unknown>)[key];
      return v === undefined ? undefined : { enumerable: true, configurable: true, writable: false, value: v };
    },
  });
}

/**
 * خطّان: Baloo Bhaijaan 2 للعناوين (مستدير وودود وقوي)، وReadex Pro للنصوص (واضح وعريض المسافات ومريح للقراءة).
 */
export const fontFamily = {
  regular: 'ReadexPro_400Regular',
  medium: 'ReadexPro_500Medium',
  semibold: 'ReadexPro_600SemiBold',
  bold: 'ReadexPro_700Bold',
  display: 'BalooBhaijaan2_800ExtraBold',
  heading: 'BalooBhaijaan2_700Bold',
  /** للويب: سلسلة احتياطية كاملة */
  webStack: "'Readex Pro','Noto Sans Arabic',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif",
} as const;

/** سلّم الخط — دور واحد لكل استخدام، لا أحجام عشوائية. أكبر من المعتاد لأن المستخدمين طلاب */
export const typography = {
  display: { size: 32, lineHeight: 46, family: fontFamily.display },
  h1:      { size: 27, lineHeight: 40, family: fontFamily.display },
  h2:      { size: 22, lineHeight: 34, family: fontFamily.heading },
  h3:      { size: 18, lineHeight: 28, family: fontFamily.bold },
  body:    { size: 16, lineHeight: 26, family: fontFamily.regular },
  bodyMedium: { size: 16, lineHeight: 26, family: fontFamily.medium },
  small:   { size: 14, lineHeight: 22, family: fontFamily.regular },
  caption: { size: 13, lineHeight: 20, family: fontFamily.semibold },
  button:  { size: 17, lineHeight: 24, family: fontFamily.bold },
  price:   { size: 20, lineHeight: 28, family: fontFamily.bold },
  number:  { size: 16, lineHeight: 24, family: fontFamily.semibold },
} as const;
export type TypographyRole = keyof typeof typography;

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const space = (n: keyof typeof spacing) => spacing[n];

/** زوايا كبيرة — الشكل المستدير أساس الهوية */
export const radius = { sm: 12, md: 16, lg: 22, xl: 28, full: 999 } as const;

export const motion = { fast: 150, base: 200, slow: 250 } as const;

/** ظلال ناعمة — العمق يأتي من اللون والحجم أكثر من الظل */
export const shadow = {
  card: { shadowColor: '#5A4A2A', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  raised: { shadowColor: '#5A4A2A', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  sheet: { shadowColor: '#1E2430', shadowOpacity: 0.14, shadowRadius: 28, shadowOffset: { width: 0, height: -4 }, elevation: 8 },
} as const;

/** أصغر هدف لمس */
export const hitTarget = 48;
export const layout = { screenPadding: 16, cardPadding: 16, maxContentWidth: 640 } as const;

/** نمط عُماني خافت — يُستخدم في الترويسة والـ Splash فقط، وبشفافية ≤ 6٪ */
export const omaniPattern = { opacity: 0.06, cell: 22, stroke: '#E8B830' } as const;

export const tokens = { colors, subjectColors, subjectIcons, themes, fontFamily, typography, spacing, radius, motion, shadow, hitTarget, layout, omaniPattern };
export default tokens;
