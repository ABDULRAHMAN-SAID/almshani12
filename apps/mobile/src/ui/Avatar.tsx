import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';
import { initials } from '@/lib/format';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
const SIZES: Record<AvatarSize, number> = { sm: 32, md: 44, lg: 64, xl: 96 };

export interface AvatarProps {
  name: string;
  url?: string | null;
  size?: AvatarSize;
  verified?: boolean;
}

/** صورة أو حرفان من الاسم — بلا صور عشوائية */
export function Avatar({ name, url, size = 'md', verified }: AvatarProps) {
  const px = SIZES[size];
  return (
    <View style={{ width: px, height: px }}>
      {url ? (
        <Image source={{ uri: url }} style={[styles.img, { width: px, height: px, borderRadius: px / 2 }]} contentFit="cover" transition={150} accessibilityLabel={name} />
      ) : (
        <View style={[styles.fallback, { width: px, height: px, borderRadius: px / 2 }]} accessibilityLabel={name}>
          <Text role={size === 'sm' ? 'caption' : size === 'xl' ? 'h1' : 'h3'} color={colors.brand.primaryDark}>{initials(name)}</Text>
        </View>
      )}
      {verified ? (
        <View style={[styles.verified, { width: px * 0.34, height: px * 0.34, borderRadius: px * 0.17 }]}>
          <Icon name="verified" size={px * 0.2} color={colors.text.onPrimary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.bg.subtle },
  fallback: { backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  verified: {
    position: 'absolute', bottom: -2, end: -2, backgroundColor: colors.brand.gold,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg.card,
  },
});
