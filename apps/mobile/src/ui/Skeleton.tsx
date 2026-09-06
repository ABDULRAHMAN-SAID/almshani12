import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type DimensionValue } from 'react-native';
import { colors, radius, spacing } from '@manassah/tokens';

export interface SkeletonProps { width?: DimensionValue; height?: number; round?: number | 'full'; style?: object }

/** نبض هادئ — لا حركة ثقيلة */
export function Skeleton({ width = '100%', height = 14, round = radius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  const br = round === 'full' ? (height / 2) : round;
  return <Animated.View style={[{ width, height, borderRadius: br, backgroundColor: colors.skeleton, opacity }, style]} />;
}

export function CardSkeleton({ lines = 2, cover = true }: { lines?: number; cover?: boolean }) {
  return (
    <View style={styles.card}>
      {cover ? <Skeleton height={120} round={radius.md} /> : null}
      <View style={styles.lines}>
        <Skeleton width="80%" height={16} />
        {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} width={i % 2 ? '45%' : '65%'} height={12} />)}
      </View>
    </View>
  );
}

export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} round="full" />
      <View style={[styles.lines, { flex: 1 }]}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={11} />
      </View>
    </View>
  );
}

/** هيكل شاشة كاملة — يُستخدم من Screen عند loading */
export function ScreenSkeleton() {
  return (
    <View style={styles.screen}>
      <Skeleton width="55%" height={24} />
      <Skeleton width="85%" height={14} />
      <View style={styles.grid}>
        <View style={{ flex: 1 }}><CardSkeleton /></View>
        <View style={{ flex: 1 }}><CardSkeleton /></View>
      </View>
      <RowSkeleton /><RowSkeleton /><RowSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.card, borderRadius: radius.lg, padding: spacing[3], gap: spacing[3], borderWidth: 1, borderColor: colors.border.default },
  lines: { gap: spacing[2] },
  row: { flexDirection: 'row', gap: spacing[3], alignItems: 'center', paddingVertical: spacing[2] },
  screen: { gap: spacing[4], paddingTop: spacing[4] },
  grid: { flexDirection: 'row', gap: spacing[3] },
});
