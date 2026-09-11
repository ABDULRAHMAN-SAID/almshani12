/**
 * إعداد العلامة — المكان الوحيد لتغيير الاسم والشعار والألوان الرئيسية.
 * الاسم مؤقت؛ غيّره هنا فيتغيّر في التطبيق والخادم ولوحة الإدارة.
 */
export const brand = {
  name: { ar: 'نبراس', en: 'Nibras' },
  tagline: { ar: 'منصّتك التعليمية — مدرستك ومكتبتك ومعلّمك في مكان واحد', en: 'Your learning platform — school, library and tutor in one place' },
  /** مسار الشعار داخل assets — يُستبدَل بشعار العلامة النهائي */
  logo: { mark: 'brand/mark.png', wordmark: 'brand/wordmark.png' },
  /** الألوان الرئيسية — تُغذّي tokens.colors.brand عند الحاجة لتغيير الهوية */
  colors: { primary: '#9E1B32', primaryDark: '#751426', accent: '#C7A461' },
  support: { email: 'support@example.om', whatsapp: '+968 0000 0000' },
  locale: { default: 'ar', supported: ['ar', 'en'] as const },
  currency: { code: 'OMR', symbol: 'ر.ع', decimals: 3 },
  timezone: 'Asia/Muscat',
  country: { code: 'OM', name: { ar: 'سلطنة عُمان', en: 'Oman' } },
  urls: { terms: '/legal/terms', privacy: '/legal/privacy' },
  scheme: 'manassah',
} as const;

export type Locale = (typeof brand.locale.supported)[number];
