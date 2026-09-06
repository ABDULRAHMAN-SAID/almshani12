import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** تفضيلات الواجهة (المظهر، حجم الخط، عنوان الخادم، المتعلّم النشط): localStorage على الويب، SecureStore على الجوال */
const KEY = 'mn_prefs';
/** نسخة في الذاكرة حتى لا يمسح كاتبٌ مفاتيحَ كاتبٍ آخر (المظهر مقابل المتعلّم النشط) */
let cache: Record<string, unknown> | null = null;

export function readPrefsSync(): Record<string, unknown> {
  if (cache) return cache;
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return {};
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cache = {}; }
  return cache!;
}

export async function readPrefs(): Promise<Record<string, unknown>> {
  if (Platform.OS === 'web') return readPrefsSync();
  if (cache) return cache;
  try { cache = JSON.parse((await SecureStore.getItemAsync(KEY)) || '{}'); } catch { cache = {}; }
  return cache!;
}

export function writePrefs(p: Record<string, unknown>): void {
  cache = p;
  const s = JSON.stringify(p);
  if (Platform.OS === 'web') { try { localStorage.setItem(KEY, s); } catch { /* خاص/ممنوع */ } return; }
  SecureStore.setItemAsync(KEY, s).catch(() => {});
}

/** يعدّل مفاتيح بعينها ويُبقي الباقي كما هو */
export function patchPrefs(partial: Record<string, unknown>): void {
  writePrefs({ ...readPrefsSync(), ...partial });
}
