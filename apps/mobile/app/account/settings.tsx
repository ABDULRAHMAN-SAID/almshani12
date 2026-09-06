import { useState } from 'react';
import { View, StyleSheet, I18nManager, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip, Card, ListRow, Dialog } from '@/ui';
import { useUpdateProfile, useDeleteAccount } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { signOut } from '@/lib/session';
import i18n from '@/i18n';
import { errorMessageKey } from '@/api/client';

/** الإعدادات: الاسم، اللغة، الصف، حذف الحساب (متطلّب المتاجر) */
export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const update = useUpdateProfile();
  const del = useDeleteAccount();
  const [name, setName] = useState(user?.displayName ?? '');
  const [confirm, setConfirm] = useState(false);
  const setLang = (lng: 'ar' | 'en') => {
    i18n.changeLanguage(lng);
    update.mutate({ locale: lng });
    const rtl = lng === 'ar';
    if (Platform.OS === 'web' && typeof document !== 'undefined') { document.documentElement.dir = rtl ? 'rtl' : 'ltr'; document.documentElement.lang = lng; }
    else if (I18nManager.isRTL !== rtl) { I18nManager.forceRTL(rtl); }
  };
  return (
    <Screen onBack={() => router.back()} title={t('settings.title')}>
      <View style={styles.wrap}>
        <Card>
          <Text role="h3" style={styles.mb}>{t('settings.profile')}</Text>
          <Input label={t('settings.name')} value={name} onChangeText={setName} autoCapitalize="words" />
          <Button label={update.isSuccess && !update.isPending ? t('settings.saved') : t('common.save')} style={styles.mt} loading={update.isPending} disabled={name.trim().length < 2 || name === user?.displayName} onPress={() => update.mutate({ displayName: name.trim() })} />
          {update.error ? <Text role="small" tone="danger">{t(errorMessageKey(update.error))}</Text> : null}
        </Card>
        <Card>
          <Text role="h3" style={styles.mb}>{t('settings.language')}</Text>
          <View style={styles.chips}><Chip label={t('settings.arabic')} selected={i18n.language !== 'en'} onPress={() => setLang('ar')} /><Chip label={t('settings.english')} selected={i18n.language === 'en'} onPress={() => setLang('en')} /></View>
        </Card>
        <Card padded={false}><View style={styles.menu}><ListRow icon="grade" label={t('settings.changeGrade')} value={user?.student?.gradeName ?? undefined} onPress={() => router.push('/(auth)/setup')} /><ListRow icon="logout" label={t('account.logout')} onPress={signOut} last /></View></Card>
        <Card padded={false}><View style={styles.menu}><ListRow icon="trash" label={t('settings.deleteAccount')} danger onPress={() => setConfirm(true)} last /></View></Card>
      </View>
      <Dialog visible={confirm} onClose={() => setConfirm(false)} title={t('settings.deleteAccount')} body={t('settings.deleteConfirm')}
        actions={<><Button label={t('common.cancel')} variant="secondary" onPress={() => setConfirm(false)} /><Button label={t('settings.delete')} variant="danger" loading={del.isPending} onPress={() => del.mutate(undefined, { onSuccess: () => signOut() })} /></>} />
    </Screen>
  );
}
const styles = StyleSheet.create({ wrap: { gap: spacing[3], paddingTop: spacing[2] }, mb: { marginBottom: spacing[3] }, mt: { marginTop: spacing[3] }, chips: { flexDirection: 'row', gap: spacing[2] }, menu: { paddingHorizontal: spacing[4] } });
