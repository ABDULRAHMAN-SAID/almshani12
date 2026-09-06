import { useQuery } from '@tanstack/react-query';
import { api, when } from '../api';
import { Page, Empty } from '../ui';

/** سجلّ العمليات الحسّاسة — من فعل ماذا ومتى، مع التفاصيل كما سُجّلت */
export default function Audit() {
  const list = useQuery({ queryKey: ['adm-audit'], queryFn: () => api.get<any[]>('/admin/audit', { limit: 300 }) });
  return (
    <Page title="سجلّ العمليات" sub="آخر ٣٠٠ عملية">
      <div className="card tbl">{list.data?.length ? (
        <table><thead><tr><th>الوقت</th><th>المنفّذ</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th><th>IP</th></tr></thead>
          <tbody>{list.data.map(a => <tr key={a.id}><td className="num small">{when(a.created_at)}</td><td>{a.actor ?? 'النظام'}</td><td><code>{a.action}</code></td><td className="num">{a.entity ? `${a.entity} #${a.entity_id ?? ''}` : '—'}</td><td className="small" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.meta ? JSON.stringify(a.meta) : ''}</td><td className="num small">{a.ip ?? ''}</td></tr>)}</tbody></table>
      ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا عمليات مسجّلة بعد'} />}</div>
    </Page>
  );
}
