import { QueryClient } from '@tanstack/react-query';

/** فصل حالة الخادم عن حالة الواجهة: react-query يملك بيانات الخادم فقط — نسخة واحدة يشاركها الجذر والمخازن */
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });
