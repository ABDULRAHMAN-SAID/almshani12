import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { radius, themed } from '@manassah/tokens';
import type { LearnerRef } from '@manassah/shared';
import { Text } from './Text';
import { initials } from '@/lib/format';

export interface LearnerAvatarProps {
  learner: LearnerRef;
  size?: 28 | 40 | 56;
  /** شارة الصف الصغيرة تحت الدائرة (افتراضياً عند وجود صف وحجم ≥ ٤٠) */
  badge?: boolean;
}

/** لون ثابت لكل اسم — يميّز وليّ الأمر أبناءه بسرعة بلا صور */
const PALETTE = ['#2F6FED', '#7A5AF8', '#0EA5A5', '#3FA34D', '#F08A24', '#E5488A', '#1F8A70', '#D7263D'];
const hue = (name: string) => PALETTE[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
/** «الصف الثاني عشر (الدبلوم العام)» → «الثاني عشر» / «Grade 12» → «12» — ما يكفي لشارة صغيرة */
export const shortGrade = (name: string) => name.replace(/\s*\(.*\)\s*$/, '').replace(/^(الصف|grade)\s+/i, '').trim();

/** صورة المتعلّم أو حرفان من اسمه على لون ثابت، وتحتها شارة صفّه */
export function LearnerAvatar({ learner, size = 40, badge }: LearnerAvatarProps) {
  const r = size / 2;
  const showBadge = badge ?? (size >= 40 && !!learner.gradeName);
  return (
    <View style={styles.wrap}>
      {learner.avatarUrl ? (
        <Image source={{ uri: learner.avatarUrl }} style={[styles.img, { width: size, height: size, borderRadius: r }]} contentFit="cover" transition={150} accessibilityLabel={learner.displayName} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: r, backgroundColor: hue(learner.displayName || '?') }]} accessibilityLabel={learner.displayName}>
          <Text role={size >= 56 ? 'h3' : 'caption'} tone="inverse" style={size === 28 ? styles.tiny : undefined}>{initials(learner.displayName)}</Text>
        </View>
      )}
      {showBadge && learner.gradeName ? (
        <View style={[styles.badge, { maxWidth: size + 24 }]}><Text role="caption" tone="secondary" numberOfLines={1} style={styles.badgeText}>{shortGrade(learner.gradeName)}</Text></View>
      ) : null}
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { alignItems: 'center' },
  img: { backgroundColor: c.bg.subtle },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  tiny: { fontSize: 11, lineHeight: 14 },
  badge: { marginTop: -6, paddingHorizontal: 6, height: 16, borderRadius: radius.full, backgroundColor: c.bg.subtle, borderWidth: 1, borderColor: c.bg.card, justifyContent: 'center' },
  badgeText: { fontSize: 9, lineHeight: 12 },
}));
