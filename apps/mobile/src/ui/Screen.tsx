import type { ReactNode } from 'react';
import { View, ScrollView, Pressable, RefreshControl, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, layout, hitTarget } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';
import { ErrorState, EmptyState, type EmptyStateProps } from './States';
import { ScreenSkeleton } from './Skeleton';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** بلا ترويسة — الشاشات التي ترسم ترويستها بنفسها (الرئيسية) */
  bare?: boolean;
  scroll?: boolean;
  padded?: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyProps?: EmptyStateProps;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * حاوية كل شاشة: منطقة آمنة، ترويسة اختيارية، وحالات loading / error / empty
 * في مكان واحد حتى لا تُنسى في أي شاشة.
 */
export function Screen({
  title, subtitle, onBack, right, bare, scroll = true, padded = true,
  loading, error, onRetry, empty, emptyProps, refreshing, onRefresh, footer, contentStyle, children,
}: ScreenProps) {
  let body: ReactNode = children;
  if (loading) body = <ScreenSkeleton />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} />;
  else if (empty) body = <EmptyState {...(emptyProps ?? { title: '' })} />;

  const inner = (
    <View style={[styles.content, padded && styles.padded, contentStyle]}>{body}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {!bare && (title || onBack || right) && (
        <View style={styles.header}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={8} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
              <Icon name="back" size={24} />
            </Pressable>
          ) : <View style={styles.headerBtn} />}
          <View style={styles.headerCenter}>
            {title ? <Text role="h3" numberOfLines={1} center>{title}</Text> : null}
            {subtitle ? <Text role="caption" tone="secondary" numberOfLines={1} center>{subtitle}</Text> : null}
          </View>
          <View style={[styles.headerBtn, styles.headerRight]}>{right}</View>
        </View>
      )}
      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} colors={[colors.brand.primary]} />
          ) : undefined}
        >
          {inner}
        </ScrollView>
      ) : inner}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  header: {
    flexDirection: 'row', alignItems: 'center', height: 56,
    paddingHorizontal: spacing[2], backgroundColor: colors.bg.base,
  },
  headerBtn: { width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' },
  headerRight: { width: undefined, minWidth: hitTarget, flexDirection: 'row', justifyContent: 'flex-end' },
  headerCenter: { flex: 1, alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: spacing[8] },
  content: { flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  padded: { paddingHorizontal: layout.screenPadding },
  footer: {
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.default, backgroundColor: colors.bg.card,
  },
});
