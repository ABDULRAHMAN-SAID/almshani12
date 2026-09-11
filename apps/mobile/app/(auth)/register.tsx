import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, radius, themed } from '@manassah/tokens';
import { AuthSession, OtpRequestResult, PasswordRegister } from '@manassah/shared';
import { Screen, Text, Button, Input, AuthHeader } from '@/ui';
import { api, errorMessageKey } from '@/api/client';
import { signIn, homeFor, safeBack } from '@/lib/session';

const PHONE_RE = /^(\+?968)?\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * إنشاء حساب بكلمة مرور — بخطوتين: (١) الاسم الكامل (الأول + الأب + القبيلة — العُرف العُماني) + الهاتف
 * والبريد + كلمة مرور، (٢) رمز تحقّق يصل إلى البريد يُثبت أنه فعلاً بريدك قبل إنشاء الحساب. البريد لا
 * الهاتف تحديداً لأنه القناة الوحيدة المضبوطة فعلياً على هذا الخادم (لا مزوّد رسائل نصية بعد).
 */
export default function Register() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();

  const [step, setStep] = useState<'form' | 'code'>('form');
  const [firstName, setFirstName] = useState('');
  const [secondName, setSecondName] = useState('');
  const [tribe, setTribe] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const clear = (k: string) => setErrors(e => ({ ...e, [k]: '' }));

  const submitForm = async () => {
    const errs: Record<string, string> = {};
    if (firstName.trim().length < 2) errs.firstName = t('auth.required');
    if (secondName.trim().length < 2) errs.secondName = t('auth.required');
    if (tribe.trim().length < 2) errs.tribe = t('auth.required');
    if (!PHONE_RE.test(normalizePhone(phone))) errs.phone = t('auth.invalidPhone');
    if (!EMAIL_RE.test(email.trim())) errs.email = t('auth.invalidEmail');
    if (password.length < 8) errs.password = t('auth.passwordTooShort');
    else if (password !== confirmPassword) errs.confirmPassword = t('auth.passwordMismatch');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true); setFormError(null);
    try {
      await api.post('/auth/otp/request', { channel: 'email', target: email.trim().toLowerCase(), locale }, OtpRequestResult, { auth: false });
      setStep('code');
    } catch (e) {
      setFormError(t(errorMessageKey(e)));
    } finally { setLoading(false); }
  };

  const submitCode = async () => {
    if (code.length !== 6) return;
    setLoading(true); setFormError(null);
    try {
      const displayName = [firstName, secondName, tribe].map(s => s.trim()).filter(Boolean).join(' ');
      const session = await api.post('/auth/register', {
        displayName, phone: normalizePhone(phone), email: email.trim().toLowerCase(), password, code, locale,
      } as PasswordRegister, AuthSession, { auth: false });
      await signIn(session);
      router.replace(homeFor(session.user) as never);
    } catch (e) {
      setFormError(t(errorMessageKey(e))); setCode('');
    } finally { setLoading(false); }
  };

  if (step === 'code') {
    return (
      <Screen onBack={() => setStep('form')} title={t('auth.createAccount')} contentStyle={styles.wrap}>
        <AuthHeader />
        <View style={styles.head}>
          <Text role="h1">{t('auth.verifyEmailTitle')}</Text>
          <Text role="body" tone="secondary">{t('auth.verifyEmailBody')} <Text role="bodyMedium" tabular>{email.trim()}</Text></Text>
        </View>
        <Input value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder={t('onboarding.enterCode')} keyboardType="number-pad" numeric autoFocus
          error={formError} onSubmitEditing={submitCode} returnKeyType="send" />
        <Button label={t('auth.createAccountSubmit')} onPress={submitCode} loading={loading} disabled={code.length < 6} size="lg" full />
      </Screen>
    );
  }

  return (
    <Screen onBack={() => safeBack(router)} title={t('auth.createAccount')} contentStyle={styles.wrap}>
      <AuthHeader />
      <View style={styles.head}>
        <Text role="h1">{t('auth.createAccountTitle')}</Text>
        <Text role="body" tone="secondary">{t('auth.createAccountBody')}</Text>
      </View>

      <View style={styles.section}>
        <Text role="caption" tone="tertiary" style={styles.sectionLabel}>{t('auth.fullNameSection')}</Text>
        <Input value={firstName} onChangeText={v => { setFirstName(v); clear('firstName'); }} placeholder={t('auth.firstName')} error={errors.firstName} autoCapitalize="words" autoFocus />
        <Input value={secondName} onChangeText={v => { setSecondName(v); clear('secondName'); }} placeholder={t('auth.secondName')} error={errors.secondName} autoCapitalize="words" />
        <Input value={tribe} onChangeText={v => { setTribe(v); clear('tribe'); }} placeholder={t('auth.tribeName')} error={errors.tribe} autoCapitalize="words" />
      </View>

      <View style={styles.section}>
        <Text role="caption" tone="tertiary" style={styles.sectionLabel}>{t('auth.contactSection')}</Text>
        <View style={styles.phoneRow}>
          <View style={styles.code}><Text role="bodyMedium" tabular>{t('auth.omanCode')}</Text></View>
          <View style={styles.flex}>
            <Input value={phone} onChangeText={v => { setPhone(v); clear('phone'); }} placeholder={t('auth.phonePlaceholder')} keyboardType="phone-pad" numeric error={errors.phone} textContentType="telephoneNumber" autoComplete="tel" />
          </View>
        </View>
        <Input value={email} onChangeText={v => { setEmail(v); clear('email'); }} placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" icon="mail" error={errors.email} textContentType="emailAddress" autoComplete="email" helper={t('auth.emailVerifiedHint')} />
      </View>

      <View style={styles.section}>
        <Text role="caption" tone="tertiary" style={styles.sectionLabel}>{t('auth.password')}</Text>
        <Input value={password} onChangeText={v => { setPassword(v); clear('password'); }} placeholder={t('auth.password')} secureTextEntry error={errors.password} helper={!errors.password ? t('auth.passwordTooShort') : undefined} textContentType="newPassword" autoComplete="password-new" />
        <Input value={confirmPassword} onChangeText={v => { setConfirmPassword(v); clear('confirmPassword'); }} placeholder={t('auth.confirmPassword')} secureTextEntry error={errors.confirmPassword} textContentType="newPassword" autoComplete="password-new" />
      </View>

      {formError ? <Text role="small" tone="danger" center>{formError}</Text> : null}
      <Button label={t('auth.continueToVerify')} onPress={submitForm} loading={loading} size="lg" full />

      <Pressable onPress={() => router.replace('/(auth)/login')} hitSlop={8} style={styles.footerLink} accessibilityRole="link">
        <Text role="small" tone="secondary" center>{t('auth.haveAccountQ')} <Text role="small" tone="link">{t('auth.signIn')}</Text></Text>
      </Pressable>
      <Text role="caption" tone="tertiary" center style={styles.terms}>{t('onboarding.terms')}</Text>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[6] },
  head: { gap: spacing[2] },
  section: { gap: spacing[3] },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.4 },
  phoneRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start' },
  code: { height: 56, paddingHorizontal: spacing[4], borderRadius: radius.md, borderWidth: 2, borderColor: c.border.default, backgroundColor: c.bg.card, justifyContent: 'center' },
  flex: { flex: 1 },
  footerLink: { paddingVertical: spacing[2] },
  terms: { marginTop: spacing[2] },
}));
