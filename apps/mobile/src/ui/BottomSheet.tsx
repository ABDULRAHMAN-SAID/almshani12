import type { ReactNode } from 'react';
import { Modal as RNModal, View, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, shadow, layout, themed } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** ورقة سفلية بسيطة — بلا مكتبة إضافية، وبلا أكثر من طبقة واحدة */
export function BottomSheet({ visible, onClose, title, children, footer }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="إغلاق" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }]}>
          <View style={styles.handle} />
          {title ? (
            <View style={styles.head}>
              <Text role="h3" style={styles.headTitle}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="إغلاق"><Icon name="close" size={22} /></Pressable>
            </View>
          ) : null}
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" bounces={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

export interface DialogProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  children?: ReactNode;
  actions?: ReactNode;
}

/** حوار مركزي للتأكيدات القصيرة */
export function Dialog({ visible, onClose, title, body, children, actions }: DialogProps) {
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* الخلفية أخت الحوار لا أبوه: كانت زرّاً يلفّ زرّاً يلفّ أزرار الإجراءات — غير صالح في HTML */}
      <View style={[styles.backdrop, styles.center]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="إغلاق" />
        <View style={styles.dialog}>
          <Text role="h3">{title}</Text>
          {body ? <Text role="small" tone="secondary" style={styles.dialogBody}>{body}</Text> : null}
          {children}
          {actions ? <View style={styles.dialogActions}>{actions}</View> : null}
        </View>
      </View>
    </RNModal>
  );
}

const styles = themed((c) => StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  sheet: {
    backgroundColor: c.bg.card, borderTopStartRadius: radius.xl, borderTopEndRadius: radius.xl,
    maxHeight: '88%', width: '100%', alignSelf: 'center', ...shadow.sheet,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border.strong, alignSelf: 'center', marginTop: spacing[2] },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: spacing[2] },
  headTitle: { flex: 1 },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: layout.screenPadding, paddingVertical: spacing[3] },
  footer: { paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: c.border.default },
  dialog: { width: '100%', maxWidth: 400, backgroundColor: c.bg.card, borderRadius: radius.lg, padding: spacing[5], gap: spacing[3], ...shadow.sheet },
  dialogBody: { marginTop: -spacing[1] },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2], marginTop: spacing[2] },
}));
