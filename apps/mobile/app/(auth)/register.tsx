import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { spacing, radius, themed } from '@manassah/tokens';
import { AuthMethods, OtpRequestResult, type OtpVia } from '@manassah/shared';
import { Screen, Text, Button, Input, Chip, AuthHeader } from '@/ui';
import { api, errorMessageKey } from '@/api/client';
import { safeBack } from '@/lib/session';

type Channel = 'phone' | 'email';
const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const PHONE_RE = /^(\+?968)?\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** ما يُفترض قبل معرفة طرق الخادم (أثناء التحميل أو عند تعذّر الجلب) */
const FALLBACK: AuthMethods = { phone: true, whatsapp: false, email: true, testCode: true, google: false, apple: false };

/**
 * إنشاء حساب: الاسم الكامل (الأول + الأب + القبيلة — العُرف العُماني)، ثم الهاتف والبريد معاً،
 * فيُختار أحدهما لاستلام رمز التحقّق والآخر يُحفَظ جهة تواصل إضافية بعد التحقّق (verify.tsx).
 * هذا يفي بما اعتاده الناس من صفحات التسجيل الكاملة، بينما يبقى الدخول اللاحق برمز واحد بلا كلمة مرور.
 */
export default function Register() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'ar';
  const router = useRouter();
  const methodsQ = useQuery({ queryKey: ['auth-methods'], queryFn: () => api.get('/auth/methods', AuthMethods, undefined, { auth: false }), staleTime: 5 * 60_000, retry: 1 });
  const methods = methodsQ.data ?? FALLBACK;
  const enabled = (['phone', 'email'] as Channel[]).filter(ch => methods[ch]);

  const [firstName, setFirstName] = useState('');
  const [secondName, setSecondName] = useState('');
  const [tribe, setTribe] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<Channel>('phone');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // قناة واحدة فقط متاحة على الخادم → تُختار تلقائياً
  useEffect(() => { if (enabled.length === 1 && channel !== enabled[0]) setChannel(enabled[0]); }, [enabled.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const phoneValid = phone.trim() === '' || PHONE_RE.test(normalizePhone(phone));
  const emailValid = email.trim() === '' || EMAIL_RE.test(email.trim());
  const chosenValid = channel === 'phone' ? PHONE_RE.test(normalizePhone(phone)) : EMAIL_RE.test(email.trim());

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (firstName.trim().length < 2) errs.firstName = t('auth.required');
    if (secondName.trim().length < 2) errs.secondName = t('auth.required');
    if (tribe.trim().length < 2) errs.tribe = t('auth.required');
    // errs[channel] هو نفسه errs.phone أو errs.email (channel قيمته 'phone' أو 'email') — يستبدل رسالة الصيغة برسالة «الحقل المختار فارغ/غير صالح» لو تعارضتا، وهذا مقصود
    if (!phoneValid) errs.phone = t('auth.invalidPhone');
    if (!emailValid) errs.email = t('auth.invalidEmail');
    if (!chosenValid) errs[channel] = t('auth.invalidTarget');

    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true); setFormError(null);
    try {
      const target = channel === 'phone' ? normalizePhone(phone) : email.trim().toLowerCase();
      const r = await api.post('/auth/otp/request', channel === 'phone' ? { channel, target, via: 'sms' as OtpVia, locale } : { channel, target, locale }, OtpRequestResult, { auth: false });
      const displayName = [firstName, secondName, tribe].map(s => s.trim()).filter(Boolean).join(' ');
      // الحقل الآخر (غير قناة التحقّق) إن كان مكتوباً وصحيحاً يُمرَّر ليُحفظ بعد التحقّق كجهة تواصل إضافية
      const secondaryChannel: Channel | '' = channel === 'phone' ? (email.trim() && emailValid ? 'email' : '') : (phone.trim() && phoneValid ? 'phone' : '');
      const secondaryValue = secondaryChannel === 'email' ? email.trim().toLowerCase() : secondaryChannel === 'phone' ? normalizePhone(phone) : '';
      router.push({
        pathname: '/(auth)/verify',
        params: { channel, target: r.target, ttl: String(r.ttlSeconds), dev: r.devCode ?? '', delivery: r.delivery, via: 'sms', displayName, secondaryChannel, secondaryValue },
      });
    } catch (e) {
      setFormError(t(errorMessageKey(e)));
    } finally { setLoading(false); }
  };

  return (
    <Screen onBack={() => safeBack(router)} title={t('auth.createAccount')} contentStyle={styles.wrap}>
      <AuthHeader />
      <View style={styles.head}>
        <Text role="h1">{t('auth.createAccountTitle')}</Text>
        <Text role="body" tone="secondary">{t('auth.createAccountBody')}</Text>
      </View>

      <View style={styles.section}>
        <Text role="caption" tone="tertiary" style={styles.sectionLabel}>{t('auth.fullNameSection')}</Text>
        <Input value={firstName} onChangeText={v => { setFirstName(v); setErrors(e => ({ ...e, firstName: '' })); }} placeholder={t('auth.firstName')} error={errors.firstName} autoCapitalize="words" autoFocus />
        <Input value={secondName} onChangeText={v => { setSecondName(v); setErrors(e => ({ ...e, secondName: '' })); }} placeholder={t('auth.secondName')} error={errors.secondName} autoCapitalize="words" />
        <Input value={tribe} onChangeText={v => { setTribe(v); setErrors(e => ({ ...e, tribe: '' })); }} placeholder={t('auth.tribeName')} error={errors.tribe} autoCapitalize="words" />
      </View>

      <View style={styles.section}>
        <Text role="caption" tone="tertiary" style={styles.sectionLabel}>{t('auth.contactSection')}</Text>
        <View style={styles.phoneRow}>
          <View style={styles.code}><Text role="bodyMedium" tabular>{t('auth.omanCode')}</Text></View>
          <View style={styles.flex}>
            <Input value={phone} onChangeText={v => { setPhone(v); setErrors(e => ({ ...e, phone: '' })); }}
              placeholder={t('auth.phonePlaceholder')} keyboardType="phone-pad" numeric error={errors.phone} textContentType="telephoneNumber" autoComplete="tel" />
          </View>
        </View>
        <Input value={email} onChangeText={v => { setEmail(v); setErrors(e => ({ ...e, email: '' })); }}
          placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" icon="mail" error={errors.email} textContentType="emailAddress" autoComplete="email" />
      </View>

      {enabled.length > 1 ? (
        <View style={styles.section}>
          <Text role="caption" tone="tertiary" style={styles.sectionLabel}>{t('auth.sendCodeVia')}</Text>
          <View style={styles.chips}>
            {methods.phone ? <Chip label={t('auth.usePhone')} icon="phone" selected={channel === 'phone'} onPress={() => setChannel('phone')} /> : null}
            {methods.email ? <Chip label={t('auth.useEmail')} icon="mail" selected={channel === 'email'} onPress={() => setChannel('email')} /> : null}
          </View>
        </View>
      ) : null}

      {formError ? <Text role="small" tone="danger" center>{formError}</Text> : null}
      <Button label={t('auth.createAccountSubmit')} onPress={submit} loading={loading} size="lg" full />

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
  chips: { flexDirection: 'row', gap: spacing[2] },
  footerLink: { paddingVertical: spacing[2] },
  terms: { marginTop: spacing[2] },
}));
