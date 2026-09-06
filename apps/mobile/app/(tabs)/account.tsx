import { View, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { colors, spacing } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Screen, Text, Card, Avatar, Badge, ListRow, Button } from '@/ui';
import { useAuth } from '@/state/auth';
import { useNotifications, useWallet, useConversations } from '@/features/queries';
import { signOut } from '@/lib/session';
import { money } from '@/lib/format';

/** حسابي: الملف، لوحة المعلّم/الانضمام، ثم قائمة مرتّبة بما يهمّ الطالب فعلاً */
export default function Account() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const notifications = useNotifications();
  const wallet = useWallet();
  const convs = useConversations();
  const unreadMsgs = convs.data?.reduce((s, c) => s + c.unread, 0) ?? 0;
  const isTeacher = !!user?.roles.includes('teacher');
  const status = user?.teacher?.verificationStatus;
  if (!user) return null;

  return (
    <Screen title={t('account.title')} padded>
      <Card style={styles.profile} onPress={() => router.push('/account/settings')}>
        <Avatar name={user.displayName} url={user.avatarUrl} size="xl" />
        <View style={styles.flex}>
          <Text role="h2" numberOfLines={1}>{user.displayName || t('ui.guest')}</Text>
          {user.student?.gradeName ? <Text role="small" tone="secondary" numberOfLines={1}>{user.student.gradeName}{user.student.semesterName ? ` · ${user.student.semesterName}` : ''}</Text> : null}
          <Text role="caption" tone="tertiary" tabular>{user.phone ?? user.email}</Text>
        </View>
        <Button label={t('account.edit')} variant="ghost" size="sm" icon="edit" onPress={() => router.push('/account/settings')} />
      </Card>

      {isTeacher ? (
        <Card accent style={styles.teacher} onPress={() => router.push('/teacher-app')}>
          <View style={styles.flex}>
            <Text role="h3">{t('account.teacherDashboard')}</Text>
            <Text role="caption" tone="secondary">{t(`teacherUi.status.${status ?? 'pending'}`)}</Text>
          </View>
          <Badge label={t(`teacherUi.status.${status ?? 'pending'}`)} tone={status === 'verified' ? 'success' : status === 'rejected' || status === 'suspended' ? 'danger' : 'warning'} />
        </Card>
      ) : (
        <Card style={styles.teacher} onPress={() => router.push('/teacher-app/apply')}>
          <View style={styles.flex}>
            <Text role="h3">{t('account.becomeTeacher')}</Text>
            <Text role="caption" tone="secondary">{t('onboarding.teacherHint')}</Text>
          </View>
          <Button label={t('teacherApp.apply.title')} size="sm" variant="secondary" onPress={() => router.push('/teacher-app/apply')} />
        </Card>
      )}

      <Card padded={false} style={styles.menu}>
        <View style={styles.menuInner}>
          <ListRow icon="receipt" label={t('account.purchases')} onPress={() => router.push('/account/purchases')} />
          <ListRow icon="calendar" label={t('account.bookings')} onPress={() => router.push('/(tabs)/lessons')} />
          <ListRow icon="heart" label={t('account.favorites')} onPress={() => router.push('/account/favorites')} />
          <ListRow icon="progress" label={t('account.progress')} onPress={() => router.push('/account/progress')} />
          <ListRow icon="bell" label={t('account.notifications')} badge={notifications.data?.unread || undefined} onPress={() => router.push('/account/notifications')} />
          <ListRow icon="message" label={t('account.messages')} badge={unreadMsgs || undefined} onPress={() => router.push('/account/messages')} />
          <ListRow icon="wallet" label={t('account.wallet')} value={wallet.data ? money(wallet.data.balance) : undefined} onPress={() => router.push('/account/wallet')} last />
        </View>
      </Card>

      <Card padded={false} style={styles.menu}>
        <View style={styles.menuInner}>
          <ListRow icon="settings" label={t('account.settings')} onPress={() => router.push('/account/settings')} />
          <ListRow icon="support" label={t('account.support')} value={brand.support.email} onPress={() => Linking.openURL(`mailto:${brand.support.email}`)} />
          <ListRow icon="lock" label={t('account.privacy')} onPress={() => Linking.openURL(brand.urls.privacy)} />
          <ListRow icon="info" label={t('account.terms')} onPress={() => Linking.openURL(brand.urls.terms)} last />
        </View>
      </Card>

      <Card padded={false} style={styles.menu}>
        <View style={styles.menuInner}><ListRow icon="logout" label={t('account.logout')} danger onPress={signOut} last /></View>
      </Card>
      <Text role="caption" tone="tertiary" center style={styles.version}>{brand.name.ar} · {t('settings.version')} {Constants.expoConfig?.version ?? ''}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  teacher: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[3] },
  menu: { marginTop: spacing[3] },
  menuInner: { paddingHorizontal: spacing[4] },
  version: { marginTop: spacing[4], color: colors.text.tertiary },
});
