import { brand } from './brand';

/** تقريب حسب خانات العملة (الريال العُماني: ٣ خانات — البيسة) */
export function roundMoney(amount: number, decimals = brand.currency.decimals): number {
  const f = 10 ** decimals;
  return Math.round((Number(amount) || 0) * f) / f;
}

export function formatMoney(
  amount: number,
  { currency = brand.currency.code, decimals = brand.currency.decimals, locale = 'ar' as 'ar' | 'en' } = {},
): string {
  const value = roundMoney(amount, decimals).toFixed(decimals);
  // العربية: الرمز «ر.ع» بعد المبلغ — الإنجليزية: رمز العملة الدولي قبله (OMR 2.500) لا رمز عربي
  const symbol = currency === brand.currency.code ? brand.currency.symbol : currency;
  return locale === 'ar' ? `${value} ${symbol}` : `${currency} ${value}`;
}

/** نسبة التوفير في الباقات — تُحسب في الخادم وتُعرض هنا فقط */
export const savePercent = (listPrice: number, price: number): number =>
  listPrice > 0 ? Math.max(0, Math.round((1 - price / listPrice) * 100)) : 0;
