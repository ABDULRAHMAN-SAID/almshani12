import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, themed } from '@manassah/tokens';
import { useAuth, useActiveLearner, useLearners, showSwitcher } from '@/state/auth';
import { Text } from './Text';
import { Icon } from './Icon';
import { BottomSheet } from './BottomSheet';
import { LearnerAvatar, shortGrade } from './LearnerAvatar';

/**
 * شريحة المتعلّم النشط «[صورة] الاسم · الصف ▾» — تفتح ورقة فيها صفّ لكل متعلّم (علامة على النشط)،
 * ثم «إضافة متعلّم» و«إدارة المتعلّمين». تُرسم فقط عندما يكون للحساب أكثر من متعلّم أو متعلّم واحد ليس صاحب الحساب.
 */
export function LearnerSwitcher() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const setActiveLearner = useAuth(s => s.setActiveLearner);
  const active = useActiveLearner();
  const learners = useLearners();
  const [open, setOpen] = useState(false);
  if (!showSwitcher(user) || !active) return null;

  return (
    <View style={styles.flex}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('learners.switch')} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
        <LearnerAvatar learner={active} size={28} badge={false} />
        <View style={styles.chipText}>
          <Text role="bodyMedium" numberOfLines={1}>{active.displayName}</Text>
          {active.gradeName ? <Text role="caption" tone="secondary" numberOfLines={1}>{t('common.grade')} {shortGrade(active.gradeName)}</Text> : null}
        </View>
        <Icon name="down" size={18} color={colors.text.secondary} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t('learners.switch')}>
        <View style={styles.list}>
          {learners.map(l => {
            const on = l.id === active.id;
            return (
              <Pressable key={l.id} onPress={() => { setActiveLearner(l.id); setOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}>
                <LearnerAvatar learner={l} size={40} badge={false} />
                <View style={styles.flex}>
                  <Text role="bodyMedium" numberOfLines={1}>{l.displayName}{l.isSelf ? ` · ${t('learners.self')}` : ''}</Text>
                  <Text role="caption" tone="secondary" numberOfLines={2}>{[l.gradeName, l.semesterName].filter(Boolean).join(' · ') || t('learners.child')}</Text>
                </View>
                {on ? <View style={styles.check}><Icon name="check" size={16} color={colors.text.onPrimary} /></View> : null}
              </Pressable>
            );
          })}
          <View style={styles.divider} />
          <Pressable onPress={() => { setOpen(false); router.push('/account/learners/new'); }} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.actionIcon}><Icon name="plus" size={20} color={colors.brand.primary} /></View>
            <Text role="bodyMedium" tone="brand" style={styles.flex}>{t('learners.add')}</Text>
          </Pressable>
          <Pressable onPress={() => { setOpen(false); router.push('/account/learners'); }} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.actionIcon}><Icon name="people" size={20} color={colors.text.secondary} /></View>
            <Text role="bodyMedium" style={styles.flex}>{t('learners.manage')}</Text>
            <Icon name="forward" size={18} color={colors.text.tertiary} />
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], alignSelf: 'flex-start', maxWidth: '100%', height: 48, paddingStart: spacing[2], paddingEnd: spacing[3], borderRadius: radius.full, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default },
  chipText: { flexShrink: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  list: { gap: spacing[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: 60, paddingHorizontal: spacing[2], borderRadius: radius.md },
  rowOn: { backgroundColor: c.brand.primarySoft },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: c.border.default, marginVertical: spacing[2] },
  actionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg.subtle, alignItems: 'center', justifyContent: 'center' },
}));
