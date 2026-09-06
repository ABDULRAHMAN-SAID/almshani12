import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { AuthMethods, OtpRequestResult, type OtpVia } from '@manassah/shared';
import { Screen, Text, Button, Input, Chip, Icon } from '@/ui';
import { api, ApiError, errorMessageKey } from '@/api/client';

type Channel = 'phone' | 'email';
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
/** ما يُفترض قبل معرفة طرق الخادم (أثناء التحميل أو عند تعذّر الجلب) */
const FALLBACK: AuthMethods = { phone: true, whatsapp: false, email: true, testCode: true };

/** الدخول برمز تحقّق — هاتف (رسالة نصية أو واتساب) أو بريد، بلا كلمات مرور */
export default function Login() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();
  const methodsQ = useQuery({ queryKey: ['auth-methods'], queryFn: () => api.get('/auth/methods', AuthMethods, undefined, { auth: false }), staleTime: 5 * 60_000, retry: 1 });
  const methods = methodsQ.data ?? FALLBACK;
  const [channel, setChannel] = useState<Channel>('phone');
  const [via, setVia] = useState<OtpVia>('sms');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [social, setSocial] = useState<string | null>(null);

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

  const trySocial = async (provider: 'apple' | 'google') => {
    setSocial(null);
    try { await api.post(`/auth/${provider}`, {}, undefined, { auth: false }); }
    catch (e) { setSocial(e instanceof ApiError && e.status === 501 ? t('auth.socialUnavailable') : t(errorMessageKey(e))); }
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

      <View style={styles.divider}><View style={styles.line} /><Text role="caption" tone="tertiary">{t('common.or', { defaultValue: 'أو' })}</Text><View style={styles.line} /></View>
      <View style={styles.socials}>
        <Button label={t('auth.apple')} onPress={() => trySocial('apple')} variant="secondary" full />
        <Button label={t('auth.google')} onPress={() => trySocial('google')} variant="secondary" full />
        {social ? <View style={styles.note}><Icon name="info" size={16} color={colors.state.info} /><Text role="caption" tone="info">{social}</Text></View> : null}
      </View>
      <Text role="caption" tone="tertiary" center style={styles.terms}>{t('onboarding.terms')}</Text>
    </Screen>
  );
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
  note: { flexDirection: 'row', gap: spacing[1], alignItems: 'center', justifyContent: 'center' },
  terms: { marginTop: 'auto' },
}));
