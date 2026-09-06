import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import { errorMessageKey } from '@/api/client';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** لا شاشة فارغة أبداً — رسالة وسبب وإجراء */
export function EmptyState({ icon = 'empty', title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}><Icon name={icon} size={30} color={colors.text.tertiary} /></View>
      <Text role="h3" center>{title}</Text>
      {body ? <Text role="small" tone="secondary" center style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} /> : null}
    </View>
  );
}

export interface ErrorStateProps { error?: unknown; onRetry?: () => void; compact?: boolean }

/** رسالة عربية مفهومة — لا "HTTP 500" — ويُسجَّل الخطأ تقنياً في العميل */
export function ErrorState({ error, onRetry, compact }: ErrorStateProps) {
  const { t } = useTranslation();
  const key = errorMessageKey(error);
  const offline = key === 'errors.network' || key === 'errors.offline';
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.iconWrap}><Icon name={offline ? 'wifiOff' : 'warning'} size={30} color={colors.state.warning} /></View>
      <Text role="h3" center>{t(offline ? 'errors.offline' : 'errors.generic')}</Text>
      {!offline ? <Text role="small" tone="secondary" center style={styles.body}>{t(key)}</Text> : null}
      {onRetry ? <Button label={t('common.retry')} onPress={onRetry} icon="refresh" variant="secondary" style={styles.action} /> : null}
    </View>
  );
}

/** شريط غير متصل — يظهر أعلى الشاشة */
export function OfflineBar() {
  const { t } = useTranslation();
  return (
    <View style={styles.offline}>
      <Icon name="wifiOff" size={15} color={colors.text.onPrimary} />
      <Text role="caption" tone="inverse">{t('errors.offline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[10], paddingHorizontal: spacing[6], gap: spacing[2] },
  compact: { paddingVertical: spacing[6] },
  iconWrap: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.bg.subtle, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2] },
  body: { maxWidth: 300 },
  action: { marginTop: spacing[3] },
  offline: { flexDirection: 'row', gap: spacing[2], alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text.secondary, paddingVertical: 6 },
});
