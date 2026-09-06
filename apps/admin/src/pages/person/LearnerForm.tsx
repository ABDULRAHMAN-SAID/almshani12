import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Learner, LearnerUpsert } from '@manassah/shared';
import { api } from '../../api';
import { Drawer, Field, useToast, errMsg, useCatalog } from '../../ui';

/** نموذج المتعلّم (إضافة/تعديل) نيابةً عن الحساب — المنهج → الصف/الفصل/المواد من شجرة المنهج */
export function LearnerForm({ accountId, initial, onClose }: { accountId: number; initial?: Learner | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useCatalog();
  const [f, setF] = useState({
    displayName: initial?.displayName ?? '', gender: initial?.gender ?? '', isSelf: initial?.isSelf ?? false,
    curriculumId: initial?.curriculumId ?? 0, gradeId: initial?.gradeId ?? 0, semesterId: initial?.semesterId ?? 0,
    subjectIds: initial?.subjectIds ?? [] as number[], school: initial?.school ?? '',
  });
  const tree = cat.data;
  const curId = f.curriculumId || tree?.curriculums[0]?.id || 0;
  const grades = tree?.grades.filter(g => g.curriculumId === curId) ?? [], sems = tree?.semesters.filter(s => s.curriculumId === curId) ?? [], subs = tree?.subjects.filter(s => s.curriculumId === curId) ?? [];
  const save = useMutation({
    mutationFn: () => {
      const body: LearnerUpsert = { displayName: f.displayName.trim(), gender: f.gender ? (f.gender as 'male' | 'female') : null, curriculumId: curId, gradeId: f.gradeId, semesterId: f.semesterId, subjectIds: f.subjectIds, school: f.school.trim() || null, ...(initial ? {} : { isSelf: f.isSelf }) };
      return initial ? api.patch(`/admin/users/${accountId}/learners/${initial.id}`, body) : api.post(`/admin/users/${accountId}/learners`, body);
    },
    onSuccess: () => { toast(initial ? 'حُدّث المتعلّم' : 'أُضيف المتعلّم'); qc.invalidateQueries({ queryKey: ['adm-user', accountId] }); qc.invalidateQueries({ queryKey: ['adm-users'] }); onClose(); },
    onError: e => toast(errMsg(e)),
  });
  const ok = f.displayName.trim().length >= 2 && !!curId && !!f.gradeId && !!f.semesterId && f.subjectIds.length >= 1;
  const toggleSub = (id: number) => setF(s => ({ ...s, subjectIds: s.subjectIds.includes(id) ? s.subjectIds.filter(x => x !== id) : [...s.subjectIds, id] }));
  return (
    <Drawer title={initial ? `تعديل ${initial.displayName}` : 'إضافة متعلّم'} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>إلغاء</button><button className="btn" disabled={!ok || save.isPending} onClick={() => save.mutate()}>{initial ? 'حفظ' : 'إضافة'}</button></>}>
      <Field label="الاسم"><input value={f.displayName} onChange={e => setF(s => ({ ...s, displayName: e.target.value }))} autoFocus /></Field>
      <div className="grid grid-2">
        <Field label="الجنس"><select value={f.gender} onChange={e => setF(s => ({ ...s, gender: e.target.value }))}><option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option></select></Field>
        {!initial ? <Field label="النوع"><select value={f.isSelf ? '1' : '0'} onChange={e => setF(s => ({ ...s, isSelf: e.target.value === '1' }))}><option value="0">ابن/ابنة (وليّ أمر)</option><option value="1">ذاتي (صاحب الحساب طالب)</option></select></Field> : null}
      </div>
      {tree && tree.curriculums.length > 1 ? <Field label="المنهج"><select value={curId} onChange={e => setF(s => ({ ...s, curriculumId: Number(e.target.value), gradeId: 0, semesterId: 0, subjectIds: [] }))}>{tree.curriculums.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field> : null}
      <div className="grid grid-2">
        <Field label="الصف"><select value={f.gradeId} onChange={e => setF(s => ({ ...s, gradeId: Number(e.target.value) }))}><option value={0}>اختر</option>{grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="الفصل"><select value={f.semesterId} onChange={e => setF(s => ({ ...s, semesterId: Number(e.target.value) }))}><option value={0}>اختر</option>{sems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      <Field label="المواد (واحدة على الأقل)"><div className="chips">{subs.map(s => <button type="button" key={s.id} className={`chip ${f.subjectIds.includes(s.id) ? 'on' : ''}`} onClick={() => toggleSub(s.id)}>{s.name}</button>)}{!subs.length ? <span className="muted small">{cat.isLoading ? 'جارٍ تحميل المنهج…' : 'لا مواد في هذا المنهج'}</span> : null}</div></Field>
      <Field label="المدرسة (اختياري)"><input value={f.school} onChange={e => setF(s => ({ ...s, school: e.target.value }))} /></Field>
    </Drawer>
  );
}
