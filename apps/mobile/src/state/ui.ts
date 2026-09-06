import { create } from 'zustand';
import type { BooksQuery, TeachersQuery } from '@manassah/shared';
import { z } from 'zod';

type BookFilters = Partial<z.infer<typeof BooksQuery>>;
type TeacherFilters = Partial<z.infer<typeof TeachersQuery>>;

/** حالة واجهة خفيفة لا تخصّ الخادم: فلاتر التبويبات وسجلّ البحث */
interface UiState {
  bookFilters: BookFilters;
  teacherFilters: TeacherFilters;
  recentSearches: string[];
  setBookFilters: (f: BookFilters) => void;
  setTeacherFilters: (f: TeacherFilters) => void;
  pushSearch: (q: string) => void;
  clearSearches: () => void;
}

export const useUi = create<UiState>((set) => ({
  bookFilters: {},
  teacherFilters: {},
  recentSearches: [],
  setBookFilters: (f) => set({ bookFilters: f }),
  setTeacherFilters: (f) => set({ teacherFilters: f }),
  pushSearch: (q) => set(s => ({ recentSearches: [q, ...s.recentSearches.filter(x => x !== q)].slice(0, 8) })),
  clearSearches: () => set({ recentSearches: [] }),
}));
