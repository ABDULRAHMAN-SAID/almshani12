import { brand, formatMoney as sharedFormatMoney } from '@manassah/shared';
import i18n from '@/i18n';

/** الأرقام لاتينية دائماً حتى في العربية — الأسعار والأوقات يجب أن تُقرأ بلا لبس */
const localeFor = () => (i18n.language === 'en' ? 'en-GB' : 'ar-u-nu-latn');
const TZ = brand.timezone;

export const money = (amount: number) =>
  sharedFormatMoney(amount, { locale: i18n.language === 'en' ? 'en' : 'ar' });

export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(localeFor(), { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(iso));

export const formatDay = (iso: string, opts: { weekday?: boolean } = {}) =>
  new Intl.DateTimeFormat(localeFor(), {
    day: 'numeric', month: 'long', ...(opts.weekday ? { weekday: 'long' } : {}), timeZone: TZ,
  }).format(new Date(iso));

export const formatDayShort = (iso: string) =>
  new Intl.DateTimeFormat(localeFor(), { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso));

export const weekdayShort = (iso: string) =>
  new Intl.DateTimeFormat(localeFor(), { weekday: 'short', timeZone: TZ }).format(new Date(iso));

export const formatDateTime = (iso: string) => `${formatDay(iso, { weekday: true })} · ${formatTime(iso)}`;

/** «اليوم» / «غداً» / تاريخ */
export function relativeDay(iso: string): string {
  const d = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString());
  if (d === today) return i18n.t('common.today');
  if (d === tomorrow) return i18n.t('common.tomorrow');
  return formatDay(iso, { weekday: true });
}

export const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(new Date(iso));

export const minutesUntil = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 60_000);

/** عدّاد mm:ss — للمؤقّتات التي تتغيّر كل ثانية (القاعة، الاختبار) */
export const mmss = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;

export function durationLabel(seconds: number): string {
  // أقلّ من دقيقة يُقال بالثواني، لا «٠ دقيقة»
  if (seconds < 60) return `${Math.round(seconds)} ${i18n.t('common.seconds')}`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} ${i18n.t('common.minutes')}`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ${i18n.t('common.hours')} ${r} ${i18n.t('common.minutes')}` : `${h} ${i18n.t('common.hours')}`;
}

export const compactNumber = (n: number) =>
  new Intl.NumberFormat(localeFor(), { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);

/** أحرف الاسم الأولى — بلا أقواس أو أرقام (مثل «عبدالرحمن (١١)» → «ع») */
export const initials = (name: string) =>
  name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0] ?? '').join('');
