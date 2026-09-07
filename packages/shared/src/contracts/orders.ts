import { z } from 'zod';
import { Id, Money, Currency, IsoDateTime } from './common';
import { LearnerRef } from './auth';

export const CartItemType = z.enum(['book', 'course']);
export const OrderItemType = z.enum(['book', 'course', 'lesson', 'package', 'subscription']);
export const OrderStatus = z.enum(['pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled', 'expired']);
export const PaymentProviderId = z.enum(['mock', 'wallet', 'manual', 'thawani', 'stripe']);
/** وسيلة الطلب كما تُسجَّل: وسائل الدفع + «free» لطلب بقيمة صفر (كوبون كامل/محتوى مجاني) — لا تُطلب من العميل */
export const OrderProviderId = z.enum([...PaymentProviderId.options, 'free']);

export const CartItem = z.object({
  id: Id,
  itemType: CartItemType,
  itemId: Id,
  title: z.string(),
  coverUrl: z.string().nullable(),
  price: Money,
  listPrice: Money,
  teacherName: z.string().nullable(),
});

export const Cart = z.object({
  items: z.array(CartItem),
  subtotal: Money,
  discount: Money,
  tax: Money,
  taxRate: z.number(),
  total: Money,
  currency: Currency,
  coupon: z.object({ code: z.string(), type: z.enum(['percentage', 'fixed']), value: z.number() }).nullable(),
});
export type Cart = z.infer<typeof Cart>;

export const AddToCart = z.object({ itemType: CartItemType, itemId: Id });
export const ApplyCoupon = z.object({ code: z.string().trim().max(40).nullable() });

/** وضع البوابة: uat (ثواني) / test (Stripe) = بيئة تجربة، live = حقيقي، null = بلا بوابة خارجية */
export const PaymentProviderMode = z.enum(['uat', 'test', 'live']);
export const PaymentMethod = z.object({
  id: PaymentProviderId,
  label: z.string(),
  description: z.string().nullable(),
  /** للتحويل اليدوي */
  instructions: z.record(z.string(), z.string()).nullable(),
  mode: PaymentProviderMode.nullable().default(null),
});
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const CheckoutRequest = z.object({
  provider: PaymentProviderId,
  couponCode: z.string().trim().max(40).nullable().optional(),
  /** إن أُرسلت تُشترى مباشرة دون السلة (حصة/باقة) */
  items: z.array(z.object({ itemType: OrderItemType, itemId: Id })).optional(),
  bookingId: Id.optional(),
  /** نسبة الطلب لمتعلّم (للعرض والتقارير فقط — الوصول على مستوى الحساب) */
  learnerId: Id.optional(),
});

export const OrderItem = z.object({
  itemType: OrderItemType, itemId: Id, title: z.string(), unitPrice: Money, quantity: z.number().int(),
});
export const Order = z.object({
  id: Id,
  number: z.string(),
  status: OrderStatus,
  subtotal: Money, discount: Money, tax: Money, total: Money,
  currency: Currency,
  provider: OrderProviderId.nullable(),
  items: z.array(OrderItem),
  createdAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  invoiceUrl: z.string().nullable(),
  /** المتعلّم المنسوب إليه الطلب (null لطلب بلا متعلّم) — يحمله orderView في كل مكان */
  learner: LearnerRef.nullable(),
});
export type Order = z.infer<typeof Order>;

export const CheckoutResult = z.object({
  order: Order,
  paid: z.boolean(),
  requiresRedirect: z.boolean(),
  checkoutUrl: z.string().nullable(),
  awaitingReview: z.boolean(),
});
export type CheckoutResult = z.infer<typeof CheckoutResult>;

/** POST /orders/:number/confirm — sessionId تلميح اختياري من صفحة عودة Stripe (?session_id=) */
export const OrderConfirmRequest = z.object({ sessionId: z.string().trim().max(200).optional() });
export const OrderConfirmResult = z.object({
  status: OrderStatus,
  paid: z.boolean(),
  provider: z.string().nullable(),
  order: Order,
});
export type OrderConfirmResult = z.infer<typeof OrderConfirmResult>;

export const RefundRequest = z.object({
  orderId: Id.optional(),
  bookingId: Id.optional(),
  reason: z.string().trim().max(500),
});

export const PurchasesFeed = z.object({
  books: z.array(z.object({ id: Id, title: z.string(), coverUrl: z.string().nullable(), purchasedAt: IsoDateTime })),
  courses: z.array(z.object({ id: Id, title: z.string(), coverUrl: z.string().nullable(), purchasedAt: IsoDateTime, progressPercent: z.number() })),
  lessons: z.array(z.object({ bookingId: Id, teacherName: z.string(), subjectName: z.string(), startsAt: IsoDateTime, price: Money, status: z.string() })),
  subscriptions: z.array(z.object({ id: Id, planName: z.string(), status: z.string(), endsAt: IsoDateTime })),
  orders: z.array(Order),
});

export const Wallet = z.object({
  balance: Money,
  currency: Currency,
  transactions: z.array(z.object({
    id: Id, type: z.string(), amount: z.number(), balanceAfter: Money, note: z.string().nullable(), createdAt: IsoDateTime,
  })),
});

export const Coupon = z.object({
  id: Id,
  code: z.string(),
  type: z.enum(['percentage', 'fixed']),
  value: z.number(),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  usageLimit: z.number().int().nullable(),
  userLimit: z.number().int().nullable(),
  usedCount: z.number().int(),
  scope: z.object({
    products: z.array(z.object({ type: OrderItemType, id: Id })).optional(),
    teacherId: Id.optional(),
    category: z.string().optional(),
    /** كوبون معروض في الرئيسية بعنوانه — يقرأهما home/offers ولوحة الكوبونات */
    featured: z.boolean().optional(),
    title: z.string().optional(),
  }),
  active: z.boolean(),
});
/** إنشاء كوبون: القيمة والسقوف والنطاق تُتحقّق هنا — نسبة ١..٩٠٪ أو مبلغ ثابت موجب، وفئة معروفة */
export const CouponUpsert = Coupon.omit({ id: true, usedCount: true }).extend({
  code: z.string().trim().min(3).max(30).transform(v => v.toUpperCase()),
  value: z.number().positive('قيمة الخصم يجب أن تكون أكبر من صفر'),
  usageLimit: z.number().int().min(1, 'سقف الاستخدام يبدأ من ١').nullable(),
  userLimit: z.number().int().min(1, 'سقف المستخدم يبدأ من ١').nullable(),
  scope: z.object({
    products: z.array(z.object({ type: OrderItemType, id: Id })).optional(),
    teacherId: Id.optional(),
    category: OrderItemType.optional(),
    featured: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(),
  }),
})
  .refine(c => c.type !== 'percentage' || (c.value >= 1 && c.value <= 90), { message: 'نسبة الخصم بين ١٪ و٩٠٪', path: ['value'] })
  .refine(c => !c.startsAt || !c.endsAt || c.endsAt >= c.startsAt, { message: 'تاريخ الانتهاء قبل تاريخ البداية', path: ['endsAt'] });
