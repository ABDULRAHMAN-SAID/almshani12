import { View, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { colors, spacing, themed } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Screen, Text, Card, Avatar, Badge, ListRow, Button, IconButton, HeaderActions } from '@/ui';
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
    <Screen title={t('account.title')} padded right={<HeaderActions cart={false} bell={false} />}>
      <Card style={styles.profile} onPress={() => router.push('/account/settings')}>
        <Avatar name={user.displayName} url={user.avatarUrl} size="xl" />
        <View style={styles.flex}>
          <Text role="h2" numberOfLines={1}>{user.displayName || t('ui.guest')}</Text>
          {user.student?.gradeName ? <Text role="small" tone="secondary" numberOfLines={1}>{user.student.gradeName}{user.student.semesterName ? ` · ${user.student.semesterName}` : ''}</Text> : null}
          <Text role="caption" tone="tertiary" tabular numberOfLines={1}>{user.phone ?? user.email}</Text>
        </View>
        <IconButton icon="edit" label={t('account.edit')} variant="soft" size={44} color={colors.brand.primary} onPress={() => router.push('/account/settings')} />
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
          <ListRow icon="receipt" color="#2F6FED" label={t('account.purchases')} onPress={() => router.push('/account/purchases')} />
          <ListRow icon="calendar" color="#7A5AF8" label={t('account.bookings')} onPress={() => router.push('/(tabs)/lessons')} />
          <ListRow icon="heart" color="#E5488A" label={t('account.favorites')} onPress={() => router.push('/account/favorites')} />
          <ListRow icon="progress" color="#0EA5A5" label={t('account.progress')} onPress={() => router.push('/account/progress')} />
          <ListRow icon="bell" color="#F08A24" label={t('account.notifications')} badge={notifications.data?.unread || undefined} onPress={() => router.push('/account/notifications')} />
          <ListRow icon="message" color="#1D6FB8" label={t('account.messages')} badge={unreadMsgs || undefined} onPress={() => router.push('/account/messages')} />
          <ListRow icon="wallet" color="#159A5B" label={t('account.wallet')} value={wallet.data ? money(wallet.data.balance) : undefined} onPress={() => router.push('/account/wallet')} last />
        </View>
      </Card>

      <Card padded={false} style={styles.menu}>
        <View style={styles.menuInner}>
          <ListRow icon="settings" color="#5F6B7A" label={t('account.settings')} onPress={() => router.push('/account/settings')} />
          <ListRow icon="support" color="#0EA5A5" label={t('account.support')} value={brand.support.email} onPress={() => Linking.openURL(`mailto:${brand.support.email}`)} />
          <ListRow icon="lock" color="#7A5AF8" label={t('account.privacy')} onPress={() => Linking.openURL(brand.urls.privacy)} />
          <ListRow icon="info" color="#2F6FED" label={t('account.terms')} onPress={() => Linking.openURL(brand.urls.terms)} last />
        </View>
      </Card>

      <Card padded={false} style={styles.menu}>
        <View style={styles.menuInner}><ListRow icon="logout" label={t('account.logout')} danger onPress={signOut} last /></View>
      </Card>
      <Text role="caption" tone="tertiary" center style={styles.version}>{brand.name.ar} · {t('settings.version')} {Constants.expoConfig?.version ?? ''}</Text>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  teacher: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[3] },
  menu: { marginTop: spacing[3] },
  menuInner: { paddingHorizontal: spacing[4] },
  version: { marginTop: spacing[4], color: c.text.tertiary },
}));
