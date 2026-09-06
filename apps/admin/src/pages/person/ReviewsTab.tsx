import { useQuery } from '@tanstack/react-query';
import type { ReviewAdmin } from '@manassah/shared';
import { api } from '../../api';
import { ReviewsList } from '../parts/ReviewsList';
import type { TabProps } from './types';

/** التقييمات: ما كتبه الحساب وما تلقّاه كمعلّم — المخفيّة باهتة مع سببها */
export function ReviewsTab({ id }: TabProps) {
  const r = useQuery({ queryKey: ['adm-reviews', 'user', id], queryFn: () => api.get<{ written: ReviewAdmin[]; received: ReviewAdmin[] }>(`/admin/users/${id}/reviews`) });
  return (
    <>
      <div className="card"><h2>كتبها ({r.data?.written.length ?? 0})</h2><ReviewsList rows={r.data?.written} loading={r.isLoading} showAuthor={false} onChanged={() => r.refetch()} /></div>
      <div className="card"><h2>تلقّاها كمعلّم ({r.data?.received.length ?? 0})</h2><ReviewsList rows={r.data?.received} loading={r.isLoading} showTarget={false} onChanged={() => r.refetch()} /></div>
    </>
  );
}
