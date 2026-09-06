/**
 * رموز التصميم — المصدر الواحد للألوان والخطوط والمسافات.
 * القيم أرقام خام (بلا وحدات) لتعمل في React Native مباشرة، والويب يحوّلها إلى px.
 */

export const colors = {
  bg: {
    base: '#F8F6F1',      // خلفية الشاشة — أوف وايت دافئ
    subtle: '#F1EEE7',    // خلفيات ثانوية، Skeleton
    card: '#FFFFFF',
    inverse: '#171717',
  },
  brand: {
    primary: '#9E1B32',      // الأحمر العُماني — للفعل الرئيسي فقط
    primaryDark: '#751426',  // حالة الضغط
    primarySoft: '#F6E8EB',  // خلفية خفيفة للشارات
    gold: '#C7A461',         // شارة «معتمد»، التقييم
    goldSoft: '#F5EEDD',
  },
  text: {
    primary: '#171717',
    secondary: '#686868',
    tertiary: '#9A9A9A',
    inverse: '#FFFFFF',
    onPrimary: '#FFFFFF',
    link: '#315D7A',
  },
  state: {
    success: '#287A59',
    successSoft: '#E6F1EC',
    info: '#315D7A',          // الحصص والشرح
    infoSoft: '#E7EEF3',
    warning: '#A8730F',
    warningSoft: '#FBF3E0',
    danger: '#B3261E',        // أخطاء فقط — متمايز عن الأحمر العُماني
    dangerSoft: '#FBEAE8',
    live: '#B3261E',
  },
  border: {
    default: '#E6E1D6',
    strong: '#D6D0C2',
    focus: '#9E1B32',
  },
  overlay: 'rgba(23,23,23,0.5)',
  skeleton: '#ECE8DF',
} as const;

/** ألوان المواد — تلازم المادة في كل مكان. المفتاح يُخزَّن في subjects.color_key */
export const subjectColors = {
  math:      { main: '#315D7A', soft: '#E7EEF3' },
  physics:   { main: '#3E5C8A', soft: '#E6EAF3' },
  chemistry: { main: '#287A59', soft: '#E6F1EC' },
  biology:   { main: '#5C7A3A', soft: '#EDF2E4' },
  arabic:    { main: '#9C6B1E', soft: '#F7EFDF' },
  english:   { main: '#155E6B', soft: '#E2EEF0' },
  islamic:   { main: '#4E6B4A', soft: '#E8EFE6' },
  social:    { main: '#7A4E3A', soft: '#F2E9E4' },
  default:   { main: '#686868', soft: '#F1EEE7' },
} as const;
export type SubjectColorKey = keyof typeof subjectColors;

export const fontFamily = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
  /** للويب: سلسلة احتياطية كاملة */
  webStack: "'IBM Plex Sans Arabic','Noto Sans Arabic',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif",
} as const;

/** سلّم الخط — دور واحد لكل استخدام، لا أحجام عشوائية */
export const typography = {
  display: { size: 30, lineHeight: 40, family: fontFamily.bold },
  h1:      { size: 24, lineHeight: 34, family: fontFamily.bold },
  h2:      { size: 20, lineHeight: 30, family: fontFamily.semibold },
  h3:      { size: 17, lineHeight: 26, family: fontFamily.semibold },
  body:    { size: 15, lineHeight: 24, family: fontFamily.regular },
  bodyMedium: { size: 15, lineHeight: 24, family: fontFamily.medium },
  small:   { size: 13, lineHeight: 20, family: fontFamily.regular },
  caption: { size: 12, lineHeight: 18, family: fontFamily.medium },
  button:  { size: 15, lineHeight: 22, family: fontFamily.semibold },
  price:   { size: 18, lineHeight: 26, family: fontFamily.bold },
  number:  { size: 15, lineHeight: 22, family: fontFamily.semibold },
} as const;
export type TypographyRole = keyof typeof typography;

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const space = (n: keyof typeof spacing) => spacing[n];

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 } as const;

export const motion = { fast: 150, base: 200, slow: 250 } as const;

/** ظلال خفيفة فقط — لا ظلال مبالغ فيها */
export const shadow = {
  card: { shadowColor: '#171717', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  sheet: { shadowColor: '#171717', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: -4 }, elevation: 8 },
} as const;

export const hitTarget = 44;
export const layout = { screenPadding: 16, cardPadding: 16, maxContentWidth: 640 } as const;

/** نمط عُماني خافت — يُستخدم في الترويسة والـ Splash فقط، وبشفافية ≤ 6٪ */
export const omaniPattern = { opacity: 0.06, cell: 22, stroke: '#C7A461' } as const;

export const tokens = { colors, subjectColors, fontFamily, typography, spacing, radius, motion, shadow, hitTarget, layout, omaniPattern };
export default tokens;
