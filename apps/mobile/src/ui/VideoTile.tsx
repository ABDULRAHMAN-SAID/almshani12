import { View, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface VideoTileProps { stream?: unknown; local?: boolean; name: string; camOff?: boolean; micOff?: boolean; large?: boolean; note?: string | null }

/** الجوال: معاينة الكاميرا للمستخدم نفسه، والطرف الآخر صورة رمزية (الفيديو ثنائي الاتجاه يحتاج نسخة مبنية) */
export function VideoTile({ local, name, camOff, micOff, large, note }: VideoTileProps) {
  const { t } = useTranslation();
  return (
    <View style={[styles.tile, large && styles.large]}>
      {local && !camOff ? <CameraView style={StyleSheet.absoluteFill} facing="front" mute /> : (
        <View style={styles.center}><Avatar name={name} size={large ? 'xl' : 'lg'} />{note ? <Text role="caption" tone="inverse" center style={styles.note}>{note}</Text> : null}</View>
      )}
      <View style={styles.label}><Text role="caption" tone="inverse" numberOfLines={1}>{local ? t('live.you') : name}</Text>{micOff ? <Icon name="micOff" size={12} color={colors.text.inverse} /> : null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: '#1F1D1A', borderRadius: radius.md, overflow: 'hidden', aspectRatio: 4 / 3, width: '100%' },
  large: { flex: 1, aspectRatio: undefined },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[4] },
  note: { opacity: 0.8 },
  label: { position: 'absolute', bottom: spacing[2], start: spacing[2], flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
});
