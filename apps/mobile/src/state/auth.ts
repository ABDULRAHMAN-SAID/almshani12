import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { User } from '@manassah/shared';

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

/* ---------- حالة المصادقة (منفصلة عن حالة الخادم) ---------- */
interface AuthState {
  user: User | null;
  ready: boolean;
  setUser: (user: User | null) => void;
  setReady: (ready: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  setUser: (user) => set({ user }),
  setReady: (ready) => set({ ready }),
  signOut: async () => { await tokens.clear(); set({ user: null }); },
}));

export const hasRole = (user: User | null, role: User['roles'][number]) => !!user?.roles.includes(role);
export const isTeacher = (user: User | null) => hasRole(user, 'teacher');
