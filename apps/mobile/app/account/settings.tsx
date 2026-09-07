import { useEffect, useState } from 'react';
import { View, StyleSheet, I18nManager, Platform, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, themed } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip, Card, ListRow, Dialog, Icon, Badge, LiveServerButton } from '@/ui';
import { useUpdateProfile, useDeleteAccount } from '@/features/queries';
import { useAuth, useActiveLearner } from '@/state/auth';
import { useUi, type ThemePref, type TextScale } from '@/state/ui';
import { signOut } from '@/lib/session';
import i18n from '@/i18n';
import { errorMessageKey, resolveBase, DEMO_FALLBACK, isDemo } from '@/api/client';
import { getPushState, enablePush, disablePush, type PushState } from '@/lib/push';

/** الإعدادات: الملف، المظهر (فاتح/داكن/تلقائي + حجم الخط)، اللغة، التنبيهات، الخادم والاتصال، الصف، حذف الحساب */
export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const active = useActiveLearner();
  const update = useUpdateProfile();
  const del = useDeleteAccount();
  const { themePref, setThemePref, textScale, setTextScale, serverUrl, setServerUrl } = useUi();
  const [name, setName] = useState(user?.displayName ?? '');
  const [confirm, setConfirm] = useState(false);
  const [url, setUrl] = useState(serverUrl);
  const [probe, setProbe] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; info?: string }>({ state: 'idle' });
  // التنبيهات الفورية على هذا الجهاز: الحالة تُقرأ بلا طلب إذن، والمفتاح يطلبه/يلغيه
  const [push, setPush] = useState<PushState | 'checking' | 'busy'>('checking');
  useEffect(() => { let live = true; getPushState().then(s => { if (live) setPush(s); }); return () => { live = false; }; }, []);
  const togglePush = async (on: boolean) => { setPush('busy'); setPush(on ? await enablePush() : await disablePush()); };
  const pushLabel = push === 'checking' || push === 'busy' ? t('settings.pushChecking') : t(`settings.push${push === 'on' ? 'On' : push === 'off' ? 'Off' : push === 'denied' ? 'Denied' : push === 'unconfigured' ? 'Unconfigured' : 'Unsupported'}`);

  const setLang = (lng: 'ar' | 'en') => {
    i18n.changeLanguage(lng);
    update.mutate({ locale: lng });
    const rtl = lng === 'ar';
    if (Platform.OS === 'web' && typeof document !== 'undefined') { document.documentElement.dir = rtl ? 'rtl' : 'ltr'; document.documentElement.lang = lng; }
    else if (I18nManager.isRTL !== rtl) { I18nManager.forceRTL(rtl); }
  };

  /** يطرق /api/health على العنوان المكتوب ويعرض النتيجة والزمن */
  const test = async () => {
    const base = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/.test(base)) { setProbe({ state: 'fail', info: t('settings.serverInvalid') }); return; }
    setProbe({ state: 'testing' });
    const t0 = Date.now();
    try {
      const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${base}/api/health`, { signal: ctrl.signal }); clearTimeout(id);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) setProbe({ state: 'ok', info: `${j.name ?? ''} · ${j.env ?? ''} · ${Date.now() - t0} ms` });
      else setProbe({ state: 'fail', info: `HTTP ${r.status}` });
    } catch (e) { setProbe({ state: 'fail', info: e instanceof Error && e.name === 'AbortError' ? t('settings.serverTimeout') : t('errors.network') }); }
  };
  const save = () => { setServerUrl(url); setProbe({ state: 'idle' }); };
  const useDemo = () => { setUrl(''); setServerUrl(''); setProbe({ state: 'idle' }); };

  const themeOptions: { key: ThemePref; label: string; icon: 'sun' | 'moonOutline' | 'settings' }[] = [
    { key: 'light', label: t('settings.light'), icon: 'sun' }, { key: 'dark', label: t('settings.dark'), icon: 'moonOutline' }, { key: 'system', label: t('settings.system'), icon: 'settings' },
  ];
  const sizeOptions: { key: TextScale; label: string }[] = [{ key: 1, label: t('settings.textNormal') }, { key: 1.15, label: t('settings.textLarge') }];

  return (
    <Screen onBack={() => router.back()} title={t('settings.title')}>
      <View style={styles.wrap}>
        {/* المظهر */}
        <Card>
          <View style={styles.head}><Icon name="palette" size={22} color={colors.brand.primary} /><Text role="h3">{t('settings.appearance')}</Text></View>
          <Text role="caption" tone="secondary" style={styles.label}>{t('settings.theme')}</Text>
          <View style={styles.chips}>{themeOptions.map(o => <Chip key={o.key} label={o.label} icon={o.icon} selected={themePref === o.key} onPress={() => setThemePref(o.key)} />)}</View>
          <Text role="caption" tone="secondary" style={[styles.label, styles.mt]}>{t('settings.textSize')}</Text>
          <View style={styles.chips}>{sizeOptions.map(o => <Chip key={o.key} label={o.label} icon="textSize" selected={textScale === o.key} onPress={() => setTextScale(o.key)} />)}</View>
        </Card>

        {/* اللغة */}
        <Card>
          <View style={styles.head}><Icon name="globe" size={22} color={colors.state.info} /><Text role="h3">{t('settings.language')}</Text></View>
          <View style={styles.chips}><Chip label={t('settings.arabic')} selected={i18n.language !== 'en'} onPress={() => setLang('ar')} /><Chip label={t('settings.english')} selected={i18n.language === 'en'} onPress={() => setLang('en')} /></View>
        </Card>

        {/* التنبيهات */}
        <Card>
          <View style={styles.head}><Icon name="bell" size={22} color={colors.brand.primary} /><Text role="h3">{t('settings.notifications')}</Text></View>
          <View style={styles.pushRow}>
            <View style={styles.flex}>
              <Text role="bodyMedium">{t('settings.pushToggle')}</Text>
              <Text role="caption" tone={push === 'on' ? 'success' : push === 'denied' ? 'danger' : 'secondary'}>{pushLabel}</Text>
            </View>
            <Switch value={push === 'on'} disabled={push === 'checking' || push === 'busy' || push === 'unsupported' || push === 'unconfigured' || push === 'denied'} onValueChange={togglePush}
              trackColor={{ true: colors.brand.primary, false: colors.border.strong }} thumbColor={colors.bg.card} accessibilityLabel={t('settings.pushToggle')} />
          </View>
          <Text role="caption" tone="tertiary" style={styles.mt}>{t('settings.pushHint')}</Text>
        </Card>

        {/* الخادم والاتصال */}
        <Card>
          <View style={styles.head}><Icon name="server" size={22} color={colors.brand.green} /><Text role="h3">{t('settings.server')}</Text></View>
          <View style={styles.modeRow}>
            <Badge label={isDemo() ? t('settings.demoMode') : t('settings.liveMode')} tone={isDemo() ? 'gold' : 'success'} icon={isDemo() ? 'sparkles' : 'wifi'} />
            <Text role="caption" tone="secondary" numberOfLines={1} style={styles.flex}>{isDemo() ? t('settings.demoHint') : resolveBase()}</Text>
          </View>
          <Input label={t('settings.serverUrl')} value={url} onChangeText={setUrl} placeholder="https://manassah.example.om" autoCapitalize="none" autoCorrect={false} keyboardType="url" icon="linkIcon" helper={t('settings.serverHint')} />
          {/* على الجوال يكفي فتح رابط الاتصال (manassah://connect?url=…) من صفحة الخادم بدل الكتابة */}
          {Platform.OS !== 'web' ? <Text role="caption" tone="tertiary">{t('settings.connectLinkHint')}</Text> : null}
          <View style={[styles.chips, styles.mt]}>
            <Button label={t('settings.testConnection')} variant="secondary" icon="wifi" loading={probe.state === 'testing'} disabled={!url.trim()} onPress={test} />
            <Button label={t('common.save')} disabled={url.trim() === serverUrl} onPress={save} />
            {/* العودة للعرض لها معنى فقط حين يُوجد عرض يُعاد إليه: حزمة عرض بلا خادم مضمَّن، والمستخدم هو من ضبط الخادم */}
            {DEMO_FALLBACK && serverUrl ? <Button label={t('settings.useDemo')} variant="ghost" onPress={useDemo} /> : null}
          </View>
          {probe.state === 'ok' ? <View style={styles.probe}><Icon name="checkCircle" size={18} color={colors.state.success} /><Text role="small" tone="success">{t('settings.connected')} · {probe.info}</Text></View> : null}
          {probe.state === 'fail' ? <View style={styles.probe}><Icon name="warning" size={18} color={colors.state.danger} /><Text role="small" tone="danger">{t('settings.connectionFailed')} · {probe.info}</Text></View> : null}
          {/* بديل الكتابة اليدوية: عنوان الخادم التجريبي الحالي يُقرأ من السجلّ العام (نفق trycloudflare يتغيّر مع كل تشغيل) */}
          <LiveServerButton style={styles.mt} />
        </Card>

        {/* الملف الشخصي */}
        <Card>
          <View style={styles.head}><Icon name="account" size={22} color={colors.text.secondary} /><Text role="h3">{t('settings.profile')}</Text></View>
          <Input label={t('settings.name')} value={name} onChangeText={setName} autoCapitalize="words" />
          <Button label={update.isSuccess && !update.isPending ? t('settings.saved') : t('common.save')} style={styles.mt} loading={update.isPending} disabled={name.trim().length < 2 || name === user?.displayName} onPress={() => update.mutate({ displayName: name.trim() })} />
          {update.error ? <Text role="small" tone="danger">{t(errorMessageKey(update.error))}</Text> : null}
        </Card>

        <Card padded={false}><View style={styles.menu}><ListRow icon="people" color={colors.brand.gold} label={t('settings.learners')} value={active?.gradeName ?? undefined} onPress={() => router.push('/account/learners')} /><ListRow icon="logout" label={t('account.logout')} onPress={signOut} last /></View></Card>
        <Card padded={false}><View style={styles.menu}><ListRow icon="trash" label={t('settings.deleteAccount')} danger onPress={() => setConfirm(true)} last /></View></Card>
      </View>
      <Dialog visible={confirm} onClose={() => setConfirm(false)} title={t('settings.deleteAccount')} body={t('settings.deleteConfirm')}
        actions={<><Button label={t('common.cancel')} variant="secondary" onPress={() => setConfirm(false)} /><Button label={t('settings.delete')} variant="danger" loading={del.isPending} onPress={() => del.mutate(undefined, { onSuccess: () => signOut() })} /></>} />
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  label: { marginBottom: spacing[2] },
  mt: { marginTop: spacing[3] },
  chips: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  menu: { paddingHorizontal: spacing[4] },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  probe: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3], padding: spacing[3], borderRadius: 14, backgroundColor: c.bg.subtle },
}));
