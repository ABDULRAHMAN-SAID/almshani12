import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Screen, Text, Button, Icon } from '@/ui';

/** الترحيب: جملة واحدة واضحة وفعل واحد — لا مهرجان تراثي */
export default function Welcome() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen bare scroll={false} contentStyle={styles.wrap}>
      <View style={styles.top}>
        <View style={styles.logo}><Text role="display" tone="inverse">{brand.name.ar.slice(0, 1)}</Text></View>
        <Text role="h2" tone="brand">{brand.name.ar}</Text>
        <Text role="caption" tone="secondary">{brand.tagline.ar}</Text>
      </View>
      <View style={styles.middle}>
        <Text role="display" style={styles.title}>{t('onboarding.welcomeTitle')}</Text>
        <Text role="body" tone="secondary" style={styles.body}>{t('onboarding.welcomeBody')}</Text>
        <View style={styles.points}>
          {[['book', 'library.title'], ['video', 'lessons.title'], ['courses', 'courses.title']].map(([icon, key]) => (
            <View key={key} style={styles.point}>
              <View style={styles.pointIcon}><Icon name={icon as never} size={18} color={colors.brand.primary} /></View>
              <Text role="small">{t(key)}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <Button label={t('onboarding.start')} onPress={() => router.push('/(auth)/login')} size="lg" full />
        <Button label={t('onboarding.haveAccount')} onPress={() => router.push('/(auth)/login')} variant="ghost" full />
        <Text role="caption" tone="tertiary" center>{t('onboarding.terms')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'space-between', paddingTop: spacing[10], paddingBottom: spacing[6] },
  top: { alignItems: 'center', gap: spacing[2] },
  logo: { width: 72, height: 72, borderRadius: radius.lg, backgroundColor: colors.brand.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2] },
  middle: { gap: spacing[3] },
  title: { lineHeight: 42 },
  body: { lineHeight: 26 },
  points: { flexDirection: 'row', gap: spacing[4], marginTop: spacing[2], flexWrap: 'wrap' },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pointIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: spacing[3] },
});
