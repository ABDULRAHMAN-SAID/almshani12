import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { colors, themed } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';
import { initials } from '@/lib/format';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
const SIZES: Record<AvatarSize, number> = { sm: 36, md: 48, lg: 68, xl: 100 };
/** لون ثابت لكل اسم — حتى يميّز الطالب معلّميه بسرعة بلا صور */
const PALETTE = ['#2F6FED', '#7A5AF8', '#0EA5A5', '#3FA34D', '#F08A24', '#E5488A', '#1F8A70', '#D7263D'];
const hue = (name: string) => PALETTE[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];

export interface AvatarProps {
  name: string;
  url?: string | null;
  size?: AvatarSize;
  verified?: boolean;
  /** حلقة بيضاء حول الصورة — فوق الخلفيات الملوّنة */
  ring?: boolean;
}

/** صورة أو حرفان من الاسم على لون ثابت — بلا صور عشوائية */
export function Avatar({ name, url, size = 'md', verified, ring }: AvatarProps) {
  const px = SIZES[size];
  const r = px / 2;
  return (
    <View style={{ width: px, height: px }}>
      {url ? (
        <Image source={{ uri: url }} style={[styles.img, { width: px, height: px, borderRadius: r }, ring && styles.ring]} contentFit="cover" transition={150} accessibilityLabel={name} />
      ) : (
        <View style={[styles.fallback, { width: px, height: px, borderRadius: r, backgroundColor: hue(name || '?') }, ring && styles.ring]} accessibilityLabel={name}>
          <Text role={size === 'sm' ? 'caption' : size === 'xl' ? 'h1' : size === 'lg' ? 'h2' : 'h3'} tone="inverse">{initials(name)}</Text>
        </View>
      )}
      {verified ? (
        <View style={[styles.verified, { width: px * 0.36, height: px * 0.36, borderRadius: px * 0.18 }]}>
          <Icon name="verified" size={px * 0.2} color={colors.text.onPrimary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  img: { backgroundColor: c.bg.subtle },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 3, borderColor: c.bg.card },
  verified: {
    position: 'absolute', bottom: -2, end: -2, backgroundColor: c.brand.gold,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.bg.card,
  },
}));
