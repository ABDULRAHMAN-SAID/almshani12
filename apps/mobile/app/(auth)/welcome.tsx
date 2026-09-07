import { View, StyleSheet, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, shadow, subjectColors, themed } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Screen, Text, Button, Icon, LiveServerButton, type IconName } from '@/ui';
import { useUi } from '@/state/ui';
import { DEMO_FALLBACK } from '@/api/client';

const features = (): { icon: IconName; key: string; bg: string; fg: string }[] => [
  { icon: 'bookSolid', key: 'library.title', bg: subjectColors.math.soft, fg: subjectColors.math.main },
  { icon: 'videoSolid', key: 'lessons.title', bg: colors.brand.primarySoft, fg: colors.brand.primary },
  { icon: 'playCircle', key: 'courses.title', bg: colors.brand.greenSoft, fg: colors.brand.green },
];

/** الترحيب: شعار كبير، جملة واحدة، ثلاث بلاطات ملوّنة، وزر واحد كبير */
export default function Welcome() {
  const { t } = useTranslation();
  const router = useRouter();
  // = isDemo() لكن متفاعل مع تغيّر العنوان: حزمة عرض بلا خادم مضمَّن ولا عنوان محفوظ → نعرض زرّ الاتصال بالخادم التجريبي
  const demo = useUi(s => DEMO_FALLBACK && !s.serverUrl);
  return (
    <Screen bare scroll={false} contentStyle={styles.wrap}>
      <View style={styles.top}>
        <View style={styles.logo}><Text role="display" tone="inverse" style={styles.logoText}>{brand.name.ar.slice(0, 1)}</Text></View>
        <Text role="h1" tone="brand">{brand.name.ar}</Text>
        <Text role="small" tone="secondary">{brand.tagline.ar}</Text>
      </View>
      <View style={styles.middle}>
        <Text role="display" center style={styles.title}>{t('onboarding.welcomeTitle')}</Text>
        <Text role="body" tone="secondary" center style={styles.body}>{t('onboarding.welcomeBody')}</Text>
        <View style={styles.tiles}>
          {features().map(f => (
            <View key={f.key} style={[styles.tile, { backgroundColor: f.bg }]}>
              <View style={styles.tileIcon}><Icon name={f.icon} size={26} color={f.fg} /></View>
              <Text role="caption" color={f.fg} center>{t(f.key)}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <Button label={t('onboarding.start')} onPress={() => router.push('/(auth)/login')} size="lg" full iconEnd="forward" />
        <Button label={t('onboarding.haveAccount')} onPress={() => router.push('/(auth)/login')} variant="secondary" full />
        {/* نسخة العرض: زرّ يقرأ عنوان الخادم التجريبي الحالي من السجلّ ويتّصل به — على الويب والجوال معاً */}
        {demo ? <LiveServerButton full /> : null}
        <Text role="caption" tone="tertiary" center>{t('onboarding.terms')}</Text>
        {/* رابط تحميل تطبيق أندرويد — على الويب فقط؛ داخل التطبيق لا معنى له */}
        {Platform.OS === 'web' ? (
          <Pressable onPress={() => router.push('/get-app')} hitSlop={8} accessibilityRole="link" style={styles.getApp}>
            <Text role="caption" tone="link" center>{t('getApp.link')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { justifyContent: 'space-between', paddingTop: spacing[10], paddingBottom: spacing[6] },
  top: { alignItems: 'center', gap: spacing[1] },
  logo: { width: 96, height: 96, borderRadius: radius.xl, backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[3], borderBottomWidth: 6, borderBottomColor: c.brand.primaryDark, ...shadow.raised },
  logoText: { fontSize: 52, lineHeight: 70 },
  middle: { gap: spacing[3], alignItems: 'center' },
  title: { lineHeight: 48 },
  body: { maxWidth: 320 },
  tiles: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[3], alignSelf: 'stretch' },
  tile: { flex: 1, alignItems: 'center', gap: spacing[2], paddingVertical: spacing[4], borderRadius: radius.lg },
  tileIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg.card, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: spacing[3] },
  getApp: { alignSelf: 'center', marginTop: -spacing[1] },
}));
