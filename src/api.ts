export type ApiProduct = {
  id: string
  category_id: string
  category_slug: string
  category_name: string
  name: string
  description: string
  base_price: string
  image_url: string | null
  stock_quantity?: number | null
}

export type ApiCategory = {
  id: string
  slug: string
  name: string
  sort_order: number
}

export type SavedAddress = {
  street: string
  number: string
  complement?: string
  neighborhood: string
  city: string
  state: string
  postalCode: string
  reference?: string
}

export type UserPreferences = {
  fulfillmentType?: 'delivery' | 'pickup'
  paymentMethod?: 'pix' | 'cash' | 'credit_card' | 'debit_card'
  address?: SavedAddress
  savedOrderNotes?: string[]
}

export type UserSavedAddress = SavedAddress & { id: string; label: string; is_default: boolean; created_at: string }
export type FavoriteProduct = ApiProduct & { favorited_at: string }
export type InventoryItem = { item_type: 'product' | 'size' | 'crust' | 'addon'; id: string; name: string; stock_quantity: number | null; low_stock_threshold: number; active: boolean; is_low: boolean }
export type InventoryMovement = { id: string; item_type: string; item_id: string; item_name: string; quantity_delta: number; reason: string; order_id: string | null; created_at: string }
export type InventoryOverview = { items: InventoryItem[]; movements: InventoryMovement[]; lowStockCount: number }

export type AuthUser = {
  id: string
  role: 'customer' | 'admin'
  name: string
  email: string
  phone: string | null
  preferences: UserPreferences
  emailVerified: boolean
}

export type RegistrationResult = {
  requiresEmailVerification: true
  email: string
  message: string
  emailDelivery?: 'sent' | 'development' | 'failed'
  developmentVerificationUrl?: string
}

export type UserOrder = {
  id: string
  tracking_code: string
  fulfillment_type: 'delivery' | 'pickup'
  payment_method: string
  payment_status: string
  order_status: string
  total: string
  created_at: string
}

export type AdminCategory = ApiCategory & { active: boolean }
export type AdminProduct = ApiProduct & { active: boolean; updated_at: string }
export type AdminCustomizationOption = { id: string; name: string; price_delta: string; active: boolean; stock_quantity: number | null; type: 'size' | 'crust' | 'addon' }
export type AdminIngredient = { id: string; name: string; active: boolean; product_ids: string[]; updated_at: string }

export type PizzaSize = { id: string; name: string; slices: number; price_delta: string }
export type PizzaChoice = { id: string; name: string; price_delta: string }
export type PizzaCustomizations = {
  sizes: PizzaSize[]
  crusts: PizzaChoice[]
  addons: PizzaChoice[]
}

export type CartCustomization = {
  secondFlavorId?: string
  sizeId?: string
  crustId?: string
  addonIds: string[]
}

export type CartLine = ApiProduct & {
  cartKey: string
  quantity: number
  unitPrice: number
  displayName: string
  customizationLabel?: string
  customization: CartCustomization
}

export type CreatedOrder = {
  id: string
  trackingCode: string
  customerPhone: string
  orderStatus: string
  paymentStatus: string
  total: number
  deliveryFee: number
  deliveryReviewStatus: 'not_required' | 'pending'
  message: string
}

export type StoreProfile = {
  name: string
  phone: string
  address: { street: string; number: string; neighborhood: string; city: string; state: string; postalCode: string }
}

export type StoreOperation = {
  status: 'automatic' | 'open' | 'closed' | 'paused'
  opensAt: string
  closesAt: string
  etaMin: number
  etaMax: number
  deliveryRadiusKm: number
  weeklyHours: Record<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday', { enabled: boolean; opensAt: string; closesAt: string }>
  specialDates: Array<{ date: string; label: string; closed: boolean; opensAt?: string; closesAt?: string }>
}

export type StoreInfo = {
  profile: StoreProfile
  operation: StoreOperation
  currentStatus: 'open' | 'closed' | 'paused'
  isAcceptingOrders: boolean
  statusLabel: string
  effectiveHours?: { date: string; weekday: string; enabled: boolean; opensAt: string; closesAt: string; label: string | null }
}

export type DeliveryZone = {
  id: string
  neighborhood: string
  city: string
  fee: string
  active: boolean
  updated_at: string
}

export type DeliveryQuote = {
  serviceStatus: 'available' | 'review'
  deliveryFee: number | null
  zoneId: string | null
  radiusKm: number
  message: string
}

export type CepAddress = {
  postalCode: string
  street: string
  complement: string
  neighborhood: string
  city: string
  state: string
}

export type ChatConversation = {
  id: string
  category: 'question' | 'clarification' | 'complaint' | 'compliment' | 'other'
  subject: string
  status: 'open' | 'closed'
  created_at: string
  updated_at: string
  unread?: boolean
  last_message?: string
  customer_name?: string
  customer_email?: string
}

export type ChatMessage = { id: string; sender_role: 'customer' | 'admin'; message: string; created_at: string }
export type ChatThread = { conversation: ChatConversation; messages: ChatMessage[] }

export type AdminOrder = {
  id: string
  tracking_code: string
  fulfillment_type: 'delivery' | 'pickup'
  payment_method: string
  payment_status: string
  order_status: string
  total: string
  created_at: string
  customer_name: string
  customer_phone: string
  delivery_fee: string
  delivery_review_status: 'not_required' | 'pending' | 'approved' | 'rejected'
  delivery_review_note: string | null
  neighborhood: string | null
  city: string | null
  estimated_minutes: number | null
  accepted_at: string | null
  is_delayed?: boolean
}

export type AdminOrderFilters = {
  status?: string
  fulfillmentType?: string
  paymentMethod?: string
  paymentStatus?: string
}

export type Dashboard = {
  period: 'day' | 'week' | 'month' | 'custom'
  from: string | null
  to: string | null
  revenue: number
  paidOrders: number
  averageTicket: number
  ordersByStatus: Array<{ status: string; total: number | string }>
  recentOrders: AdminOrder[]
}

export type DashboardFilter =
  | { period: 'day' | 'week' | 'month' }
  | { from: string; to: string }

export type OrderItem = {
  id: string
  product_id: string
  product_name: string
  unit_price: string
  quantity: number
  notes: string | null
  customizations: {
    flavors?: string[]
    secondFlavorId?: string | null
    size?: { id: string; name: string; priceDelta: number } | null
    crust?: { id: string; name: string; priceDelta: number } | null
    addons?: Array<{ id: string; name: string; priceDelta: number }>
  }
}

export type StatusHistory = {
  status: string
  note: string | null
  created_at: string
}

export type OrderDetails = AdminOrder & {
  customer_email: string | null
  street: string | null
  number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  reference: string | null
  subtotal: string
  delivery_fee: string
  discount: string
  change_for: string | null
  notes: string | null
  items: OrderItem[]
  status_history: StatusHistory[]
  email_notifications?: Array<{ status: string; recipient: string; delivery: string; error: string | null; created_at: string }>
}

export function customizationSummary(item: OrderItem) {
  const parts = [
    item.customizations?.size?.name,
    item.customizations?.crust?.name && item.customizations.crust.id !== 'crust-none' ? item.customizations.crust.name : undefined,
    ...(item.customizations?.addons?.map((addon) => addon.name) ?? []),
  ]
  return parts.filter(Boolean).join(' · ')
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const text = await response.text()
  const body = text ? JSON.parse(text) : undefined
  if (!response.ok) throw new Error(body?.error ?? 'Não foi possível concluir a operação.')
  return body as T
}

const adminHeaders = (key?: string, json = false) => ({
  ...(json ? { 'content-type': 'application/json' } : {}),
  ...(key ? { 'x-admin-key': key } : {}),
})

async function verifyEmailWithTimeout(token: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    return await request<{ redirectTo: string }>('/api/auth/verify-email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }), signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A confirmação demorou mais que o esperado. Verifique se a API está ligada e tente novamente.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export const api = {
  store: () => request<StoreInfo>('/api/store'),
  register: (payload: unknown) => request<RegistrationResult>('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  resendVerification: (email: string) => request<{ message: string; developmentVerificationUrl?: string }>('/api/auth/resend-verification', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  }),
  verifyEmail: verifyEmailWithTimeout,
  forgotPassword: (email: string) => request<{ message: string; developmentResetUrl?: string }>('/api/auth/forgot-password', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  }),
  resetPassword: (token: string, password: string) => request<{ message: string; redirectTo: string }>('/api/auth/reset-password', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }),
  }),
  login: (payload: unknown) => request<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AuthUser }>('/api/auth/me'),
  updateProfile: (payload: unknown) => request<{ user: AuthUser }>('/api/auth/profile', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  myOrders: () => request<{ orders: UserOrder[]; total: number; page: number }>('/api/auth/orders?limit=100'),
  myOrder: (orderId: string) => request<OrderDetails>(`/api/auth/orders/${orderId}`),
  myAddresses: () => request<{ addresses: UserSavedAddress[] }>('/api/auth/addresses'),
  createAddress: (payload: unknown) => request<{ id: string }>('/api/auth/addresses', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  updateAddress: (addressId: string, payload: unknown) => request<{ id: string }>(`/api/auth/addresses/${addressId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  deleteAddress: (addressId: string) => request<void>(`/api/auth/addresses/${addressId}`, { method: 'DELETE' }),
  favorites: () => request<{ products: FavoriteProduct[] }>('/api/auth/favorites'),
  addFavorite: (productId: string) => request<{ productId: string }>(`/api/auth/favorites/${productId}`, { method: 'POST' }),
  removeFavorite: (productId: string) => request<void>(`/api/auth/favorites/${productId}`, { method: 'DELETE' }),
  products: () => request<{ products: ApiProduct[] }>('/api/products'),
  categories: () => request<{ categories: ApiCategory[] }>('/api/categories'),
  customizations: () => request<PizzaCustomizations>('/api/customizations'),
  lookupCep: (cep: string) => request<CepAddress>(`/api/delivery/cep/${encodeURIComponent(cep)}`),
  deliveryQuote: (payload: unknown) => request<DeliveryQuote>('/api/delivery/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  createOrder: (payload: unknown) =>
    request<CreatedOrder>('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  trackOrder: (trackingCode: string, phone: string) =>
    request<OrderDetails>(`/api/orders/track/${encodeURIComponent(trackingCode)}?phone=${encodeURIComponent(phone)}`),
  adminOrders: (key?: string, filters: AdminOrderFilters = {}) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as Array<[string, string]>)
    return request<{ orders: AdminOrder[] }>(`/api/admin/orders${params.size ? `?${params}` : ''}`, { headers: adminHeaders(key) })
  },
  adminOrder: (key: string | undefined, orderId: string) =>
    request<OrderDetails>(`/api/admin/orders/${orderId}`, { headers: adminHeaders(key) }),
  adminSettings: (key?: string) => request<{ profile: StoreProfile; operation: StoreOperation }>('/api/admin/settings', { headers: adminHeaders(key) }),
  updateAdminSettings: (key: string | undefined, payload: unknown) => request<StoreInfo>('/api/admin/settings', {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  adminDeliveryZones: (key?: string) => request<{ zones: DeliveryZone[] }>('/api/admin/delivery-zones', { headers: adminHeaders(key) }),
  createDeliveryZone: (key: string | undefined, payload: unknown) => request<DeliveryZone>('/api/admin/delivery-zones', {
    method: 'POST', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  updateDeliveryZone: (key: string | undefined, id: string, payload: unknown) => request<DeliveryZone>(`/api/admin/delivery-zones/${id}`, {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  reviewDelivery: (key: string | undefined, orderId: string, payload: unknown) => request<OrderDetails>(`/api/admin/orders/${orderId}/delivery-review`, {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  editAdminOrder: (key: string | undefined, orderId: string, payload: unknown) => request<OrderDetails>(`/api/admin/orders/${orderId}/edit`, {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  adminCategories: (key?: string) =>
    request<{ categories: AdminCategory[] }>('/api/admin/categories', { headers: adminHeaders(key) }),
  createCategory: (key: string | undefined, payload: unknown) =>
    request<AdminCategory>('/api/admin/categories', {
      method: 'POST', headers: adminHeaders(key, true),
      body: JSON.stringify(payload),
    }),
  updateCategory: (key: string | undefined, categoryId: string, payload: unknown) =>
    request<AdminCategory>(`/api/admin/categories/${categoryId}`, {
      method: 'PATCH', headers: adminHeaders(key, true),
      body: JSON.stringify(payload),
    }),
  adminProducts: (key?: string) =>
    request<{ products: AdminProduct[] }>('/api/admin/products', { headers: adminHeaders(key) }),
  adminCustomizations: (key?: string) => request<{ options: AdminCustomizationOption[] }>('/api/admin/customizations', { headers: adminHeaders(key) }),
  updateAdminCustomization: (key: string | undefined, id: string, payload: unknown) => request<AdminCustomizationOption>(`/api/admin/customizations/${id}`, {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  adminIngredients: (key?: string) => request<{ ingredients: AdminIngredient[] }>('/api/admin/ingredients', { headers: adminHeaders(key) }),
  createIngredient: (key: string | undefined, payload: unknown) => request<{ id: string }>('/api/admin/ingredients', {
    method: 'POST', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  updateIngredient: (key: string | undefined, id: string, payload: unknown) => request(`/api/admin/ingredients/${id}`, {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  adminInventory: (key?: string) => request<InventoryOverview>('/api/admin/inventory', { headers: adminHeaders(key) }),
  restockInventory: (key: string | undefined, payload: unknown) => request('/api/admin/inventory/restock', {
    method: 'POST', headers: adminHeaders(key, true), body: JSON.stringify(payload),
  }),
  createProduct: (key: string | undefined, payload: unknown) =>
    request<AdminProduct>('/api/admin/products', {
      method: 'POST', headers: adminHeaders(key, true),
      body: JSON.stringify(payload),
    }),
  updateProduct: (key: string | undefined, productId: string, payload: unknown) =>
    request<AdminProduct>(`/api/admin/products/${productId}`, {
      method: 'PATCH', headers: adminHeaders(key, true),
      body: JSON.stringify(payload),
    }),
  dashboard: (key: string | undefined, filter: DashboardFilter) => {
    const params = 'period' in filter
      ? new URLSearchParams({ period: filter.period })
      : new URLSearchParams({ from: filter.from, to: filter.to })
    return request<Dashboard>(`/api/admin/dashboard?${params}`, { headers: adminHeaders(key) })
  },
  updateStatus: (key: string | undefined, orderId: string, payload: string | { status: string; note?: string; estimatedMinutes?: number }) =>
    request(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: adminHeaders(key, true),
      body: JSON.stringify(typeof payload === 'string' ? { status: payload } : payload),
    }),
  updatePayment: (key: string | undefined, orderId: string, status: string) =>
    request(`/api/admin/orders/${orderId}/payment`, {
      method: 'PATCH',
      headers: adminHeaders(key, true),
      body: JSON.stringify({ status }),
    }),
  myChats: () => request<{ conversations: ChatConversation[] }>('/api/chat/conversations'),
  createChat: (payload: unknown) => request<{ id: string }>('/api/chat/conversations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }),
  chatThread: (id: string) => request<ChatThread>(`/api/chat/conversations/${id}/messages`),
  sendChatMessage: (id: string, message: string) => request(`/api/chat/conversations/${id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }),
  }),
  adminChats: (key?: string) => request<{ conversations: ChatConversation[] }>('/api/admin/chats', { headers: adminHeaders(key) }),
  adminChatThread: (key: string | undefined, id: string) => request<ChatThread>(`/api/admin/chats/${id}/messages`, { headers: adminHeaders(key) }),
  sendAdminChatMessage: (key: string | undefined, id: string, message: string) => request(`/api/admin/chats/${id}/messages`, {
    method: 'POST', headers: adminHeaders(key, true), body: JSON.stringify({ message }),
  }),
  updateChatStatus: (key: string | undefined, id: string, status: 'open' | 'closed') => request(`/api/admin/chats/${id}`, {
    method: 'PATCH', headers: adminHeaders(key, true), body: JSON.stringify({ status }),
  }),
}
