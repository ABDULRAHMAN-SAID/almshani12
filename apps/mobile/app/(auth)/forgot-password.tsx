import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, themed } from '@manassah/tokens';
import { AuthSession, OtpRequestResult, ResetPassword, OtpChannel } from '@manassah/shared';
import { Screen, Text, Button, Input, AuthHeader } from '@/ui';
import { api, errorMessageKey } from '@/api/client';
import { signIn, homeFor, safeBack } from '@/lib/session';

const PHONE_RE = /^(\+?968)?\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** استعادة كلمة المرور: رمز تحقّق إلى الهاتف/البريد (نفس /auth/otp/request) ثم رمز + كلمة مرور جديدة معاً */
export default function ForgotPassword() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();

  const [step, setStep] = useState<'target' | 'reset'>('target');
  const [target, setTarget] = useState('');
  const [channel, setChannel] = useState<OtpChannel>('phone');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    const ch: OtpChannel = target.includes('@') ? 'email' : 'phone';
    const valid = ch === 'phone' ? PHONE_RE.test(normalizePhone(target)) : EMAIL_RE.test(target.trim());
    if (!valid) { setError(t('auth.invalidTarget')); return; }
    setLoading(true); setError(null);
    try {
      const normalized = ch === 'phone' ? normalizePhone(target) : target.trim().toLowerCase();
      await api.post('/auth/otp/request', { channel: ch, target: normalized, locale }, OtpRequestResult, { auth: false });
      setChannel(ch); setTarget(normalized); setStep('reset');
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally { setLoading(false); }
  };

  const reset = async () => {
    if (code.length !== 6) { setError(t('onboarding.enterCode')); return; }
    if (newPassword.length < 8) { setError(t('auth.passwordTooShort')); return; }
    if (newPassword !== confirmPassword) { setError(t('auth.passwordMismatch')); return; }
    setLoading(true); setError(null);
    try {
      const session = await api.post('/auth/password/reset', { channel, target, code, newPassword } as ResetPassword, AuthSession, { auth: false });
      await signIn(session);
      router.replace(homeFor(session.user) as never);
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally { setLoading(false); }
  };

  return (
    <Screen onBack={() => safeBack(router)} title={t('auth.forgotPasswordTitle')} contentStyle={styles.wrap}>
      <AuthHeader />
      {step === 'target' ? (
        <>
          <View style={styles.head}>
            <Text role="h1">{t('auth.forgotPasswordTitle')}</Text>
            <Text role="body" tone="secondary">{t('auth.forgotPasswordBody')}</Text>
          </View>
          <Input value={target} onChangeText={v => { setTarget(v); setError(null); }} placeholder={t('auth.emailOrPhone')} autoCapitalize="none" autoFocus
            keyboardType="email-address" error={error} onSubmitEditing={sendCode} returnKeyType="send" icon="mail" />
          <Button label={t('auth.sendResetCode')} onPress={sendCode} loading={loading} disabled={!target} size="lg" full />
        </>
      ) : (
        <>
          <View style={styles.head}>
            <Text role="h1">{t('auth.forgotPasswordTitle')}</Text>
            <Text role="body" tone="secondary">{t('auth.resetCodeSentBody')} <Text role="bodyMedium" tabular>{target}</Text></Text>
          </View>
          <Input value={code} onChangeText={v => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(null); }} placeholder={t('onboarding.enterCode')}
            keyboardType="number-pad" numeric autoFocus />
          <Input value={newPassword} onChangeText={v => { setNewPassword(v); setError(null); }} placeholder={t('auth.newPassword')} secureTextEntry
            textContentType="newPassword" autoComplete="password-new" helper={t('auth.passwordTooShort')} />
          <Input value={confirmPassword} onChangeText={v => { setConfirmPassword(v); setError(null); }} placeholder={t('auth.confirmPassword')} secureTextEntry
            error={error} textContentType="newPassword" autoComplete="password-new" />
          <Button label={t('auth.resetPasswordSubmit')} onPress={reset} loading={loading} disabled={code.length < 6 || !newPassword} size="lg" full />
        </>
      )}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: spacing[4], paddingTop: spacing[4] },
  head: { gap: spacing[2] },
}));
