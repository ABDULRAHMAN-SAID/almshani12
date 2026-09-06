import { useSearchParams } from 'react-router-dom';
import { Page } from '../ui';
import { PayoutsTable } from './parts/PayoutsTable';

/** سحوبات المعلّمين — الحالة الابتدائية من الرابط (?status=) */
export default function Payouts() {
  const [sp] = useSearchParams();
  const status = sp.get('status') ?? 'pending';
  return <Page title="سحوبات المعلّمين"><PayoutsTable key={status} initialStatus={status} /></Page>;
}
