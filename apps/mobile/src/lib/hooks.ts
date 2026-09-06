import { useEffect, useState } from 'react';

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
