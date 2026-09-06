import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing } from '@manassah/tokens';

export default function LibraryScreen() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg.base, padding: spacing[4] }}>
      <Text style={{ fontFamily: typography.h1.family, fontSize: typography.h1.size, color: colors.text.primary }}>
        {t('library.title')}
      </Text>
    </View>
  );
}
