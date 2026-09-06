/**
 * رموز التصميم — المصدر الواحد للألوان والخطوط والمسافات.
 * الاتجاه: قويّ وبسيط ومرتّب — للطلاب من الصف الخامس إلى الثاني عشر:
 * ألوان عُمانية مشبعة (أحمر، أخضر، ذهبي) على خلفية دافئة، زوايا مستديرة كبيرة، خط كبير وواضح،
 * عناصر قليلة في كل شاشة وأهداف لمس كبيرة (٥٢ نقطة فأكثر للأزرار).
 * القيم أرقام خام (بلا وحدات) لتعمل في React Native مباشرة، والويب يحوّلها إلى px.
 */

export const colors = {
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
} as const;

/** ألوان المواد — مشبعة ومبهجة، تلازم المادة في كل مكان. المفتاح يُخزَّن في subjects.color_key */
export const subjectColors = {
  math:      { main: '#2F6FED', soft: '#E6EEFF' },
  physics:   { main: '#7A5AF8', soft: '#EFEBFF' },
  chemistry: { main: '#0EA5A5', soft: '#E0F7F7' },
  biology:   { main: '#3FA34D', soft: '#E6F6E8' },
  arabic:    { main: '#F08A24', soft: '#FFF1E3' },
  english:   { main: '#E5488A', soft: '#FDE8F1' },
  islamic:   { main: '#1F8A70', soft: '#E3F4EF' },
  social:    { main: '#B5651D', soft: '#F9EBDD' },
  default:   { main: '#5F6B7A', soft: '#EEF1F5' },
} as const;
export type SubjectColorKey = keyof typeof subjectColors;

/** أيقونة كل مادة (Ionicons) — تُرسم على الأغلفة والبلاطات بدل الصور */
export const subjectIcons: Record<SubjectColorKey, string> = {
  math: 'calculator', physics: 'planet', chemistry: 'flask', biology: 'leaf',
  arabic: 'book', english: 'language', islamic: 'moon', social: 'earth', default: 'school',
};

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

export const tokens = { colors, subjectColors, subjectIcons, fontFamily, typography, spacing, radius, motion, shadow, hitTarget, layout, omaniPattern };
export default tokens;
