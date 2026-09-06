import { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, fontFamily, themed } from '@manassah/tokens';
import { AuthSession, OtpRequestResult, OtpDelivery } from '@manassah/shared';
import { Screen, Text, Button } from '@/ui';
import { api, errorMessageKey } from '@/api/client';
import { signIn, homeFor } from '@/lib/session';

/** ستّ خانات، إدخال واحد مخفيّ خلفها — لصق الرمز يعمل، والتحقّق تلقائي عند اكتمال ٦ أرقام */
export default function Verify() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();
  const p = useLocalSearchParams<{ channel: string; target: string; ttl: string; dev: string; delivery: string; via: string }>();
  const [code, setCode] = useState('');
  // الرمز التجريبي وطريقة الإرسال يتحدّثان عند إعادة الإرسال
  const [dev, setDev] = useState(p.dev ?? '');
  const [delivery, setDelivery] = useState<OtpDelivery>(OtpDelivery.catch(p.channel === 'email' ? 'email' : 'sms').parse(p.delivery));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useState(45);
  const input = useRef<TextInput>(null);

  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(id); }, [left]);

  const verify = async (value: string) => {
    setLoading(true); setError(null);
    try {
      const session = await api.post('/auth/otp/verify', { channel: p.channel, target: p.target, code: value }, AuthSession, { auth: false });
      await signIn(session);
      router.replace(homeFor(session.user) as never);
    } catch (e) {
      setError(t(errorMessageKey(e))); setCode('');
    } finally { setLoading(false); }
  };

  const onChange = (v: string) => {
    const digits = v.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '').slice(0, 6);
    setCode(digits); setError(null);
    if (digits.length === 6) verify(digits);
  };

  /** إعادة الإرسال بنفس الطريقة (رسالة نصية/واتساب) — النتيجة قد تغيّر الرمز التجريبي أو طريقة الوصول */
  const resend = async () => {
    try {
      const r = await api.post('/auth/otp/request', p.channel === 'phone' && p.via ? { channel: p.channel, target: p.target, via: p.via, locale } : { channel: p.channel, target: p.target, locale }, OtpRequestResult, { auth: false });
      setDev(r.devCode ?? ''); setDelivery(r.delivery); setLeft(45); setCode(''); setError(null);
    } catch (e) { setError(t(errorMessageKey(e))); }
  };
  const sentKey = ({ sms: 'auth.sentSms', whatsapp: 'auth.sentWhatsapp', email: 'auth.sentEmail', test: 'auth.sentTest' } as const)[delivery];

  return (
    <Screen onBack={() => router.back()} contentStyle={styles.wrap}>
      <View style={styles.head}>
        <Text role="h1">{t('onboarding.enterCode')}</Text>
        <View style={styles.targetRow}>
          <Text role="body" tone="secondary">{t(sentKey)} </Text>
          <Text role="bodyMedium" tabular>{p.target}</Text>
          <Pressable onPress={() => router.back()} hitSlop={8}><Text role="small" tone="link"> · {t('auth.changeTarget')}</Text></Pressable>
        </View>
        {delivery === 'email' ? <Text role="caption" tone="tertiary">{t('auth.checkSpam')}</Text> : null}
      </View>

      <Pressable onPress={() => input.current?.focus()} style={styles.boxes} accessibilityLabel={t('onboarding.enterCode')}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.box, code.length === i && styles.boxActive, error && styles.boxError]}>
            <Text role="h1" tabular>{code[i] ?? ''}</Text>
          </View>
        ))}
        <TextInput ref={input} value={code} onChangeText={onChange} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code"
          autoFocus maxLength={6} style={styles.hidden} caretHidden />
      </Pressable>
      {error ? <Text role="small" tone="danger" center>{error}</Text> : null}
      {dev ? <Text role="caption" tone="info" center>{t(delivery === 'test' ? 'auth.testCode' : 'auth.devCode', { code: dev })}</Text> : null}

      <Button label={t('onboarding.verify')} onPress={() => verify(code)} loading={loading} disabled={code.length < 6} size="lg" full />
      <Button label={left > 0 ? t('onboarding.resendIn', { s: left }) : t('onboarding.resend')} onPress={resend} disabled={left > 0} variant="ghost" full />
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[5], paddingTop: spacing[4] },
  head: { gap: spacing[2] },
  targetRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  boxes: { flexDirection: 'row', gap: spacing[2], justifyContent: 'center', direction: 'ltr' },
  box: { width: 48, height: 58, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border.default, backgroundColor: c.bg.card, alignItems: 'center', justifyContent: 'center' },
  boxActive: { borderColor: c.border.focus, borderWidth: 2 },
  boxError: { borderColor: c.state.danger },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1, fontFamily: fontFamily.regular },
}));
