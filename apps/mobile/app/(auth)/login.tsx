import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip, Icon } from '@/ui';
import { api, ApiError, errorMessageKey } from '@/api/client';

type Channel = 'phone' | 'email';
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** الدخول برمز تحقّق — هاتف أو بريد، بلا كلمات مرور */
export default function Login() {
  const { t } = useTranslation();
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>('phone');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [social, setSocial] = useState<string | null>(null);

  const valid = channel === 'phone' ? /^(\+?968)?\d{8}$/.test(normalizePhone(value)) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

  const submit = async () => {
    if (!valid) { setError(t('auth.invalidTarget')); return; }
    setLoading(true); setError(null);
    try {
      const target = channel === 'phone' ? normalizePhone(value) : value.trim().toLowerCase();
      const r = await api.post<{ ok: true; target: string; ttlSeconds: number; devCode?: string }>('/auth/otp/request', { channel, target }, undefined, { auth: false });
      router.push({ pathname: '/(auth)/verify', params: { channel, target: r.target, ttl: String(r.ttlSeconds), dev: r.devCode ?? '' } });
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
      <View style={styles.chips}>
        <Chip label={t('auth.usePhone')} icon="phone" selected={channel === 'phone'} onPress={() => { setChannel('phone'); setValue(''); setError(null); }} />
        <Chip label={t('auth.useEmail')} icon="mail" selected={channel === 'email'} onPress={() => { setChannel('email'); setValue(''); setError(null); }} />
      </View>
      {channel === 'phone' ? (
        <View style={styles.phoneRow}>
          <View style={styles.code}><Text role="bodyMedium" tabular>{t('auth.omanCode')}</Text></View>
          <View style={styles.flex}>
            <Input value={value} onChangeText={setValue} placeholder={t('auth.phonePlaceholder')} keyboardType="phone-pad" numeric autoFocus
              textContentType="telephoneNumber" autoComplete="tel" error={error} onSubmitEditing={submit} returnKeyType="send" />
          </View>
        </View>
      ) : (
        <Input value={value} onChangeText={setValue} placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" autoFocus
          textContentType="emailAddress" autoComplete="email" error={error} onSubmitEditing={submit} returnKeyType="send" icon="mail" />
      )}
      <Button label={t('onboarding.sendCode')} onPress={submit} loading={loading} disabled={!value} size="lg" full />

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

const styles = StyleSheet.create({
  wrap: { gap: spacing[5], paddingTop: spacing[4] },
  head: { gap: spacing[2] },
  chips: { flexDirection: 'row', gap: spacing[2] },
  phoneRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start' },
  code: { height: 48, paddingHorizontal: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.bg.card, justifyContent: 'center' },
  flex: { flex: 1 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  line: { flex: 1, height: 1, backgroundColor: colors.border.default },
  socials: { gap: spacing[2] },
  note: { flexDirection: 'row', gap: spacing[1], alignItems: 'center', justifyContent: 'center' },
  terms: { marginTop: 'auto' },
});
