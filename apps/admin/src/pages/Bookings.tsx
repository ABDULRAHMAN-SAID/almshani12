import { useSearchParams } from 'react-router-dom';
import { Page, type Me } from '../ui';
import { BookingsTable } from './parts/BookingsTable';

/** الحجوزات: بحث بالحالة والاسم، الحضور المسجَّل، وحلّ النزاعات بقرار موثَّق (للدعم) — الحالة الابتدائية من الرابط */
export default function Bookings({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  return <Page title="الحجوزات"><BookingsTable key={sp.get('status') ?? ''} me={me} initialStatus={sp.get('status') ?? ''} search /></Page>;
}
