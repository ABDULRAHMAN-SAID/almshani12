import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import { Text } from './Text';

/** نصّ طويل يُطوى بعد ٤ أسطر مع «المزيد/أقل» */
export function Expandable({ text, lines = 4 }: { text: string; lines?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  if (!text) return null;
  return (
    <View style={styles.wrap}>
      <Text role="body" tone="secondary" numberOfLines={open ? undefined : lines} onTextLayout={e => { if (e.nativeEvent.lines.length > lines) setLong(true); }} style={styles.text}>{text}</Text>
      {long || text.length > 220 ? <Pressable onPress={() => setOpen(o => !o)} hitSlop={8}><Text role="small" tone="link">{open ? t('common.less') : t('common.more')}</Text></Pressable> : null}
    </View>
  );
}
const styles = StyleSheet.create({ wrap: { gap: spacing[1] }, text: { lineHeight: 26 } });
