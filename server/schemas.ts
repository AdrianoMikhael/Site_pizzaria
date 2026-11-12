import { z } from 'zod'

export const orderStatusSchema = z.enum([
  'received',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
])

export const paymentStatusSchema = z.enum(['pending', 'paid', 'cancelled', 'refunded'])

export const savedAddressSchema = z.object({
  street: z.string().trim().min(2).max(160),
  number: z.string().trim().min(1).max(20),
  complement: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  postalCode: z.string().trim().min(8).max(10),
  reference: z.string().trim().max(160).optional(),
})

export const userPreferencesSchema = z.object({
  fulfillmentType: z.enum(['delivery', 'pickup']).optional(),
  paymentMethod: z.enum(['pix', 'cash', 'credit_card', 'debit_card']).optional(),
  address: savedAddressSchema.optional(),
  savedOrderNotes: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
})

const passwordSchema = z.string().min(8).max(128)
  .regex(/[A-Za-z]/, 'A senha precisa ter uma letra.')
  .regex(/\d/, 'A senha precisa ter um número.')

export const registerSchema = z.object({
  role: z.enum(['customer', 'admin']).default('customer'),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(10).max(20).optional(),
  password: passwordSchema,
  returnTo: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.role === 'customer' && !value.phone) {
    context.addIssue({ code: 'custom', path: ['phone'], message: 'Telefone é obrigatório para clientes.' })
  }
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(128),
})

export const resendVerificationSchema = z.object({
  email: z.string().trim().email().max(160),
})

export const verifyEmailSchema = z.object({
  token: z.string().min(32).max(200),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(160),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(200),
  password: passwordSchema,
})

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().min(10).max(20).nullable().optional(),
  preferences: userPreferencesSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.')

const categoryFields = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
})

export const categoryInputSchema = categoryFields.extend({
  sortOrder: categoryFields.shape.sortOrder.default(0),
  active: categoryFields.shape.active.default(true),
})

export const categoryUpdateSchema = categoryFields.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Informe ao menos um campo para atualizar.',
)

const productFields = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500),
  basePrice: z.number().positive().max(9999.99),
  imageUrl: z.string().url().max(500).nullable().optional(),
  active: z.boolean(),
  stockQuantity: z.number().int().min(0).max(99999).nullable().optional(),
})

export const productInputSchema = productFields.extend({
  description: productFields.shape.description.default(''),
  active: productFields.shape.active.default(true),
})

export const productUpdateSchema = productFields.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Informe ao menos um campo para atualizar.',
)

const scheduleDaySchema = z.object({
  enabled: z.boolean(),
  opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
})

const defaultWeeklyHours = {
  monday: { enabled: false, opensAt: '18:00', closesAt: '22:30' },
  tuesday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
  wednesday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
  thursday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
  friday: { enabled: true, opensAt: '18:00', closesAt: '23:00' },
  saturday: { enabled: true, opensAt: '18:00', closesAt: '23:00' },
  sunday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
}

export const storeSettingsSchema = z.object({
  profile: z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(20),
    address: z.object({
      street: z.string().trim().max(160),
      number: z.string().trim().max(20),
      neighborhood: z.string().trim().max(100),
      city: z.string().trim().max(100),
      state: z.string().trim().max(2).transform((value) => value.toUpperCase()),
      postalCode: z.string().trim().max(10),
    }),
  }),
  operation: z.object({
    status: z.enum(['automatic', 'open', 'closed', 'paused']),
    opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    etaMin: z.number().int().min(5).max(240),
    etaMax: z.number().int().min(5).max(240),
    deliveryRadiusKm: z.number().positive().max(100),
    weeklyHours: z.object({
      monday: scheduleDaySchema, tuesday: scheduleDaySchema, wednesday: scheduleDaySchema,
      thursday: scheduleDaySchema, friday: scheduleDaySchema, saturday: scheduleDaySchema, sunday: scheduleDaySchema,
    }).default(defaultWeeklyHours),
    specialDates: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      label: z.string().trim().min(2).max(100),
      closed: z.boolean(),
      opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    })).max(100).default([]),
  }).refine((value) => value.etaMax >= value.etaMin, {
    message: 'O tempo máximo deve ser maior ou igual ao mínimo.', path: ['etaMax'],
  }),
})

const deliveryZoneFields = z.object({
  neighborhood: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  fee: z.number().nonnegative().max(999.99),
  active: z.boolean(),
})

export const deliveryZoneInputSchema = deliveryZoneFields.extend({ active: z.boolean().default(true) })
export const deliveryZoneUpdateSchema = deliveryZoneFields.partial().refine(
  (value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.',
)

export const deliveryQuoteSchema = z.object({
  neighborhood: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(8).max(10).optional(),
})

export const deliveryReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  deliveryFee: z.number().nonnegative().max(999.99).optional(),
  note: z.string().trim().max(300).optional(),
}).superRefine((value, context) => {
  if (value.status === 'approved' && value.deliveryFee === undefined) {
    context.addIssue({ code: 'custom', path: ['deliveryFee'], message: 'Informe a taxa para aprovar a entrega.' })
  }
  if (value.status === 'rejected' && (!value.note || value.note.length < 3)) {
    context.addIssue({ code: 'custom', path: ['note'], message: 'Informe o motivo da recusa.' })
  }
})

export const chatConversationSchema = z.object({
  category: z.enum(['question', 'clarification', 'complaint', 'compliment', 'other']),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(1).max(2000),
})

export const chatMessageSchema = z.object({ message: z.string().trim().min(1).max(2000) })
export const chatStatusSchema = z.object({ status: z.enum(['open', 'closed']) })

export const customizationAvailabilitySchema = z.object({
  type: z.enum(['size', 'crust', 'addon']),
  active: z.boolean().optional(),
  stockQuantity: z.number().int().min(0).max(99999).nullable().optional(),
}).refine((value) => value.active !== undefined || value.stockQuantity !== undefined, 'Informe uma alteração.')

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  active: z.boolean().default(true),
  productIds: z.array(z.string().min(1)).max(100).default([]),
})

export const ingredientUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  active: z.boolean().optional(),
  productIds: z.array(z.string().min(1)).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Informe uma alteração.')

export const createOrderSchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(2).max(100),
      phone: z.string().trim().min(10).max(20),
      email: z.string().trim().email().max(160).optional(),
    }),
    fulfillmentType: z.enum(['delivery', 'pickup']),
    address: savedAddressSchema.optional(),
    paymentMethod: z.enum(['pix', 'cash', 'credit_card', 'debit_card']),
    changeFor: z.number().nonnegative().optional(),
    notes: z.string().trim().max(500).optional(),
    saveAddressLabel: z.string().trim().min(2).max(40).optional(),
    saveNote: z.boolean().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          secondFlavorId: z.string().min(1).optional(),
          sizeId: z.string().min(1).optional(),
          crustId: z.string().min(1).optional(),
          addonIds: z.array(z.string().min(1)).max(5).default([]),
          quantity: z.number().int().min(1).max(20),
          notes: z.string().trim().max(200).optional(),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((order, context) => {
    if (order.fulfillmentType === 'delivery' && !order.address) {
      context.addIssue({ code: 'custom', path: ['address'], message: 'Endereço é obrigatório para entrega.' })
    }
    if (order.paymentMethod !== 'cash' && order.changeFor !== undefined) {
      context.addIssue({ code: 'custom', path: ['changeFor'], message: 'Troco só pode ser informado para pagamento em dinheiro.' })
    }
  })

export type CreateOrderInput = z.infer<typeof createOrderSchema>
