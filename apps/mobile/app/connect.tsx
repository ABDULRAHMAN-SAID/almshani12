import { useMemo, useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Screen, Text, Button, Card, Icon } from '@/ui';
import { useUi } from '@/state/ui';
import { signOut, safeBack } from '@/lib/session';

/** عنوان خادم صالح: http(s) ثم مضيف (نطاق أو IP أو localhost) ومنفذ اختياري ومسار اختياري — بلا مسافات أو استعلام */
const SERVER_RE = /^https?:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?(\/[^\s?#]*)?$/i;
const normalize = (raw: string): string | null => { const s = raw.trim().replace(/\/+$/, ''); return SERVER_RE.test(s) ? s : null; };
/** المعاملات قد تصل مصفوفة إن تكرّر المفتاح في الرابط — نأخذ الأول */
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');
/** على الويب من هاتف: نعرض زرّ فتح التطبيق بالرابط العميق */
const isPhoneBrowser = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

type Probe = { state: 'idle' | 'testing' | 'ok' | 'fail'; info?: string };

/**
 * الاتصال بخادم: يُفتح من صفحة الخادم (…/connect?url=https://…&name=…) على الويب، أو من الرابط العميق
 * manassah://connect?url=… في التطبيق. يتحقّق من العنوان، يجرّب /api/health، ثم يخرج ويحفظ العنوان ليُعاد الدخول على الخادم الجديد.
 * يعمل في حزمة العرض أيضاً: الجلب هنا مباشر بالعنوان الكامل ولا يمرّ بعميل الـ API.
 */
export default function Connect() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string | string[]; name?: string | string[] }>();
  const raw = one(params.url);
  const name = one(params.name).trim();
  const url = useMemo(() => normalize(raw), [raw]);
  const setServerUrl = useUi(s => s.setServerUrl);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const [busy, setBusy] = useState(false);

  /** يطرق /api/health بالعنوان الكامل (مهلة ٨ ثوانٍ) ويعرض الاسم والبيئة أو سبب الفشل */
  const test = async () => {
    if (!url) return;
    setProbe({ state: 'testing' });
    try {
      const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${url}/api/health`, { signal: ctrl.signal }); clearTimeout(id);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) setProbe({ state: 'ok', info: [j.name, j.env].filter(Boolean).join(' · ') });
      else setProbe({ state: 'fail', info: `HTTP ${r.status}` });
    } catch (e) { setProbe({ state: 'fail', info: e instanceof Error && e.name === 'AbortError' ? t('settings.serverTimeout') : t('errors.network') }); }
  };

  /**
   * يخرج ثم يحفظ العنوان — الخروج نفسه يعيد إلى الترحيب (والتخطيط الجذري يخرج أيضاً عند تغيّر الخادم؛ الاستدعاءان يُدمجان).
   * الترتيب مقصود: العنوان يأتي من رابط خارجي، فلا يصير وجهةً إلا بعد مسح رموز الخادم القديم كي لا تُرسَل إليه.
   */
  const connect = async () => {
    if (!url) return;
    setBusy(true);
    try { await signOut(); setServerUrl(url); } finally { setBusy(false); }
  };
  const cancel = () => safeBack(router);

  /** الرابط العميق للتطبيق المثبَّت — على الويب ننتقل بالصفحة نفسها لأن فتح تبويب جديد بمخطّط مخصّص يُحجَب على الهواتف غالباً */
  const openInApp = () => {
    const link = `${brand.scheme}://connect?url=${encodeURIComponent(url ?? raw)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(link);
    else Linking.openURL(link).catch(() => {});
  };

  const error = !raw ? t('connect.missing') : !url ? t('connect.invalid') : null;

  return (
    <Screen title={t('connect.title')} onBack={cancel} contentStyle={styles.wrap}>
      <Card>
        <View style={styles.hero}>
          <View style={styles.iconWrap}><Icon name="server" size={30} color={colors.brand.green} /></View>
          <Text role="h2" center>{name || t('connect.title')}</Text>
          <Text role="small" tone="secondary" center style={styles.intro}>{t('connect.intro')}</Text>
        </View>

        <View style={styles.urlBox}>
          <Icon name="linkIcon" size={18} color={colors.text.tertiary} />
          <Text role="bodyMedium" numberOfLines={2} style={styles.flex} selectable>{url ?? raw ?? '—'}</Text>
        </View>

        {error ? <View style={styles.probe}><Icon name="warning" size={18} color={colors.state.danger} /><Text role="small" tone="danger" style={styles.flex}>{error}</Text></View> : null}
        {probe.state === 'ok' ? <View style={styles.probe}><Icon name="checkCircle" size={18} color={colors.state.success} /><Text role="small" tone="success" style={styles.flex}>{t('settings.connected')}{probe.info ? ` · ${probe.info}` : ''}</Text></View> : null}
        {probe.state === 'fail' ? <View style={styles.probe}><Icon name="warning" size={18} color={colors.state.danger} /><Text role="small" tone="danger" style={styles.flex}>{t('settings.connectionFailed')} · {probe.info}</Text></View> : null}

        <View style={styles.actions}>
          <Button label={t('connect.test')} variant="secondary" icon="wifi" full loading={probe.state === 'testing'} disabled={!url || busy} onPress={test} />
          <Button label={t('connect.connect')} icon="check" full loading={busy} disabled={!url} onPress={connect} />
          <Button label={t('common.cancel')} variant="ghost" full disabled={busy} onPress={cancel} />
        </View>

        {isPhoneBrowser && raw ? (
          <View style={styles.appBox}>
            <Button label={t('connect.openInApp')} variant="soft" icon="rocket" full onPress={openInApp} />
            <Text role="caption" tone="tertiary" center>{t('connect.openInAppHint')}</Text>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { paddingTop: spacing[2], maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: spacing[2], marginBottom: spacing[4] },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.brand.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[1] },
  intro: { maxWidth: 360 },
  urlBox: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], borderRadius: radius.md, backgroundColor: c.bg.subtle, borderWidth: 1, borderColor: c.border.default },
  flex: { flex: 1, minWidth: 0 },
  probe: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3], padding: spacing[3], borderRadius: 14, backgroundColor: c.bg.subtle },
  actions: { gap: spacing[2], marginTop: spacing[4] },
  appBox: { gap: spacing[2], marginTop: spacing[4], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: c.border.default },
}));
