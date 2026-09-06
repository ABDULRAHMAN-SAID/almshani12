import { useEffect, useRef, useState } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { AuthMethods, AuthSession, OtpRequestResult, type OtpVia } from '@manassah/shared';
import { Screen, Text, Button, Input, Chip, Icon } from '@/ui';
import { api, ApiError, errorMessageKey } from '@/api/client';
import { useServerConfig } from '@/api/config';
import { signIn, homeFor } from '@/lib/session';
import { renderGoogleButton, appleWebSignIn, appleNativeSignIn, loadAppleNative, loadGoogleNative, hasGoogleNative, GOOGLE_NATIVE_IDS, type AppleResult } from '@/lib/social';

type Channel = 'phone' | 'email';
type Locale = 'ar' | 'en';
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
/** ما يُفترض قبل معرفة طرق الخادم (أثناء التحميل أو عند تعذّر الجلب) */
const FALLBACK: AuthMethods = { phone: true, whatsapp: false, email: true, testCode: true, google: false, apple: false };

/** الدخول برمز تحقّق — هاتف (رسالة نصية أو واتساب) أو بريد، بلا كلمات مرور — أو بحساب Google/Apple حين يضبطهما الخادم */
export default function Login() {
  const { t, i18n } = useTranslation();
  const locale: Locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();
  const methodsQ = useQuery({ queryKey: ['auth-methods'], queryFn: () => api.get('/auth/methods', AuthMethods, undefined, { auth: false }), staleTime: 5 * 60_000, retry: 1 });
  const methods = methodsQ.data ?? FALLBACK;
  const cfg = useServerConfig().data;
  const [channel, setChannel] = useState<Channel>('phone');
  const [via, setVia] = useState<OtpVia>('sms');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [social, setSocial] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState(false);

  // قناة واحدة فقط متاحة → تُختار تلقائياً ولا صفّ شرائح
  const enabled = (['phone', 'email'] as Channel[]).filter(ch => methods[ch]);
  const single = enabled.length === 1 ? enabled[0] : null;
  useEffect(() => { if (single && channel !== single) { setChannel(single); setValue(''); setError(null); } }, [single, channel]);

  const valid = channel === 'phone' ? /^(\+?968)?\d{8}$/.test(normalizePhone(value)) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
  const pick = (ch: Channel) => { setChannel(ch); setValue(''); setError(null); };

  const submit = async () => {
    if (!valid) { setError(t('auth.invalidTarget')); return; }
    setLoading(true); setError(null);
    try {
      const target = channel === 'phone' ? normalizePhone(value) : value.trim().toLowerCase();
      const r = await api.post('/auth/otp/request', channel === 'phone' ? { channel, target, via, locale } : { channel, target, locale }, OtpRequestResult, { auth: false });
      router.push({ pathname: '/(auth)/verify', params: { channel, target: r.target, ttl: String(r.ttlSeconds), dev: r.devCode ?? '', delivery: r.delivery, via } });
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally { setLoading(false); }
  };

  /* ---------- الدخول الاجتماعي: الأزرار تظهر فقط حين يضبط الخادم المعرّفات ---------- */
  const googleWebId = cfg?.auth?.google ?? null;
  const appleServicesId = cfg?.auth?.apple?.servicesId ?? null;
  const web = Platform.OS === 'web';
  const showGoogle = !!googleWebId && (web || (methods.google && hasGoogleNative()));
  // الويب: Services ID + تفعيل الخادم معاً (وإلا يردّ 501 بعد النافذة المنبثقة)
  const showApple = web ? !!appleServicesId && methods.apple : Platform.OS === 'ios' && !!cfg?.auth?.apple?.native && methods.apple;

  /** الرمز وصل من المزوّد → الخادم يتحقّق ويصدر الجلسة */
  const finish = async (provider: 'google' | 'apple', body: Record<string, unknown>) => {
    setSocial(null); setSocialBusy(true);
    try {
      const session = await api.post(`/auth/${provider}`, { ...body, locale }, AuthSession, { auth: false });
      await signIn(session);
      router.replace(homeFor(session.user) as never);
    } catch (e) {
      // 501 = المزوّد غير مضبوط على الخادم؛ 401 = رمز الهوية مرفوض (ليس انتهاء جلسة)
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
      // بعض الأجهزة/المحاكيات لا تدعم الدخول بـ Apple — نتحقّق قبل فتح النافذة
      if (!A || !(await A.isAvailableAsync().catch(() => false))) { socialFail(); return; }
      onApple(await appleNativeSignIn(A));
    } catch { socialFail(); }
  };

  return (
    <Screen onBack={() => router.back()} title={t('ui.login')} contentStyle={styles.wrap}>
      <View style={styles.head}>
        <Text role="h1">{t('auth.otpTitle')}</Text>
        <Text role="body" tone="secondary">{t('auth.otpBody')}</Text>
      </View>
      {enabled.length === 0 ? (
        // الخادم لم يفعّل أي طريقة بعد (لا مزوّد ولا رمز ثابت) — لا نعرض نموذجاً لا يعمل
        <View style={styles.head}>
          <Text role="body" tone="secondary">{t('auth.phoneUnavailable')}</Text>
          <Text role="body" tone="secondary">{t('auth.emailUnavailable')}</Text>
        </View>
      ) : (<>
      {enabled.length > 1 ? (
        <View style={styles.chips}>
          {methods.phone ? <Chip label={t('auth.usePhone')} icon="phone" selected={channel === 'phone'} onPress={() => pick('phone')} /> : null}
          {methods.email ? <Chip label={t('auth.useEmail')} icon="mail" selected={channel === 'email'} onPress={() => pick('email')} /> : null}
        </View>
      ) : null}
      {channel === 'phone' ? (
        <View style={styles.phoneBlock}>
          <View style={styles.phoneRow}>
            <View style={styles.code}><Text role="bodyMedium" tabular>{t('auth.omanCode')}</Text></View>
            <View style={styles.flex}>
              <Input value={value} onChangeText={setValue} placeholder={t('auth.phonePlaceholder')} keyboardType="phone-pad" numeric autoFocus
                textContentType="telephoneNumber" autoComplete="tel" error={error} onSubmitEditing={submit} returnKeyType="send" />
            </View>
          </View>
          {methods.whatsapp ? (
            <View style={styles.viaRow}>
              <Text role="caption" tone="secondary">{t('auth.sendVia')}</Text>
              <Chip label={t('auth.viaSms')} icon="chat" small selected={via === 'sms'} onPress={() => setVia('sms')} />
              <Chip label={t('auth.viaWhatsapp')} icon="chatSolid" small selected={via === 'whatsapp'} onPress={() => setVia('whatsapp')} />
            </View>
          ) : null}
        </View>
      ) : (
        <Input value={value} onChangeText={setValue} placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" autoFocus
          textContentType="emailAddress" autoComplete="email" error={error} onSubmitEditing={submit} returnKeyType="send" icon="mail" />
      )}
      <Button label={t('onboarding.sendCode')} onPress={submit} loading={loading} disabled={!value} size="lg" full />
      </>)}

      {showGoogle || showApple ? (<>
        <View style={styles.divider}><View style={styles.line} /><Text role="caption" tone="tertiary">{t('common.or')}</Text><View style={styles.line} /></View>
        <View style={styles.socials}>
          {showApple ? <Button label={t('auth.apple')} onPress={appleSignIn} variant="secondary" full loading={socialBusy} /> : null}
          {showGoogle && web ? <GoogleWebButton clientId={googleWebId!} locale={locale} onToken={idToken => finish('google', { idToken })} onError={socialFail} />
            : showGoogle ? <GoogleNativeButton webClientId={googleWebId!} label={t('auth.google')} busy={socialBusy} onToken={idToken => finish('google', { idToken })} onError={socialFail} /> : null}
          {social ? <View style={styles.note}><Icon name="info" size={16} color={colors.state.info} /><Text role="caption" tone="info">{social}</Text></View> : null}
        </View>
      </>) : null}
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
  wrap: { gap: spacing[5], paddingTop: spacing[4] },
  head: { gap: spacing[2] },
  chips: { flexDirection: 'row', gap: spacing[2] },
  phoneBlock: { gap: spacing[3] },
  phoneRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start' },
  viaRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'center', flexWrap: 'wrap' },
  code: { height: 56, paddingHorizontal: spacing[4], borderRadius: radius.md, borderWidth: 2, borderColor: c.border.default, backgroundColor: c.bg.card, justifyContent: 'center' },
  flex: { flex: 1 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  line: { flex: 1, height: 1.5, backgroundColor: c.border.default },
  socials: { gap: spacing[2] },
  gsi: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: spacing[1], alignItems: 'center', justifyContent: 'center' },
  terms: { marginTop: 'auto' },
}));
