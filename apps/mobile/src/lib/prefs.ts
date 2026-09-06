import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** تفضيلات الواجهة (المظهر، حجم الخط، عنوان الخادم): localStorage على الويب، SecureStore على الجوال */
const KEY = 'mn_prefs';

export function readPrefsSync(): Record<string, unknown> {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export async function readPrefs(): Promise<Record<string, unknown>> {
  if (Platform.OS === 'web') return readPrefsSync();
  try { return JSON.parse((await SecureStore.getItemAsync(KEY)) || '{}'); } catch { return {}; }
}

export function writePrefs(p: Record<string, unknown>): void {
  const s = JSON.stringify(p);
  if (Platform.OS === 'web') { try { localStorage.setItem(KEY, s); } catch { /* خاص/ممنوع */ } return; }
  SecureStore.setItemAsync(KEY, s).catch(() => {});
}
