import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar, en, flatten, brand } from '@manassah/shared';

/** العربية أساس؛ كل نصّ عبر مفتاح — لا نصّ مكتوب مباشرة داخل الشاشات */
i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: flatten(ar as unknown as Record<string, unknown>) },
    en: { translation: flatten(en as unknown as Record<string, unknown>) },
  },
  lng: brand.locale.default,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
