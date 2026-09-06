export { ar } from './ar';
export { en } from './en';
export type { Dictionary } from './ar';

export const resources = {
  ar: { translation: {} as Record<string, unknown> },
  en: { translation: {} as Record<string, unknown> },
};

/** يحوّل الكائن المتداخل إلى مفاتيح مسطّحة "home.quick.bookTeacher" لاستخدام i18next */
export function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}
