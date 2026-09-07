import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, TextInput, Pressable, StyleSheet, Platform, type TextInputProps } from 'react-native';
import { colors, radius, spacing, typography, themed } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  helper?: string;
  icon?: IconName;
  /** أرقام لاتينية متساوية العرض؛ لوحة المفاتيح تبقى من `keyboardType` (الوقت والتاريخ والكسور تحتاج ':' و'-' و'.') */
  numeric?: boolean;
}

export function Input({ label, error, helper, icon, numeric, secureTextEntry, ...rest }: InputProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  return (
    <View style={styles.wrap}>
      {label ? <Text role="caption" tone="primary" style={styles.label}>{label}</Text> : null}
      <View style={[styles.field, focused && styles.focused, !!error && styles.errored]}>
        {icon ? <Icon name={icon} size={19} color={colors.text.tertiary} /> : null}
        <TextInput
          {...rest}
          secureTextEntry={hidden}
          keyboardType={rest.keyboardType ?? (numeric ? 'number-pad' : undefined)}
          placeholderTextColor={colors.text.tertiary}
          onFocus={e => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={e => { setFocused(false); rest.onBlur?.(e); }}
          style={[styles.input, numeric && styles.numeric]}
          accessibilityLabel={label ?? rest.placeholder}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setHidden(h => !h)} hitSlop={8} accessibilityLabel={t(hidden ? 'ui.show' : 'ui.hide')}>
            <Icon name={hidden ? 'lock' : 'edit'} size={18} color={colors.text.tertiary} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text role="caption" tone="danger" style={styles.helper}>{error}</Text>
        : helper ? <Text role="caption" tone="tertiary" style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

export interface SearchInputProps extends Omit<TextInputProps, 'style'> {
  onClear?: () => void;
  onFilter?: () => void;
  activeFilters?: number;
}

export function SearchInput({ onClear, onFilter, activeFilters, value, ...rest }: SearchInputProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.searchRow}>
      <View style={[styles.field, styles.search]}>
        <Icon name="search" size={19} color={colors.text.tertiary} />
        <TextInput
          {...rest}
          value={value}
          placeholderTextColor={colors.text.tertiary}
          returnKeyType="search"
          style={styles.input}
          accessibilityRole="search"
        />
        {value ? (
          <Pressable onPress={onClear} hitSlop={8} accessibilityLabel={t('common.reset')}>
            <Icon name="close" size={18} color={colors.text.tertiary} />
          </Pressable>
        ) : null}
      </View>
      {onFilter ? (
        <Pressable onPress={onFilter} style={styles.filterBtn} accessibilityLabel={t('common.filters')}>
          <Icon name="filter" size={20} color={colors.text.primary} />
          {activeFilters ? <View style={styles.filterDot}><Text role="caption" tone="inverse" style={styles.filterDotText}>{activeFilters}</Text></View> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[1] },
  label: { marginBottom: 2, fontSize: 14, lineHeight: 20 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    minHeight: 56, paddingHorizontal: spacing[4],
    backgroundColor: c.bg.card, borderRadius: radius.md, borderWidth: 2, borderColor: c.border.default,
  },
  focused: { borderColor: c.border.focus },
  errored: { borderColor: c.state.danger },
  input: {
    flex: 1, minWidth: 0, paddingVertical: spacing[2],
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
    fontFamily: typography.body.family, fontSize: typography.body.size, color: c.text.primary,
    textAlign: 'auto', writingDirection: 'auto',
  },
  numeric: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
  helper: { marginTop: 2 },
  searchRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'center' },
  search: { flex: 1, backgroundColor: c.bg.card, borderColor: c.border.default, borderRadius: radius.full, minHeight: 52 },
  filterBtn: {
    width: 52, height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bg.card, borderWidth: 2, borderColor: c.border.default,
  },
  filterDot: {
    position: 'absolute', top: -4, end: -4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  filterDotText: { fontSize: 10, lineHeight: 12 },
}));
