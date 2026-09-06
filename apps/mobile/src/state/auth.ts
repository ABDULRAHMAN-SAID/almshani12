import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { User, Learner, Role } from '@manassah/shared';
import { readPrefs, readPrefsSync, patchPrefs } from '@/lib/prefs';

/* ---------- تخزين الرموز: SecureStore على الجوال، localStorage على الويب ---------- */
const KEY_ACCESS = 'mn_access';
const KEY_REFRESH = 'mn_refresh';

async function readKey(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return await SecureStore.getItemAsync(key);
  } catch { return null; }
}
async function writeKey(key: string, value: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      return;
    }
    value == null ? await SecureStore.deleteItemAsync(key) : await SecureStore.setItemAsync(key, value);
  } catch { /* تخزين غير متاح — الجلسة تبقى في الذاكرة */ }
}

/** نسخة متزامنة في الذاكرة يقرأها عميل الـ API بلا await */
export const tokens = {
  access: null as string | null,
  refresh: null as string | null,
  async load() {
    this.access = await readKey(KEY_ACCESS);
    this.refresh = await readKey(KEY_REFRESH);
  },
  async set(access: string | null, refresh: string | null) {
    this.access = access; this.refresh = refresh;
    await Promise.all([writeKey(KEY_ACCESS, access), writeKey(KEY_REFRESH, refresh)]);
  },
  async clear() { await this.set(null, null); },
};

/* ---------- المتعلّمون: اختيارات صرفة على المستخدم ---------- */
const EMPTY: Learner[] = [];
/** المتعلّم الافتراضي: الذات أولاً ثم الأول في الترتيب */
export const defaultLearner = (user: User | null | undefined): Learner | null => user?.learners.find(l => l.isSelf) ?? user?.learners[0] ?? null;
/** المبدّل يظهر عند تعدّد المتعلّمين، أو عند متعلّم واحد ليس صاحب الحساب (وليّ أمر) */
export const showSwitcher = (user: User | null | undefined): boolean => { const n = user?.learners.length ?? 0; return n > 1 || (n === 1 && !user!.learners[0].isSelf); };

const PREF_KEY = 'activeLearnerId';
const readLearnerPref = (p: Record<string, unknown>): number | null => (typeof p[PREF_KEY] === 'number' && (p[PREF_KEY] as number) > 0 ? (p[PREF_KEY] as number) : null);

/** آثار تبديل المتعلّم (إبلاغ الخادم/العرض وإبطال الاستعلامات) — تُسجَّل من session.ts لتجنّب الاستيراد الدائري مع عميل الـ API */
let learnerEffects: ((id: number | null) => void) | null = null;
export const setLearnerEffects = (fn: (id: number | null) => void) => { learnerEffects = fn; };

/* ---------- حالة المصادقة (منفصلة عن حالة الخادم) ---------- */
interface AuthState {
  user: User | null;
  ready: boolean;
  /** المتعلّم النشط على هذا الجهاز — يُرسَل في ترويسة X-Learner-Id */
  activeLearnerId: number | null;
  setUser: (user: User | null) => void;
  setReady: (ready: boolean) => void;
  setActiveLearner: (id: number | null) => void;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  activeLearnerId: readLearnerPref(readPrefsSync()),
  setUser: (user) => {
    // نُبقي اختيار الجهاز إن كان ما زال من متعلّمي الحساب، وإلا حقيقة الخادم ثم الافتراضي
    const ids = user?.learners.map(l => l.id) ?? [];
    let id = get().activeLearnerId;
    if (!id || !ids.includes(id)) id = user?.activeLearnerId && ids.includes(user.activeLearnerId) ? user.activeLearnerId : (defaultLearner(user)?.id ?? null);
    set({ user, activeLearnerId: id });
    patchPrefs({ [PREF_KEY]: id });
  },
  setReady: (ready) => set({ ready }),
  setActiveLearner: (id) => {
    if (id === get().activeLearnerId) return;
    set({ activeLearnerId: id });
    patchPrefs({ [PREF_KEY]: id });
    learnerEffects?.(id);
  },
  signOut: async () => { await tokens.clear(); set({ user: null, activeLearnerId: null }); patchPrefs({ [PREF_KEY]: null }); },
}));

/** على الجوال تُقرأ التفضيلات بشكل غير متزامن — تُستدعى قبل أول setUser عند الإقلاع */
export async function hydrateActiveLearner(): Promise<void> {
  if (Platform.OS === 'web') return;
  const id = readLearnerPref(await readPrefs());
  if (id) useAuth.setState({ activeLearnerId: id });
}

/** المتعلّم النشط كاملاً (أو الافتراضي عندما لا يوجد اختيار صالح) */
export const useActiveLearner = () => useAuth(s => s.user?.learners.find(l => l.id === s.activeLearnerId) ?? defaultLearner(s.user));
export const useLearners = () => useAuth(s => s.user?.learners ?? EMPTY);

export const hasRole = (user: User | null, role: Role) => !!user?.roles.includes(role);
export const isTeacher = (user: User | null) => hasRole(user, 'teacher');
const STAFF: Role[] = ['content_reviewer', 'support', 'finance', 'admin', 'super_admin'];
/** طاقم المنصّة (أي دور من مراجع المحتوى فصاعداً) — لا يحتاج متعلّماً */
export const isStaff = (user: User | null) => !!user?.roles.some(r => STAFF.includes(r));
/** حساب بلا أي متعلّم وليس معلّماً ولا طاقماً → شاشة الإعداد */
export const needsSetup = (user: User | null) => !!user && user.learners.length === 0 && !isTeacher(user) && !isStaff(user);
