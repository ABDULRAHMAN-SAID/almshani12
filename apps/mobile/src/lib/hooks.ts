import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** قيمة مؤجّلة للبحث أثناء الكتابة */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** عدّاد ثوانٍ ينزل حتى الصفر (للمهل) */
export function useCountdown(untilIso: string | null | undefined): number {
  const calc = () => (untilIso ? Math.max(0, Math.round((new Date(untilIso).getTime() - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => { setLeft(calc()); const id = setInterval(() => setLeft(calc()), 1000); return () => clearInterval(id); }, [untilIso]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

export type ServerProbeState = { state: 'idle' | 'testing' | 'ok' | 'fail'; info?: string };

/** يطرق /api/health على عنوان خادم كامل (مهلة ٨ ثوانٍ) ويعرض النتيجة والزمن — مشترك بين شاشتَي الإعدادات والاتصال بخادم */
export function useServerProbe() {
  const { t } = useTranslation();
  const [probe, setProbe] = useState<ServerProbeState>({ state: 'idle' });
  const reset = () => setProbe({ state: 'idle' });
  const fail = (info: string) => setProbe({ state: 'fail', info });
  const test = async (base: string) => {
    setProbe({ state: 'testing' });
    const t0 = Date.now();
    try {
      const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${base}/api/health`, { signal: ctrl.signal }); clearTimeout(id);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) setProbe({ state: 'ok', info: `${[j.name, j.env].filter(Boolean).join(' · ')} · ${Date.now() - t0} ms` });
      else setProbe({ state: 'fail', info: `HTTP ${r.status}` });
    } catch (e) { setProbe({ state: 'fail', info: e instanceof Error && e.name === 'AbortError' ? t('settings.serverTimeout') : t('errors.network') }); }
  };
  return { probe, test, reset, fail };
}
