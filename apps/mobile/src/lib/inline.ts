/**
 * النسخة أحادية الملف (scripts/single-file.mjs) تحقن كل الأصول (خطوط، pdf.js، ملفات العرض) داخل الصفحة
 * تحت window.__MN_INLINE__ مفهرسةً بمسارها. خارج تلك النسخة تعيد الدالة null ويعمل التطبيق كالمعتاد.
 */
export function inlineAssets(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  const m = (window as unknown as { __MN_INLINE__?: Record<string, string> }).__MN_INLINE__;
  return m && typeof m === 'object' ? m : null;
}

/** المسار الذي فُهرس به الأصل: بلا مضيف ولا استعلام */
export function inlineKey(url: string): string {
  try { return new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://x/').pathname; } catch { return url.split('?')[0]; }
}
