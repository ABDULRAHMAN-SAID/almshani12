import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import type { Booking } from '@manassah/shared';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';
import { Icon } from './Icon';
import { relativeDay, formatTime, minutesUntil } from '@/lib/format';

export interface LessonCardProps {
  booking: Booking;
  onPress: () => void;
  onJoin?: () => void;
  /** البطاقة الكبيرة في الرئيسية — «حصّتك القادمة» */
  hero?: boolean;
  /** يعرض المعلّم الطالبَ بدل المعلّم (لوحة المعلّم) */
  asTeacher?: boolean;
}

const STATUS_TONE: Record<Booking['status'], BadgeTone> = {
  pending_payment: 'warning', confirmed: 'info', in_progress: 'live', completed: 'success',
  cancelled_by_student: 'neutral', cancelled_by_teacher: 'danger', no_show: 'danger', disputed: 'warning', expired: 'neutral',
};

/** المادة بلونها، المعلّم، الوقت، المدة، النوع — والفعل واضح: دخول أو تفاصيل */
export function LessonCard({ booking, onPress, onJoin, hero, asTeacher }: LessonCardProps) {
  const { t } = useTranslation();
  const sc = subjectColors[(booking.subject.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
  const other = asTeacher ? booking.student : booking.teacher;
  const mins = minutesUntil(booking.startsAt);
  const live = booking.status === 'in_progress' || (booking.status === 'confirmed' && mins <= 0 && mins > -booking.durationMinutes);
  const soon = booking.status === 'confirmed' && mins > 0 && mins <= 60;

  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.card, { borderStartColor: sc.main }, hero && styles.hero, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.subject}>
          <Text role={hero ? 'h3' : 'bodyMedium'} color={sc.main}>{booking.subject.name}</Text>
          <Badge label={t(`lessons.status.${booking.status}`)} tone={live ? 'live' : STATUS_TONE[booking.status]} />
        </View>
        <View style={styles.mode}>
          <Icon name={booking.mode === 'group' ? 'people' : 'teacher'} size={14} color={colors.text.tertiary} />
          <Text role="caption" tone="tertiary">{t(`teachers.${booking.mode}`)}</Text>
        </View>
      </View>

      <View style={styles.person}>
        <Avatar name={other.name} url={other.avatarUrl} size="sm" verified={other.verified} />
        <Text role="small" tone="secondary" numberOfLines={1} style={styles.personName}>{other.name}</Text>
      </View>

      <View style={styles.timeRow}>
        <View style={styles.time}>
          <Icon name="calendar" size={15} color={colors.text.secondary} />
          <Text role="small" tabular>{relativeDay(booking.startsAt)}</Text>
        </View>
        <View style={styles.time}>
          <Icon name="clock" size={15} color={colors.text.secondary} />
          <Text role="small" tabular>{formatTime(booking.startsAt)} · {booking.durationMinutes} {t('common.minutes')}</Text>
        </View>
      </View>

      {hero && soon ? (
        <Text role="caption" tone="brand" tabular>{t('home.remaining', { m: mins })}</Text>
      ) : null}

      <View style={styles.actions}>
        {booking.canJoin && onJoin ? (
          <Button label={live ? t('lessons.join') : t('home.join')} onPress={onJoin} variant={live ? 'primary' : 'info'} icon="video" size={hero ? 'md' : 'sm'} />
        ) : null}
        <Button label={t('lessons.details')} onPress={onPress} variant="ghost" size="sm" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default,
    borderStartWidth: 4, padding: spacing[3], gap: spacing[2],
  },
  hero: { padding: spacing[4], gap: spacing[3], borderTopWidth: 2, borderTopColor: colors.brand.gold },
  pressed: { opacity: 0.92 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  subject: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1, flexWrap: 'wrap' },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  personName: { flexShrink: 1 },
  timeRow: { flexDirection: 'row', gap: spacing[4], flexWrap: 'wrap' },
  time: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[1] },
});
