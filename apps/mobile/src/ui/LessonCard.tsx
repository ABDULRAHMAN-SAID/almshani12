import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, shadow, subjectColors, type SubjectColorKey, themed } from '@manassah/tokens';
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

/** شريط علوي بلون المادة، ثم المعلّم والوقت بخط كبير، وزر واحد واضح: دخول أو تفاصيل */
export function LessonCard({ booking, onPress, onJoin, hero, asTeacher }: LessonCardProps) {
  const { t } = useTranslation();
  const sc = subjectColors[(booking.subject.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
  const other = asTeacher ? booking.student : booking.teacher;
  const mins = minutesUntil(booking.startsAt);
  const live = booking.status === 'in_progress' || (booking.status === 'confirmed' && mins <= 0 && mins > -booking.durationMinutes);
  const soon = booking.status === 'confirmed' && mins > 0 && mins <= 60;

  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.card, hero && styles.hero, pressed && styles.pressed]}>
      <View style={[styles.band, { backgroundColor: sc.soft }]}>
        <View style={styles.subject}>
          <View style={[styles.dot, { backgroundColor: sc.main }]} />
          <Text role={hero ? 'h2' : 'h3'} color={sc.main} numberOfLines={1}>{booking.subject.name}</Text>
        </View>
        <Badge label={t(`lessons.status.${booking.status}`)} tone={live ? 'live' : STATUS_TONE[booking.status]} />
      </View>

      <View style={styles.body}>
        <View style={styles.person}>
          <Avatar name={other.name} url={other.avatarUrl} size={hero ? 'md' : 'sm'} verified={other.verified} />
          <View style={styles.personText}>
            <Text role="bodyMedium" numberOfLines={1}>{other.name}</Text>
            <Text role="caption" tone="secondary">{t(`teachers.${booking.mode}`)} · {booking.durationMinutes} {t('common.minutes')}</Text>
          </View>
        </View>

        <View style={styles.timeRow}>
          <View style={styles.time}>
            <Icon name="calendar" size={18} color={colors.text.secondary} />
            <Text role="bodyMedium" tabular>{relativeDay(booking.startsAt)}</Text>
          </View>
          <View style={styles.time}>
            <Icon name="clock" size={18} color={colors.text.secondary} />
            <Text role="bodyMedium" tabular>{formatTime(booking.startsAt)}</Text>
          </View>
          {hero && soon ? <Badge label={t('home.remaining', { m: mins })} tone="brand" icon="timer" /> : null}
        </View>

        <View style={styles.actions}>
          {booking.canJoin && onJoin ? (
            <Button label={live ? t('lessons.join') : t('home.join')} onPress={onJoin} variant={live ? 'primary' : 'info'} icon="video" size={hero ? 'md' : 'sm'} full={hero} style={hero ? styles.flex : undefined} />
          ) : null}
          <Button label={t('lessons.details')} onPress={onPress} variant="ghost" size="sm" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  card: {
    backgroundColor: c.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border.default, overflow: 'hidden', ...shadow.card,
  },
  hero: { borderWidth: 2, borderColor: c.brand.gold },
  pressed: { opacity: 0.92 },
  band: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  subject: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  body: { padding: spacing[4], gap: spacing[3] },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  personText: { flex: 1, minWidth: 0 },
  timeRow: { flexDirection: 'row', gap: spacing[4], flexWrap: 'wrap', alignItems: 'center' },
  time: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  flex: { flex: 1 },
}));
