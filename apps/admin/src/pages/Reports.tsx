import { useSearchParams } from 'react-router-dom';
import { Page } from '../ui';
import { ReportsTable } from './parts/ReportsTable';

/** البلاغات — الحالة الابتدائية من الرابط (?status=) */
export default function Reports() {
  const [sp] = useSearchParams();
  const status = sp.get('status') ?? 'open';
  return <Page title="البلاغات"><ReportsTable key={status} initialStatus={status} /></Page>;
}
