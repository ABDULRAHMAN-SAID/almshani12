import { useState } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@manassah/tokens';
import { connectToLiveServer, type ConnectResult } from '@/lib/registry';
import { useUi } from '@/state/ui';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button, type ButtonVariant, type ButtonSize } from './Button';

type FailReason = Extract<ConnectResult, { ok: false }>['reason'];

export interface LiveServerButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * زر «الاتصال بالخادم التجريبي»: يقرأ عنوان النفق الحالي من السجلّ العام، يطرقه، يحفظه ويخرج ليُعاد الدخول عليه.
 * النجاح يُعلَن برسالة عابرة (الشاشة تُستبدل بالترحيب)، والفشل بسطر تحته يشرح السبب: متوقف / بعيد عن شبكتك / تعذّر قراءة السجلّ.
 */
export function LiveServerButton({ variant = 'soft', size = 'md', full, style }: LiveServerButtonProps) {
  const { t } = useTranslation();
  const showToast = useUi(s => s.showToast);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<FailReason | null>(null);

  const connect = async () => {
    setBusy(true); setFail(null);
    try {
      const r = await connectToLiveServer();
      if (r.ok) showToast(t('live.server.connected'));
      else setFail(r.reason);
    } finally { setBusy(false); }
  };

  return (
    <View style={[styles.wrap, style]}>
      <Button label={t('live.server.connect')} variant={variant} size={size} icon="server" full={full} loading={busy} onPress={connect} />
      {busy ? <Text role="caption" tone="secondary" center={full}>{t('live.server.connecting')}</Text> : null}
      {fail ? (
        <View style={[styles.msg, full && styles.msgCenter]}>
          <Icon name="warning" size={16} color={colors.state.danger} />
          <Text role="caption" tone="danger" center={full} style={styles.flex}>{t(`live.server.${fail}`)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: spacing[2] },
  msg: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  msgCenter: { justifyContent: 'center' },
  flex: { flexShrink: 1 },
});
