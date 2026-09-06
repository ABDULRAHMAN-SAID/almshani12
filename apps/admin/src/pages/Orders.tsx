import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, money, when } from '../api';
import { Page, Empty, Tabs, type Me } from '../ui';
import { OrdersTable } from './parts/OrdersTable';

/** الطلبات: تأكيد التحويلات البنكية، الاسترجاع الكامل/الجزئي (يُعكس الربح ويُسحب الوصول تلقائياً) */
export default function Orders({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<'orders' | 'refunds'>('orders');
  const refunds = useQuery({ queryKey: ['adm-refunds'], queryFn: () => api.get<any[]>('/admin/refunds'), enabled: tab === 'refunds' });
  return (
    <Page title="الطلبات والاسترجاع">
      <Tabs tabs={[{ key: 'orders', label: 'الطلبات' }, { key: 'refunds', label: 'سجلّ الاسترجاع' }]} value={tab} onChange={k => setTab(k as never)} />
      {tab === 'orders' ? <OrdersTable key={`${sp.get('status') ?? ''}|${sp.get('q') ?? ''}`} me={me} initialStatus={sp.get('status') ?? ''} initialQ={sp.get('q') ?? ''} search /> : (
        <div className="card tbl">{refunds.data?.length ? (
          <table><thead><tr><th>الطلب</th><th>العميل</th><th>المبلغ</th><th>السبب</th><th>الحجز</th><th>التاريخ</th></tr></thead>
            <tbody>{refunds.data.map(r => <tr key={r.id}><td className="num">{r.number}</td><td>{r.display_name}</td><td className="num">{money(r.amount)}</td><td>{r.reason ?? '—'}</td><td className="num">{r.booking_id ?? '—'}</td><td className="num small">{when(r.processed_at ?? r.created_at)}</td></tr>)}</tbody></table>
        ) : <Empty text={refunds.isLoading ? 'جارٍ التحميل…' : 'لا استرجاعات'} />}</div>
      )}
    </Page>
  );
}
