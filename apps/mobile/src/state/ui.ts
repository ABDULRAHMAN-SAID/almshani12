import { create } from 'zustand';
import { Platform } from 'react-native';
import type { BooksQuery, TeachersQuery } from '@manassah/shared';
import { z } from 'zod';
import { readPrefs, readPrefsSync, writePrefs } from '@/lib/prefs';

type BookFilters = Partial<z.infer<typeof BooksQuery>>;
type TeacherFilters = Partial<z.infer<typeof TeachersQuery>>;
export type ThemePref = 'light' | 'dark' | 'system';
export type TextScale = 1 | 1.15;

/** حالة واجهة خفيفة لا تخصّ الخادم: فلاتر التبويبات، سجلّ البحث، وتفضيلات المظهر والاتصال (تُحفَظ محلياً) */
interface UiState {
  bookFilters: BookFilters;
  teacherFilters: TeacherFilters;
  recentSearches: string[];
  themePref: ThemePref;
  textScale: TextScale;
  /** عنوان خادم مخصّص (https://…) — فارغ = الإعداد الافتراضي للبناء */
  serverUrl: string;
  /** هل قُرئت التفضيلات المحفوظة؟ (فوري على الويب، غير متزامن على الجوال) */
  hydrated: boolean;
  setBookFilters: (f: BookFilters) => void;
  setTeacherFilters: (f: TeacherFilters) => void;
  pushSearch: (q: string) => void;
  clearSearches: () => void;
  setThemePref: (t: ThemePref) => void;
  setTextScale: (s: TextScale) => void;
  setServerUrl: (u: string) => void;
}

const PREF_KEYS = ['themePref', 'textScale', 'serverUrl'] as const;
const fromPrefs = (p: Record<string, unknown>) => ({
  themePref: (['light', 'dark', 'system'].includes(String(p.themePref)) ? p.themePref : 'system') as ThemePref,
  textScale: (p.textScale === 1.15 ? 1.15 : 1) as TextScale,
  serverUrl: typeof p.serverUrl === 'string' ? p.serverUrl : '',
});
const initial = { ...fromPrefs(readPrefsSync()), hydrated: Platform.OS === 'web' };

export const useUi = create<UiState>((set, get) => {
  const persist = () => { const s = get(); writePrefs(Object.fromEntries(PREF_KEYS.map(k => [k, s[k]]))); };
  return {
    bookFilters: {},
    teacherFilters: {},
    recentSearches: [],
    ...initial,
    setBookFilters: (f) => set({ bookFilters: f }),
    setTeacherFilters: (f) => set({ teacherFilters: f }),
    pushSearch: (q) => set(s => ({ recentSearches: [q, ...s.recentSearches.filter(x => x !== q)].slice(0, 8) })),
    clearSearches: () => set({ recentSearches: [] }),
    setThemePref: (themePref) => { set({ themePref }); persist(); },
    setTextScale: (textScale) => { set({ textScale }); persist(); },
    setServerUrl: (u) => { set({ serverUrl: u.trim().replace(/\/+$/, '') }); persist(); },
  };
});

/** على الجوال تُقرأ التفضيلات بشكل غير متزامن عند الإقلاع */
export async function hydratePrefs(): Promise<void> {
  const p = await readPrefs();
  useUi.setState({ ...(Object.keys(p).length ? fromPrefs(p) : {}), hydrated: true });
}
