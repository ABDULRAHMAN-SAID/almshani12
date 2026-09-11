import { useEffect, useRef, useState } from 'react';
import { View, Platform, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, themed } from '@manassah/tokens';
import { AuthMethods, AuthSession, PasswordLogin, OtpChannel } from '@manassah/shared';
import { Screen, Text, Button, Input, Icon, AuthHeader } from '@/ui';
import { api, ApiError, errorMessageKey } from '@/api/client';
import { useServerConfig } from '@/api/config';
import { signIn, homeFor, safeBack } from '@/lib/session';
import { renderGoogleButton, appleWebSignIn, appleNativeSignIn, loadAppleNative, loadGoogleNative, hasGoogleNative, GOOGLE_NATIVE_IDS, type AppleResult } from '@/lib/social';

type Locale = 'ar' | 'en';
const PHONE_RE = /^(\+?968)?\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
/** ما يُفترض قبل معرفة طرق الخادم (أثناء التحميل أو عند تعذّر الجلب) */
const FALLBACK: AuthMethods = { phone: true, whatsapp: false, email: true, testCode: true, google: false, apple: false };

/** الدخول برقم الهاتف أو البريد وكلمة مرور — أو بحساب Google/Apple حين يضبطهما الخادم */
export default function Login() {
  const { t, i18n } = useTranslation();
  const locale: Locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();
  const methodsQ = useQuery({ queryKey: ['auth-methods'], queryFn: () => api.get('/auth/methods', AuthMethods, undefined, { auth: false }), staleTime: 5 * 60_000, retry: 1 });
  const methods = methodsQ.data ?? FALLBACK;
  const cfg = useServerConfig().data;

  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [social, setSocial] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState(false);

  const channel: OtpChannel = target.includes('@') ? 'email' : 'phone';
  const valid = channel === 'phone' ? PHONE_RE.test(normalizePhone(target)) : EMAIL_RE.test(target.trim());

  const submit = async () => {
    if (!valid) { setError(t('auth.invalidTarget')); return; }
    if (!password) { setError(t('auth.required')); return; }
    setLoading(true); setError(null);
    try {
      const normalized = channel === 'phone' ? normalizePhone(target) : target.trim().toLowerCase();
      const session = await api.post('/auth/login', { channel, target: normalized, password } as PasswordLogin, AuthSession, { auth: false });
      await signIn(session);
      router.replace(homeFor(session.user) as never);
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally { setLoading(false); }
  };

  /* ---------- الدخول الاجتماعي: الأزرار تظهر فقط حين يضبط الخادم المعرّفات ---------- */
  const googleWebId = cfg?.auth?.google ?? null;
  const appleServicesId = cfg?.auth?.apple?.servicesId ?? null;
  const web = Platform.OS === 'web';
  const showGoogle = !!googleWebId && (web || (methods.google && hasGoogleNative()));
  const showApple = web ? !!appleServicesId && methods.apple : Platform.OS === 'ios' && !!cfg?.auth?.apple?.native && methods.apple;

  /** الرمز وصل من المزوّد → الخادم يتحقّق ويصدر الجلسة */
  const finish = async (provider: 'google' | 'apple', body: Record<string, unknown>) => {
    setSocial(null); setSocialBusy(true);
    try {
      const session = await api.post(`/auth/${provider}`, { ...body, locale }, AuthSession, { auth: false });
      await signIn(session);
      router.replace(homeFor(session.user) as never);
    } catch (e) {
      setSocial(e instanceof ApiError && e.status === 501 ? t('auth.socialUnavailable') : e instanceof ApiError && e.status === 401 ? t('auth.socialFailed') : t(errorMessageKey(e)));
    } finally { setSocialBusy(false); }
  };
  const onApple = (r: AppleResult | null) => { if (r) finish('apple', { identityToken: r.identityToken, fullName: r.fullName ?? undefined }); };
  const socialFail = () => setSocial(t('auth.socialFailed'));

  const appleSignIn = async () => {
    setSocial(null);
    try {
      if (web) { onApple(await appleWebSignIn(appleServicesId!)); return; }
      const A = loadAppleNative();
      if (!A || !(await A.isAvailableAsync().catch(() => false))) { socialFail(); return; }
      onApple(await appleNativeSignIn(A));
    } catch { socialFail(); }
  };

  return (
    <Screen onBack={() => safeBack(router)} title={t('ui.login')} contentStyle={styles.wrap}>
      <AuthHeader />
      <View style={styles.head}>
        <Text role="h1">{t('auth.welcomeBack')}</Text>
        <Text role="body" tone="secondary">{t('auth.loginBody')}</Text>
      </View>

      <Input value={target} onChangeText={v => { setTarget(v); setError(null); }} placeholder={t('auth.emailOrPhone')} autoCapitalize="none" autoFocus
        keyboardType="email-address" textContentType="username" autoComplete="username" icon="mail" />
      <Input value={password} onChangeText={v => { setPassword(v); setError(null); }} placeholder={t('auth.password')} secureTextEntry error={error}
        textContentType="password" autoComplete="password" onSubmitEditing={submit} returnKeyType="send" />

      <Pressable onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8} style={styles.forgotLink} accessibilityRole="link">
        <Text role="small" tone="link">{t('auth.forgotPassword')}</Text>
      </Pressable>

      <Button label={t('auth.loginSubmit')} onPress={submit} loading={loading} disabled={!target || !password} size="lg" full />

      {showGoogle || showApple ? (<>
        <View style={styles.divider}><View style={styles.line} /><Text role="caption" tone="tertiary">{t('common.or')}</Text><View style={styles.line} /></View>
        <View style={styles.socials}>
          {showApple ? <Button label={t('auth.apple')} onPress={appleSignIn} variant="secondary" full loading={socialBusy} /> : null}
          {showGoogle && web ? <GoogleWebButton clientId={googleWebId!} locale={locale} onToken={idToken => finish('google', { idToken })} onError={socialFail} />
            : showGoogle ? <GoogleNativeButton webClientId={googleWebId!} label={t('auth.google')} busy={socialBusy} onToken={idToken => finish('google', { idToken })} onError={socialFail} /> : null}
          {social ? <View style={styles.note}><Icon name="info" size={16} color={colors.state.info} /><Text role="caption" tone="info">{social}</Text></View> : null}
        </View>
      </>) : null}
      <Pressable onPress={() => router.push('/(auth)/register')} hitSlop={8} style={styles.footerLink} accessibilityRole="link">
        <Text role="small" tone="secondary" center>{t('auth.noAccountQ')} <Text role="small" tone="link">{t('auth.createAccount')}</Text></Text>
      </Pressable>
      <Text role="caption" tone="tertiary" center style={styles.terms}>{t('onboarding.terms')}</Text>
    </Screen>
  );
}

/** زرّ Google الرسمي (Google Identity Services) — يُرسم داخل View يمرّر عنصر DOM على الويب */
function GoogleWebButton({ clientId, locale, onToken, onError }: { clientId: string; locale: Locale; onToken: (t: string) => void; onError: () => void }) {
  const ref = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const cb = useRef(onToken); cb.current = onToken;
  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || !width || typeof document === 'undefined') return;
    let live = true;
    renderGoogleButton(el, clientId, locale, width, tok => { if (live) cb.current(tok); }).catch(() => { if (live) onError(); });
    return () => { live = false; };
  }, [clientId, locale, width]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View ref={ref} style={styles.gsi} onLayout={e => setWidth(e.nativeEvent.layout.width)} />;
}

/** Google على الجوال عبر expo-auth-session — يظهر فقط حين تُضمَّن معرّفات iOS/Android وقت البناء */
function GoogleNativeButton({ webClientId, label, busy, onToken, onError }: { webClientId: string; label: string; busy: boolean; onToken: (t: string) => void; onError: () => void }) {
  const G = useRef(loadGoogleNative()).current;
  if (!G) return null;
  return <GoogleNativeInner G={G} webClientId={webClientId} label={label} busy={busy} onToken={onToken} onError={onError} />;
}
function GoogleNativeInner({ G, webClientId, label, busy, onToken, onError }: { G: NonNullable<ReturnType<typeof loadGoogleNative>>; webClientId: string; label: string; busy: boolean; onToken: (t: string) => void; onError: () => void }) {
  const [request, response, promptAsync] = G.useIdTokenAuthRequest({ iosClientId: GOOGLE_NATIVE_IDS.ios || undefined, androidClientId: GOOGLE_NATIVE_IDS.android || undefined, webClientId });
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success' && response.params.id_token) onToken(response.params.id_token);
    else if (response.type === 'error') onError();
  }, [response]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Button label={label} variant="secondary" full loading={busy} disabled={!request} onPress={() => { promptAsync().catch(onError); }} />;
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[4], paddingTop: spacing[4] },
  head: { gap: spacing[2] },
  forgotLink: { alignSelf: 'flex-start' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  line: { flex: 1, height: 1.5, backgroundColor: c.border.default },
  socials: { gap: spacing[2] },
  gsi: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: spacing[1], alignItems: 'center', justifyContent: 'center' },
  footerLink: { paddingVertical: spacing[2] },
  terms: { marginTop: spacing[2] },
}));
