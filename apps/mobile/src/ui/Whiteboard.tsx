import { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { colors, radius, spacing, themed } from '@manassah/tokens';
import { Button } from './Button';
import { Chip } from './Chip';

export interface Stroke { points: [number, number][]; color: string; width: number }
export interface WhiteboardProps { ops: unknown[]; onStroke: (s: Stroke) => void; onClear?: () => void; canDraw: boolean }

const COLORS = ['#171717', '#9E1B32', '#315D7A', '#287A59'];

/** سبّورة مشتركة: ضربات بإحداثيات نسبية (٠–١) حتى تتطابق على كل الشاشات */
export function Whiteboard({ ops, onStroke, onClear, canDraw }: WhiteboardProps) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [color, setColor] = useState(COLORS[0]);
  const [current, setCurrent] = useState<[number, number][]>([]);
  const cur = useRef<[number, number][]>([]);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const colorRef = useRef(color);
  colorRef.current = color;

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => canDraw,
    onMoveShouldSetPanResponder: () => canDraw,
    onPanResponderGrant: e => { cur.current = [[e.nativeEvent.locationX / sizeRef.current.w, e.nativeEvent.locationY / sizeRef.current.h]]; setCurrent(cur.current); },
    onPanResponderMove: e => { cur.current = [...cur.current, [e.nativeEvent.locationX / sizeRef.current.w, e.nativeEvent.locationY / sizeRef.current.h]]; setCurrent(cur.current); },
    onPanResponderRelease: () => { if (cur.current.length > 1) onStroke({ points: cur.current, color: colorRef.current, width: 3 }); cur.current = []; setCurrent([]); },
  })).current;

  const strokes = ops.filter((o): o is Stroke => !!o && typeof o === 'object' && Array.isArray((o as Stroke).points));
  const toPoints = (pts: [number, number][]) => pts.map(([x, y]) => `${(x * size.w).toFixed(1)},${(y * size.h).toFixed(1)}`).join(' ');

  return (
    <View style={styles.wrap}>
      <View style={styles.board} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 })} {...pan.panHandlers}>
        <Svg width="100%" height="100%">
          {strokes.map((s, i) => <Polyline key={i} points={toPoints(s.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />)}
          {current.length > 1 ? <Polyline points={toPoints(current)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null}
        </Svg>
      </View>
      <View style={styles.tools}>
        {COLORS.map(c => <Chip key={c} label=" " small selected={color === c} color={c} softColor={c} onPress={() => setColor(c)} />)}
        {onClear ? <Button label="مسح" variant="ghost" size="sm" icon="trash" onPress={onClear} style={styles.clear} /> : null}
      </View>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[2] },
  board: { width: '100%', aspectRatio: 4 / 3, backgroundColor: c.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border.default, overflow: 'hidden' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  clear: { marginStart: 'auto' },
}));
