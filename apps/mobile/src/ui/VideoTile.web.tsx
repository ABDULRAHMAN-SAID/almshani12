import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import type { VideoTileProps } from './VideoTile';

/** الويب: عنصر <video> يعرض MediaStream (محلي مكتوم الصوت) */
export function VideoTile({ stream, local, name, camOff, micOff, large, note }: VideoTileProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = (stream as MediaStream | null) ?? null; }, [stream]);
  const show = !!stream && !camOff;
  return (
    <View style={[styles.tile, large && styles.large]}>
      <video ref={ref} autoPlay playsInline muted={!!local} style={{ width: '100%', height: '100%', objectFit: 'cover', display: show ? 'block' : 'none', transform: local ? 'scaleX(-1)' : undefined }} />
      {!show ? <View style={styles.center}><Avatar name={name} size={large ? 'xl' : 'lg'} />{note ? <Text role="caption" tone="inverse" center style={styles.note}>{note}</Text> : null}</View> : null}
      <View style={styles.label}><Text role="caption" tone="inverse" numberOfLines={1}>{local ? t('live.you') : name}</Text>{micOff ? <Icon name="micOff" size={12} color={colors.text.inverse} /> : null}</View>
    </View>
  );
}
export type { VideoTileProps };

const styles = StyleSheet.create({
  tile: { backgroundColor: '#1F1D1A', borderRadius: radius.md, overflow: 'hidden', aspectRatio: 4 / 3, width: '100%' },
  large: { flex: 1, aspectRatio: undefined },
  center: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[4] },
  note: { opacity: 0.8 },
  label: { position: 'absolute', bottom: spacing[2], start: spacing[2], flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
});
