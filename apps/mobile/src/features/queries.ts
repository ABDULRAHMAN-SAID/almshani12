/**
 * طبقة بيانات الخادم: كل استعلام/تعديل هنا، مربوط بعقد Zod من @manassah/shared.
 * الشاشات لا تستدعي fetch مباشرة أبداً.
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import * as C from '@manassah/shared';
import { api } from '@/api/client';
import { useAuth } from '@/state/auth';

/** المتعلّم النشط على هذا الجهاز — مفتاح كل استعلام يتبع المتعلّم (الرئيسية، الحصص، التقدّم) */
const useLearnerId = () => useAuth(s => s.activeLearnerId);

type Filters = Record<string, unknown>;
const pageOf = <T extends z.ZodTypeAny>(item: T) => C.paginated(item);
const nextPage = (last: { meta: C.PageMeta }) => (last.meta.page < last.meta.pages ? last.meta.page + 1 : undefined);

export const keys = {
  me: ['me'] as QueryKey, home: (lid: number | null) => ['home', lid] as QueryKey, catalog: ['catalog'] as QueryKey, learners: ['learners'] as QueryKey,
  books: (f: Filters) => ['books', f] as QueryKey, book: (id: number) => ['book', id] as QueryKey, bookRead: (id: number) => ['book', id, 'read'] as QueryKey,
  courses: (f: Filters) => ['courses', f] as QueryKey, course: (id: number) => ['course', id] as QueryKey, play: (c: number, l: number) => ['play', c, l] as QueryKey,
  quiz: (id: number) => ['quiz', id] as QueryKey, quickQuiz: (lid: number | null) => ['quickQuiz', lid] as QueryKey,
  teachers: (f: Filters) => ['teachers', f] as QueryKey, teacher: (id: number) => ['teacher', id] as QueryKey,
  availability: (id: number, from: string, d: number) => ['availability', id, from, d] as QueryKey,
  lessons: (asTeacher: boolean, lid: number | null) => ['lessons', asTeacher, lid] as QueryKey, booking: (id: number) => ['booking', id] as QueryKey,
  cart: ['cart'] as QueryKey, methods: ['methods'] as QueryKey, order: (n: string) => ['order', n] as QueryKey,
  purchases: ['purchases'] as QueryKey, wallet: ['wallet'] as QueryKey, notifications: ['notifications'] as QueryKey,
  favorites: ['favorites'] as QueryKey, progress: (lid: number | null) => ['progress', lid] as QueryKey, search: (q: string) => ['search', q] as QueryKey,
  conversations: ['conversations'] as QueryKey, messages: (id: number) => ['messages', id] as QueryKey,
  teacherMe: ['teacher', 'me'] as QueryKey, teacherAvailability: ['teacher', 'availability'] as QueryKey,
  teacherEarnings: ['teacher', 'earnings'] as QueryKey, teacherBookings: ['teacher', 'bookings'] as QueryKey,
};

/* ---------- الحساب ---------- */
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get('/auth/me', C.User), enabled: !!useAuth.getState().user });
export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: () => api.get('/catalog/tree', C.CatalogTree), staleTime: 60 * 60_000 });
export const useStudentSetup = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: C.StudentSetup) => api.post('/me/student-setup', b, C.User), onSuccess: (u) => { useAuth.getState().setUser(u); qc.invalidateQueries(); } });
};
export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { displayName?: string; locale?: 'ar' | 'en'; avatarFileId?: number | null }) => api.patch('/me', b, C.User), onSuccess: (u) => { useAuth.getState().setUser(u); qc.invalidateQueries({ queryKey: ['home'] }); } });
};

/* ---------- المتعلّمون: كل تعديل يعيد User كاملاً فنحدّث المخزن ونبطل كل ما يتبع المتعلّم ---------- */
const LearnersFeed = z.object({ data: z.array(C.Learner), activeLearnerId: C.Id.nullable() });
export const useLearners = () => useQuery({ queryKey: keys.learners, queryFn: () => api.get('/me/learners', LearnersFeed) });
const useUserMutation = <V,>(fn: (v: V) => Promise<C.User>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (u) => { useAuth.getState().setUser(u); qc.invalidateQueries(); } });
};
export const useCreateLearner = () => useUserMutation((b: C.LearnerUpsert) => api.post('/me/learners', b, C.User));
export const useUpdateLearner = (id: number) => useUserMutation((b: C.LearnerPatch) => api.patch(`/me/learners/${id}`, b, C.User));
export const useDeleteLearner = (id: number) => useUserMutation((_v?: void) => api.delete(`/me/learners/${id}`, C.User));
export const useActivateLearner = () => useUserMutation((id: number) => api.post(`/me/learners/${id}/activate`, {}, C.User));
export const useReorderLearners = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.post('/me/learners/reorder', { ids }, z.object({ data: z.array(C.Learner) })),
    onSuccess: (r) => { const u = useAuth.getState().user; if (u) useAuth.getState().setUser({ ...u, learners: r.data }); qc.invalidateQueries({ queryKey: keys.learners }); },
  });
};

/* ---------- الرئيسية والبحث ---------- */
export const useHome = () => { const lid = useLearnerId(); const authed = useAuth(s => !!s.user); return useQuery({ queryKey: keys.home(lid), queryFn: () => api.get('/home', C.HomeFeed), enabled: authed }); };
export const useSearch = (q: string) => useQuery({ queryKey: keys.search(q), queryFn: () => api.get('/catalog/search', C.SearchResults, { q }), enabled: q.trim().length >= 2 });
export const useProgress = () => { const lid = useLearnerId(); return useQuery({ queryKey: keys.progress(lid), queryFn: () => api.get('/me/progress', C.ProgressDashboard) }); };

/* ---------- الكتب ---------- */
export const useBooks = (f: Filters) => useInfiniteQuery({
  queryKey: keys.books(f), initialPageParam: 1,
  queryFn: ({ pageParam }) => api.get('/books', pageOf(C.BookCard), { ...f, page: pageParam, limit: 20 }),
  getNextPageParam: nextPage,
});
const BookDetailLoose = C.BookDetail.extend({ status: z.string().optional() });
export const useBook = (id: number) => useQuery({ queryKey: keys.book(id), queryFn: () => api.get(`/books/${id}`, BookDetailLoose), enabled: id > 0 });
const ReadAccess = C.BookReadAccess.extend({ previewPages: z.number().int().optional() });
/** رابط موقّع قصير العمر — لا يُخزَّن في الذاكرة المؤقّتة */
export const useBookRead = (id: number) => useQuery({ queryKey: keys.bookRead(id), queryFn: () => api.get(`/books/${id}/read`, ReadAccess), staleTime: 0, gcTime: 0, retry: false, enabled: id > 0 });
/** موضع القراءة يغذّي «أكمل من حيث توقّفت» ونسبة التقدّم في المشتريات — نُبطلهما ولا نلمس رابط القراءة الموقّع كي لا يقفز القارئ */
export const useReaderProgress = (id: number) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (page: number) => api.put(`/books/${id}/progress`, { page }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: keys.purchases }); } });
};
export const useToggleBookmark = (id: number) => {
  const qc = useQueryClient();
  // نكتب الإشارات في الذاكرة مباشرة: إبطال ['book', id] يبطل معه رابط القراءة الموقّع فيُعاد تحميل القارئ ويقفز عن صفحته
  return useMutation({
    mutationFn: (page: number) => api.post<{ bookmarks: number[] }>(`/books/${id}/bookmarks`, { page }),
    onSuccess: (d) => qc.setQueryData(keys.bookRead(id), (prev?: z.infer<typeof ReadAccess>) => (prev ? { ...prev, bookmarks: d.bookmarks } : prev)),
  });
};

/* ---------- الدورات ---------- */
export const useCourses = (f: Filters) => useInfiniteQuery({
  queryKey: keys.courses(f), initialPageParam: 1,
  queryFn: ({ pageParam }) => api.get('/courses', pageOf(C.CourseCard), { ...f, page: pageParam, limit: 20 }),
  getNextPageParam: nextPage,
});
export const useCourse = (id: number) => useQuery({ queryKey: keys.course(id), queryFn: () => api.get(`/courses/${id}`, C.CourseDetail), enabled: id > 0 });
export const usePlayLesson = (courseId: number, lessonId: number) =>
  useQuery({ queryKey: keys.play(courseId, lessonId), queryFn: () => api.get(`/courses/${courseId}/lessons/${lessonId}`, C.PlayLesson), staleTime: 0, gcTime: 0, retry: false, enabled: courseId > 0 && lessonId > 0 });
export const useLessonProgress = (courseId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, ...b }: { lessonId: number; positionSeconds: number; completed?: boolean }) => api.put(`/courses/lessons/${lessonId}/progress`, b),
    // اكتمال درس يغيّر الدورة والمشغّل والمشتريات ولوحة التقدّم — لا الدورة وحدها
    onSuccess: (_d, v) => {
      if (!v.completed) return;
      qc.invalidateQueries({ queryKey: keys.course(courseId) });
      qc.invalidateQueries({ queryKey: ['play', courseId] });
      qc.invalidateQueries({ queryKey: ['home'] });
      qc.invalidateQueries({ queryKey: keys.purchases });
      qc.invalidateQueries({ queryKey: ['progress'] });
    },
  });
};
export const useQuiz = (id: number) => useQuery({ queryKey: keys.quiz(id), queryFn: () => api.get(`/courses/quizzes/${id}`, C.Quiz), enabled: id > 0, staleTime: 0 });
export const useSubmitQuiz = (id: number) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: z.infer<typeof C.QuizSubmit>) => api.post(`/courses/quizzes/${id}/submit`, b, C.QuizResult), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.quiz(id) }); qc.invalidateQueries({ queryKey: ['progress'] }); } });
};
export const useQuickQuiz = () => useMutation({ mutationFn: () => api.get<{ quizId: number }>('/courses/quick-quiz/pick') });

/* ---------- المعلّمون والحجز ---------- */
export const useTeachers = (f: Filters) => useInfiniteQuery({
  queryKey: keys.teachers(f), initialPageParam: 1,
  queryFn: ({ pageParam }) => api.get('/teachers', pageOf(C.TeacherCard), { ...f, page: pageParam, limit: 20 }),
  getNextPageParam: nextPage,
});
export const useTeacher = (id: number) => useQuery({ queryKey: keys.teacher(id), queryFn: () => api.get(`/teachers/${id}`, C.TeacherProfile), enabled: id > 0 });
export const useAvailability = (id: number, from: string, durationMinutes: number, days = 14) =>
  useQuery({ queryKey: keys.availability(id, from, durationMinutes), queryFn: () => api.get(`/teachers/${id}/availability`, z.array(C.DayAvailability), { from, days, durationMinutes }), enabled: id > 0, staleTime: 15_000 });
const BookingCreatedLoose = C.BookingCreated.extend({ orderId: z.number().nullable().optional() });
export const useCreateBooking = () => {
  const qc = useQueryClient();
  // ملف المعلّم يحمل معاينة التوفّر وعدد الخانات لكل يوم — يتغيّر بكل حجز
  return useMutation({ mutationFn: (b: C.CreateBooking) => api.post('/bookings', b, BookingCreatedLoose), onSuccess: () => { qc.invalidateQueries({ queryKey: ['lessons'] }); qc.invalidateQueries({ queryKey: ['availability'] }); qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: ['teacher'] }); } });
};
/** حصص الحساب كلّها؛ `learnerId` (شريحة الترشيح) يقصرها على متعلّم واحد — الترويسة لا ترشّح هذه القائمة */
export const useLessons = (asTeacher = false, learnerId?: number | null) => {
  const lid = useLearnerId();
  return useQuery({ queryKey: keys.lessons(asTeacher, asTeacher ? lid : learnerId ?? null), queryFn: () => api.get('/bookings', C.LessonsFeed, asTeacher ? { as: 'teacher' } : learnerId ? { learnerId } : undefined), refetchInterval: 60_000 });
};
export const useBooking = (id: number) => useQuery({ queryKey: keys.booking(id), queryFn: () => api.get(`/bookings/${id}`, C.Booking), enabled: id > 0, refetchInterval: 30_000 });
const invalidateBooking = (qc: ReturnType<typeof useQueryClient>, id: number) => { qc.invalidateQueries({ queryKey: keys.booking(id) }); qc.invalidateQueries({ queryKey: ['lessons'] }); qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: keys.wallet }); qc.invalidateQueries({ queryKey: ['availability'] }); qc.invalidateQueries({ queryKey: ['teacher'] }); };
export const useCancelBooking = (id: number) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (reason?: string) => api.post<{ ok: true; refundPercent: number }>(`/bookings/${id}/cancel`, { reason: reason ?? null }), onSuccess: () => invalidateBooking(qc, id) });
};
export const useReschedule = (id: number) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (startsAt: string) => api.post(`/bookings/${id}/reschedule`, { startsAt }, C.Booking), onSuccess: () => invalidateBooking(qc, id) });
};
export const useRoomAccess = (id: number) => useMutation({ mutationFn: () => api.get(`/bookings/${id}/room`, C.RoomAccess) });
export const useEndLesson = (id: number) => { const qc = useQueryClient(); return useMutation({ mutationFn: () => api.post(`/bookings/${id}/end`, {}, C.Booking), onSuccess: () => invalidateBooking(qc, id) }); };
export const usePostNotes = (id: number) => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: z.infer<typeof C.PostLessonNotes>) => api.post(`/bookings/${id}/notes`, b), onSuccess: () => invalidateBooking(qc, id) }); };
export const useSubmitReview = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: z.infer<typeof C.CreateReview>) => api.post('/reviews', b), onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: [v.targetType, v.targetId] }); qc.invalidateQueries({ queryKey: ['lessons'] }); if (v.gateRef) qc.invalidateQueries({ queryKey: keys.booking(v.gateRef) }); } });
};

/* ---------- السلة والدفع ---------- */
export const useCart = (enabled = true) => useQuery({ queryKey: keys.cart, queryFn: () => api.get('/cart', C.Cart), enabled });
export const useAddToCart = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: z.infer<typeof C.AddToCart>) => api.post('/cart/items', b, C.Cart), onSuccess: (d) => qc.setQueryData(keys.cart, d) }); };
export const useRemoveFromCart = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => api.delete(`/cart/items/${id}`, C.Cart), onSuccess: (d) => qc.setQueryData(keys.cart, d) }); };
export const useApplyCoupon = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (code: string | null) => api.post('/cart/coupon', { code }, C.Cart), onSuccess: (d) => qc.setQueryData(keys.cart, d) }); };
export const usePaymentMethods = () => useQuery({ queryKey: keys.methods, queryFn: () => api.get('/checkout/methods', z.array(C.PaymentMethod)) });
const CheckoutLoose = C.CheckoutResult.extend({ instructions: z.record(z.string(), z.string()).nullable().optional() });
export type CheckoutOutcome = z.infer<typeof CheckoutLoose>;
export const useCheckout = () => {
  const qc = useQueryClient();
  // الطلب يُنسَب للمتعلّم النشط (orders.learner_id) ما لم تحدّد الشاشة متعلّماً بعينه
  return useMutation({ mutationFn: (b: z.infer<typeof C.CheckoutRequest>) => api.post('/checkout', { ...b, learnerId: b.learnerId ?? useAuth.getState().activeLearnerId ?? undefined }, CheckoutLoose), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.cart }); qc.invalidateQueries({ queryKey: keys.wallet }); } });
};
export const useQuote = () => useMutation({ mutationFn: (b: { items: { itemType: string; itemId: number }[]; couponCode?: string | null }) => api.post<{ items: { itemType: string; itemId: number; title: string; price: number; listPrice: number }[]; subtotal: number; discount: number; tax: number; total: number; currency: string }>('/checkout/quote', b) });
/** تأكيد الدفع من المزوّد (POST /orders/:number/confirm) — صفحات العودة والاستطلاع أثناء انتظار البوابة؛ الطلب المُعاد يحدّث ذاكرة الاستعلام */
export const useConfirmOrder = (number: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: (b?: { sessionId?: string }) => api.post(`/orders/${number}/confirm`, b?.sessionId ? b : {}, C.OrderConfirmResult), onSuccess: (r) => qc.setQueryData(keys.order(number), r.order) }); };
export const useOrder = (number: string, poll = false) => useQuery({ queryKey: keys.order(number), queryFn: () => api.get(`/orders/${number}`, C.Order), enabled: !!number, refetchInterval: poll ? 2500 : false });
/** بعد تأكّد الدفع: كل ما يعتمد على الملكية يُعاد جلبه */
export const useAfterPurchase = () => { const qc = useQueryClient(); return () => { for (const k of ['book', 'books', 'course', 'courses', 'lessons', 'booking'] as const) qc.invalidateQueries({ queryKey: [k] }); qc.invalidateQueries({ queryKey: ['home'] }); qc.invalidateQueries({ queryKey: keys.purchases }); qc.invalidateQueries({ queryKey: keys.wallet }); qc.invalidateQueries({ queryKey: keys.cart }); }; };

/* ---------- حسابي ---------- */
export const usePurchases = () => useQuery({ queryKey: keys.purchases, queryFn: () => api.get('/me/purchases', C.PurchasesFeed) });
export const useWallet = () => useQuery({ queryKey: keys.wallet, queryFn: () => api.get('/me/wallet', C.Wallet) });
const NotificationsFeed = z.object({ data: z.array(C.Notification), unread: z.number().int() });
export const useNotifications = (enabled = true) => useQuery({ queryKey: keys.notifications, queryFn: () => api.get('/me/notifications', NotificationsFeed), refetchInterval: 60_000, enabled });
export const useMarkRead = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (ids?: number[]) => api.post('/me/notifications/read', { ids }), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.notifications }); qc.invalidateQueries({ queryKey: ['home'] }); } }); };
const FavoritesFeed = z.object({ books: z.array(C.BookCard), courses: z.array(C.CourseCard), teachers: z.array(C.TeacherCard) });
export const useFavorites = () => useQuery({ queryKey: keys.favorites, queryFn: () => api.get('/me/favorites', FavoritesFeed) });
export const useToggleFavorite = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: z.infer<typeof C.FavoriteToggle>) => api.post<{ favorited: boolean }>('/me/favorites', b), onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: keys.favorites }); qc.invalidateQueries({ queryKey: [v.targetType, v.targetId] }); qc.invalidateQueries({ queryKey: [`${v.targetType}s`] }); qc.invalidateQueries({ queryKey: ['home'] }); } });
};
export const useReport = () => useMutation({ mutationFn: (b: z.infer<typeof C.CreateReport>) => api.post('/reports', b) });
export const useDeleteAccount = () => useMutation({ mutationFn: () => api.delete('/me') });
export const useUploadFile = () => useMutation({
  mutationFn: async ({ uri, name, mime, purpose, blob }: { uri?: string; name: string; mime: string; purpose: string; blob?: Blob }) => {
    const form = new FormData();
    if (blob) form.append('file', blob, name);
    else form.append('file', { uri, name, type: mime } as unknown as Blob);
    return api.post<{ id: number; url: string | null; mime: string; size: number }>(`/files?purpose=${purpose}`, form);
  },
});

/* ---------- الرسائل ---------- */
export const useConversations = () => useQuery({ queryKey: keys.conversations, queryFn: () => api.get('/conversations', z.array(C.Conversation)), refetchInterval: 30_000 });
export const useMessages = (id: number) => useQuery({ queryKey: keys.messages(id), queryFn: () => api.get(`/conversations/${id}/messages`, z.array(C.Message)), enabled: id > 0, refetchInterval: 5_000 });
export const useSendMessage = (id: number) => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: z.infer<typeof C.SendMessage>) => api.post(`/conversations/${id}/messages`, b, C.Message), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.messages(id) }); qc.invalidateQueries({ queryKey: keys.conversations }); } }); };
export const useStartConversation = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { userId: number; context?: { type: 'booking' | 'book' | 'course'; id: number } | null }) => api.post('/conversations', b, C.Conversation), onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }) }); };

/* ---------- تطبيق المعلّم ---------- */
const TeacherMe = C.TeacherDashboard.extend({ documents: z.array(z.any()), lastDecision: z.object({ decision: z.string(), reason: z.string().nullable(), decided_at: z.string() }).nullable() });
export const useTeacherMe = () => useQuery({ queryKey: keys.teacherMe, queryFn: () => api.get('/teacher/me', TeacherMe), retry: false });
const TeacherAvailability = z.object({ rules: z.array(C.AvailabilityRule), timeOff: z.array(C.TimeOff), maxPerDay: z.number() });
export const useTeacherAvailability = () => useQuery({ queryKey: keys.teacherAvailability, queryFn: () => api.get('/teacher/availability', TeacherAvailability) });
export const useSaveAvailability = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (rules: z.infer<typeof C.AvailabilityRules>) => api.put('/teacher/availability', rules), onSuccess: () => qc.invalidateQueries({ queryKey: keys.teacherAvailability }) }); };
export const useAddTimeOff = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: z.infer<typeof C.TimeOff>) => api.post<{ id: number; conflictingBookings: number[] }>('/teacher/time-off', b), onSuccess: () => qc.invalidateQueries({ queryKey: keys.teacherAvailability }) }); };
export const useRemoveTimeOff = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => api.delete(`/teacher/time-off/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: keys.teacherAvailability }) }); };
const EarningsLoose = C.TeacherEarnings.extend({ recent: z.array(z.any()).optional() });
export const useTeacherEarnings = () => useQuery({ queryKey: keys.teacherEarnings, queryFn: () => api.get('/teacher/earnings', EarningsLoose) });
export const useRequestPayout = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: { amount: number; method?: 'bank' | 'wallet'; details?: Record<string, string> }) => api.post('/teacher/payouts', b), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.teacherEarnings }); qc.invalidateQueries({ queryKey: keys.teacherMe }); } }); };
export const useTeacherBookings = () => useQuery({ queryKey: keys.teacherBookings, queryFn: () => api.get('/teacher/bookings', z.object({ upcoming: z.array(C.Booking), past: z.array(C.Booking) })), refetchInterval: 60_000 });
export const useApplyTeacher = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: C.TeacherApplication) => api.post('/teacher/apply', b), onSuccess: async () => { const me = await api.get('/auth/me', C.User); useAuth.getState().setUser(me); qc.invalidateQueries({ queryKey: keys.teacherMe }); } }); };
export const useSavePrices = () => useMutation({ mutationFn: (prices: z.infer<typeof C.LessonPrice>[]) => api.put('/teacher/prices', prices) });

/* ---------- محتوى المعلّم (الكتب) ---------- */
const MyBook = C.BookCard.extend({ status: z.string(), rejectReason: z.string().nullable().optional(), hasFile: z.boolean() });
export const useMyBooks = () => useQuery({ queryKey: ['books', 'mine'] as QueryKey, queryFn: () => api.get('/books/mine', z.array(MyBook)) });
export const useCreateBook = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (b: z.infer<typeof C.BookUpsert>) => api.post<{ id: number }>('/books', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['books', 'mine'] }) }); };
export const useUploadBookFile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookId, kind, uri, name, mime, blob }: { bookId: number; kind: 'full' | 'preview' | 'sample_page' | 'cover'; uri?: string; name: string; mime: string; blob?: Blob }) => {
      const form = new FormData();
      if (blob) form.append('file', blob, name); else form.append('file', { uri, name, type: mime } as unknown as Blob);
      return api.post<{ fileId: number }>(`/books/${bookId}/files?kind=${kind}`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['books', 'mine'] }),
  });
};
export const useSubmitBook = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (bookId: number) => api.post(`/books/${bookId}/submit`), onSuccess: () => qc.invalidateQueries({ queryKey: ['books', 'mine'] }) }); };
/** طلاب المعلّم = متعلّمون (LearnerRef فقط — لا هاتف ولا بريد ولا معرّف حساب). المسار للمعلّم المعتمد فقط: لا نطلبه قبل الاعتماد فيردّ 403 */
export const useTeacherStudents = (enabled = true) => useQuery({ queryKey: ['teacher', 'students'] as QueryKey, queryFn: () => api.get('/teacher/students', z.array(z.object({ learner: C.LearnerRef, lessons: z.number(), lastAt: z.string().nullable() }))), enabled });
