import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditRow, PageMeta } from '@manassah/shared';
import { api, when } from '../../api';
import { DataTable, PersonLink, type Column } from '../../ui';

/** سجلّ العمليات المشترك: الصفحة العامة (بمرشّحات) وتبويبا الشخص/المعلّم (بالهدف أو المنفّذ) */
export function AuditTable({ params = {}, limit = 50, filters }: { params?: Record<string, unknown>; limit?: number; filters?: boolean }) {
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ entity: '', action: '', from: '', to: '', actorId: '', targetUserId: '' });
  const active = filters ? Object.fromEntries(Object.entries(f).filter(([, v]) => v)) : {};
  const list = useQuery({ queryKey: ['adm-audit', params, active, page, limit], queryFn: () => api.get<{ data: AuditRow[]; meta: PageMeta }>('/admin/audit', { ...params, ...active, page, limit }) });
  const set = (k: keyof typeof f, v: string) => { setF(s => ({ ...s, [k]: v })); setPage(1); };
  const cols: Column<AuditRow>[] = [
    { key: 'at', label: 'الوقت', className: 'num small', render: a => when(a.createdAt) },
    { key: 'actor', label: 'المنفّذ', render: a => a.actorId ? <PersonLink id={a.actorId} name={a.actor} /> : 'النظام' },
    { key: 'action', label: 'العملية', render: a => <code>{a.action}</code> },
    { key: 'entity', label: 'الكيان', className: 'num', render: a => a.entity ? `${a.entity} #${a.entityId ?? ''}` : '—' },
    { key: 'target', label: 'المستهدَف', render: a => a.targetUserId ? <PersonLink id={a.targetUserId} name={a.targetName} /> : '—' },
    { key: 'meta', label: 'التفاصيل', className: 'small', render: a => a.meta ? <details className="meta"><summary>عرض</summary><pre className="pre">{JSON.stringify(a.meta, null, 1)}</pre></details> : '' },
    { key: 'ip', label: 'IP', className: 'num small', render: a => a.ip ?? '' },
  ];
  return (
    <>
      {filters ? (
        <div className="toolbar">
          <input placeholder="العملية (بادئة، مثل user.)" value={f.action} onChange={e => set('action', e.target.value)} style={{ minWidth: 160 }} />
          <input placeholder="الكيان (users, orders…)" value={f.entity} onChange={e => set('entity', e.target.value)} style={{ minWidth: 140 }} />
          <input placeholder="رقم المنفّذ" value={f.actorId} inputMode="numeric" onChange={e => set('actorId', e.target.value.replace(/\D/g, ''))} style={{ minWidth: 110 }} />
          <input placeholder="رقم المستهدَف" value={f.targetUserId} inputMode="numeric" onChange={e => set('targetUserId', e.target.value.replace(/\D/g, ''))} style={{ minWidth: 110 }} />
          <input type="date" value={f.from} onChange={e => set('from', e.target.value)} style={{ minWidth: 140 }} /><input type="date" value={f.to} onChange={e => set('to', e.target.value)} style={{ minWidth: 140 }} />
          <span className="muted small">{list.data?.meta.total ?? 0} عملية</span>
        </div>
      ) : null}
      <div className="card"><DataTable columns={cols} rows={list.data?.data} error={list.error} meta={list.data?.meta} onPage={setPage} loading={list.isLoading} empty="لا عمليات مسجّلة بعد" /></div>
    </>
  );
}
