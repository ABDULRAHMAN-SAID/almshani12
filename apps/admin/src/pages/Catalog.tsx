import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Page, Field, Empty, useToast, errMsg, can, type Me } from '../ui';

type Tree = { countries: any[]; curriculums: any[]; grades: any[]; semesters: any[]; subjects: any[] };
const COLORS = ['math', 'physics', 'chemistry', 'biology', 'arabic', 'english', 'islamic', 'social', 'default'];

/** المنهج الهرمي: دولة → منهج → صفوف/فصول/مواد → وحدات → دروس — كلّه من قاعدة البيانات */
export default function Catalog({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tree = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Tree>('/catalog/tree') });
  const [cur, setCur] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [gradeId, setGradeId] = useState<number | null>(null);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const units = useQuery({ queryKey: ['units', subjectId, gradeId, semesterId], queryFn: () => api.get<any[]>('/catalog/units', { subjectId, gradeId, semesterId }), enabled: !!subjectId && !!gradeId && !!semesterId });
  const inv = () => { qc.invalidateQueries({ queryKey: ['catalog'] }); qc.invalidateQueries({ queryKey: ['units'] }); };
  const add = useMutation({ mutationFn: ({ kind, body }: { kind: string; body: unknown }) => api.post(`/admin/catalog/${kind}`, body), onSuccess: () => { toast('أُضيف'); inv(); setNames({}); }, onError: e => toast(errMsg(e)) });
  const patch = useMutation({ mutationFn: ({ kind, id, body }: { kind: string; id: number; body: unknown }) => api.patch(`/admin/catalog/${kind}/${id}`, body), onSuccess: inv, onError: e => toast(errMsg(e)) });
  const del = useMutation({ mutationFn: ({ kind, id }: { kind: string; id: number }) => api.delete(`/admin/catalog/${kind}/${id}`), onSuccess: () => { toast('حُذف'); inv(); }, onError: e => toast(errMsg(e)) });
  const d = tree.data;
  const curId = cur ?? d?.curriculums[0]?.id ?? null;
  const admin = can(me, 'admin');
  const rename = (kind: string, id: number, current: string, field = 'name') => { const v = prompt('الاسم الجديد', current); if (v && v !== current) patch.mutate({ kind, id, body: { [field]: v } }); };
  const list = (kind: string, items: any[], extra?: (x: any) => string) => (
    <ul>{items.map(x => <li key={x.id}><span className="node"><span>{x.name ?? x.title}</span>{extra ? <span className="muted small">{extra(x)}</span> : null}{admin ? <><button className="btn ghost sm" onClick={() => rename(kind, x.id, x.name ?? x.title, x.name ? 'name' : 'title')}>تعديل</button><button className="btn ghost sm" onClick={() => confirm('حذف؟') && del.mutate({ kind, id: x.id })}>حذف</button></> : null}</span></li>)}</ul>
  );
  const adder = (kind: string, label: string, body: () => unknown) => admin ? <div className="row" style={{ marginTop: 8 }}><input placeholder={label} value={names[kind] ?? ''} onChange={e => setNames(n => ({ ...n, [kind]: e.target.value }))} style={{ width: 220 }} /><button className="btn secondary sm" disabled={!names[kind]} onClick={() => add.mutate({ kind, body: body() })}>إضافة</button></div> : null;
  if (!d) return <Page title="المنهج"><Empty text="جارٍ التحميل…" /></Page>;
  const grades = d.grades.filter(g => g.curriculumId === curId), sems = d.semesters.filter(s => s.curriculumId === curId), subs = d.subjects.filter(s => s.curriculumId === curId);
  return (
    <Page title="المنهج" sub="التسلسل: دولة → منهج → صف / فصل / مادة → وحدة → درس">
      <div className="grid grid-2">
        <div className="card tree">
          <h2>الدول والمناهج</h2>
          {list('countries', d.countries, c => c.code)}{adder('countries', 'اسم الدولة', () => ({ code: prompt('رمز الدولة (حرفان)', 'OM') ?? 'OM', name: names.countries }))}
          <h3 style={{ marginTop: 14 }}>المناهج</h3>
          <ul>{d.curriculums.map(c => <li key={c.id}><span className="node"><button className={`chip ${curId === c.id ? 'on' : ''}`} onClick={() => setCur(c.id)}>{c.name}</button>{admin ? <button className="btn ghost sm" onClick={() => rename('curriculums', c.id, c.name)}>تعديل</button> : null}</span></li>)}</ul>
          {adder('curriculums', 'اسم المنهج', () => ({ countryId: d.countries[0]?.id, name: names.curriculums }))}
          <h3 style={{ marginTop: 14 }}>الصفوف</h3>{list('grades', grades, g => `ترتيب ${g.order}`)}{adder('grades', 'اسم الصف', () => ({ curriculumId: curId, name: names.grades, order: grades.length + 1 }))}
          <h3 style={{ marginTop: 14 }}>الفصول</h3>{list('semesters', sems)}{adder('semesters', 'اسم الفصل', () => ({ curriculumId: curId, name: names.semesters, order: sems.length + 1 }))}
          <h3 style={{ marginTop: 14 }}>المواد</h3>{list('subjects', subs, s => s.colorKey)}
          {admin ? <div className="row" style={{ marginTop: 8 }}><input placeholder="اسم المادة" value={names.subjects ?? ''} onChange={e => setNames(n => ({ ...n, subjects: e.target.value }))} style={{ width: 180 }} /><select value={names.color ?? 'default'} onChange={e => setNames(n => ({ ...n, color: e.target.value }))} style={{ width: 130 }}>{COLORS.map(c => <option key={c} value={c}>{c}</option>)}</select><button className="btn secondary sm" disabled={!names.subjects} onClick={() => add.mutate({ kind: 'subjects', body: { curriculumId: curId, name: names.subjects, colorKey: names.color ?? 'default', order: subs.length + 1 } })}>إضافة</button></div> : null}
        </div>
        <div className="card tree">
          <h2>الوحدات والدروس</h2>
          <div className="row" style={{ marginBottom: 10 }}>
            <select value={subjectId ?? ''} onChange={e => setSubjectId(Number(e.target.value) || null)} style={{ width: 160 }}><option value="">المادة</option>{subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select value={gradeId ?? ''} onChange={e => setGradeId(Number(e.target.value) || null)} style={{ width: 200 }}><option value="">الصف</option>{grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <select value={semesterId ?? ''} onChange={e => setSemesterId(Number(e.target.value) || null)} style={{ width: 160 }}><option value="">الفصل</option>{sems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          {!units.isFetched ? <Empty text="اختر المادة والصف والفصل" /> : units.data?.length ? (
            <ul>{units.data.map((u, ui) => <li key={u.id}><span className="node"><b>{ui + 1}. {u.title}</b>{can(me, 'admin', 'content_reviewer') ? <button className="btn ghost sm" onClick={() => { const t = prompt('عنوان الدرس'); if (t) add.mutate({ kind: 'lessons', body: { unitId: u.id, title: t, order: u.lessons.length + 1 } }); }}>+ درس</button> : null}{admin ? <button className="btn ghost sm" onClick={() => rename('units', u.id, u.title, 'title')}>تعديل</button> : null}</span>
              {list('lessons', u.lessons)}</li>)}</ul>
          ) : <Empty text="لا وحدات بعد" />}
          {can(me, 'admin', 'content_reviewer') && subjectId && gradeId && semesterId ? <div className="row" style={{ marginTop: 8 }}><input placeholder="عنوان الوحدة" value={names.units ?? ''} onChange={e => setNames(n => ({ ...n, units: e.target.value }))} style={{ width: 240 }} /><button className="btn secondary sm" disabled={!names.units} onClick={() => add.mutate({ kind: 'units', body: { subjectId, gradeId, semesterId, title: names.units, order: (units.data?.length ?? 0) + 1 } })}>إضافة وحدة</button></div> : null}
        </div>
      </div>
    </Page>
  );
}
