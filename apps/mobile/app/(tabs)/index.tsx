import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing } from '@manassah/tokens';

/** مؤقّت — يُستبدل بالشاشة الرئيسية الحقيقية بعد بناء نظام التصميم */
export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg.base, padding: spacing[4], justifyContent: 'center' }}>
      <Text style={{ fontFamily: typography.h1.family, fontSize: typography.h1.size, color: colors.text.primary, textAlign: 'right' }}>
        {t('home.heroTitle')}
      </Text>
      <Text style={{ fontFamily: typography.body.family, fontSize: typography.body.size, color: colors.text.secondary, textAlign: 'right', marginTop: spacing[2] }}>
        {t('onboarding.welcomeBody')}
      </Text>
    </View>
  );
}
