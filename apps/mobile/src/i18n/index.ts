import { I18nManager, Platform } from 'react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar, en, flatten, brand, type Locale } from '@manassah/shared';
import { readPrefsSync } from '@/lib/prefs';

const SUPPORTED = brand.locale.supported as readonly string[];
const DEFAULT_LOCALE = brand.locale.default as Locale;

/** اللغة المحفوظة على هذا الجهاز — تُقرأ قبل أول رسم حتى لا ترتدّ الواجهة للعربية بعد كل تحديث للصفحة */
export const storedLocale = (p: Record<string, unknown> = readPrefsSync()): Locale =>
  SUPPORTED.includes(String(p.locale)) ? (p.locale as Locale) : DEFAULT_LOCALE;

/** العربية أساس؛ كل نصّ عبر مفتاح — لا نصّ مكتوب مباشرة داخل الشاشات */
i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: flatten(ar as unknown as Record<string, unknown>) },
    en: { translation: flatten(en as unknown as Record<string, unknown>) },
  },
  lng: storedLocale(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** اللغة واتجاه الواجهة معاً — الاتجاه يتبع اللغة لا قيمة ثابتة */
export function applyLocale(locale: Locale): void {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  const rtl = locale === 'ar';
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  } else if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(rtl);
  }
}
applyLocale(storedLocale());

export default i18n;
