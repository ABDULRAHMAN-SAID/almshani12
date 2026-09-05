import { api, tokens } from './api.js';

/** حالة التطبيق المشتركة مع اشتراكات بسيطة. */
const listeners = new Set();

export const state = {
  user: null,
  instructorProfile: null,
  subscription: null,
  config: null,
  cartCount: 0,
  unread: 0,
  socket: null,
  ready: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(state);
}

export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

export const isLoggedIn = () => !!state.user;
export const isInstructor = () => ['instructor', 'admin'].includes(state.user?.role);
export const isAdmin = () => state.user?.role === 'admin';

/** يحمّل إعدادات المنصّة وبيانات المستخدم عند الإقلاع. */
export async function bootstrap() {
  try {
    state.config = await api.get('/config');
  } catch { state.config = { platform: { name: 'منصّة' }, currency: { symbol: 'ر.ع', decimals: 3 } }; }

  if (tokens.access || tokens.refresh) await refreshUser();
  setState({ ready: true });
}

export async function refreshUser() {
  try {
    const data = await api.get('/auth/me');
    Object.assign(state, {
      user: data.user,
      instructorProfile: data.instructorProfile,
      subscription: data.subscription,
      unread: data.unreadNotifications || 0,
      cartCount: data.cartCount || 0,
    });
    connectSocket();
  } catch {
    Object.assign(state, { user: null, instructorProfile: null, subscription: null, unread: 0, cartCount: 0 });
    tokens.clear();
  }
  emit();
  return state.user;
}

export async function login(email, password) {
  const data = await api.post('/auth/login', { email, password });
  tokens.set(data);
  await refreshUser();
  return data.user;
}

export async function register(payload) {
  const data = await api.post('/auth/register', payload);
  tokens.set(data);
  await refreshUser();
  return data.user;
}

export async function logout() {
  try { await api.post('/auth/logout', { refreshToken: tokens.refresh }); } catch {}
  tokens.clear();
  state.socket?.disconnect();
  setState({ user: null, instructorProfile: null, subscription: null, socket: null, unread: 0, cartCount: 0 });
  location.hash = '#/';
}

/** يربط قناة الوقت الحقيقي للإشعارات وقاعات البثّ. */
export function connectSocket() {
  if (!window.io || !tokens.access) return null;
  if (state.socket?.connected) return state.socket;

  state.socket?.disconnect();
  const socket = window.io({ auth: { token: tokens.access }, transports: ['websocket', 'polling'] });

  socket.on('notification', (notification) => {
    state.unread += 1;
    emit();
    window.dispatchEvent(new CustomEvent('app:notification', { detail: notification }));
  });
  socket.on('connect_error', () => {});

  state.socket = socket;
  return socket;
}

export async function addToCart(itemType, itemId) {
  const result = await api.post('/cart', { item_type: itemType, item_id: itemId });
  setState({ cartCount: result.count });
  return result;
}
