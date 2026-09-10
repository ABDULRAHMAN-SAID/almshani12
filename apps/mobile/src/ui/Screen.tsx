import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, ScrollView, Pressable, RefreshControl, StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, layout, hitTarget, radius, themed } from '@manassah/tokens';
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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  let body: ReactNode = children;
  if (loading) body = <ScreenSkeleton />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} onBack={onBack} />;
  else if (empty) body = <EmptyState {...(emptyProps ?? { title: '' })} />;

  const inner = (
    <View style={[styles.content, padded && styles.padded, contentStyle]}>{body}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {!bare && (title || onBack || right) && (
        <View style={styles.header}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={8} style={({ pressed }) => [styles.headerBtn, styles.backBtn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t('common.back')}>
              <Icon name="back" size={22} />
            </Pressable>
          ) : <View style={styles.headerBtn} />}
          <View style={styles.headerCenter}>
            {title ? <Text role="h2" numberOfLines={1} center>{title}</Text> : null}
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
      {/*
       * الترويسة الآمنة تستثني 'bottom' عمداً (بعض الشاشات تريد محتواً يمتدّ حتى الحافة)،
       * فالتذييل الثابت يحسب حشوته السفلى بنفسه. على الجوال: نتحقّق من inset الحقيقي.
       * على الويب: متصفّح أندرويد لا يُبلّغ safe-area-inset-bottom لشريط تنقّله الخاص
       * (خلافاً لسفاري وشريط الإيماءات في آيفون) فيعود صفراً دائماً — كان هذا يجعل الزرّ
       * يلامس شريط أندرويد نفسه؛ حدّ أدنى ثابت يضمن مسافة حتى حين لا يُبلَّغ الـ inset.
       */}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 16 : 0) + spacing[3] }]}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = themed((c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg.base },
  header: {
    flexDirection: 'row', alignItems: 'center', height: 64,
    paddingHorizontal: spacing[3], backgroundColor: c.bg.base,
  },
  headerBtn: { width: hitTarget - 4, height: hitTarget - 4, alignItems: 'center', justifyContent: 'center' },
  backBtn: { borderRadius: radius.full, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default },
  pressed: { opacity: 0.7 },
  headerRight: { width: undefined, minWidth: hitTarget, flexDirection: 'row', justifyContent: 'flex-end' },
  headerCenter: { flex: 1, alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: spacing[8] },
  content: { flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  padded: { paddingHorizontal: layout.screenPadding },
  footer: {
    // الحشو السفلي يُحسب حسب inset الجهاز عند الرسم (أعلاه) — هنا الجانبي والعلوي فقط
    paddingHorizontal: layout.screenPadding, paddingTop: spacing[3],
    borderTopWidth: 1.5, borderTopColor: c.border.default, backgroundColor: c.bg.card,
    borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg,
  },
}));
