import { z } from 'zod';
import { Id, Money, Currency, IsoDateTime } from './common';

export const CartItemType = z.enum(['book', 'course']);
export const OrderItemType = z.enum(['book', 'course', 'lesson', 'package', 'subscription']);
export const OrderStatus = z.enum(['pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled', 'expired']);
export const PaymentProviderId = z.enum(['mock', 'wallet', 'manual', 'thawani', 'stripe']);

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

export const PaymentMethod = z.object({
  id: PaymentProviderId,
  label: z.string(),
  description: z.string().nullable(),
  /** للتحويل اليدوي */
  instructions: z.record(z.string(), z.string()).nullable(),
});

export const CheckoutRequest = z.object({
  provider: PaymentProviderId,
  couponCode: z.string().trim().max(40).nullable().optional(),
  /** إن أُرسلت تُشترى مباشرة دون السلة (حصة/باقة) */
  items: z.array(z.object({ itemType: OrderItemType, itemId: Id })).optional(),
  bookingId: Id.optional(),
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
  provider: PaymentProviderId.nullable(),
  items: z.array(OrderItem),
  createdAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  invoiceUrl: z.string().nullable(),
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
  }),
  active: z.boolean(),
});
export const CouponUpsert = Coupon.omit({ id: true, usedCount: true }).extend({
  code: z.string().trim().min(3).max(30).transform(v => v.toUpperCase()),
});
