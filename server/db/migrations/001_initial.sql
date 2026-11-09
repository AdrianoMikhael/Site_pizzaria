CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_price NUMERIC(10, 2) NOT NULL CHECK (base_price >= 0),
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  street TEXT NOT NULL,
  number TEXT NOT NULL,
  complement TEXT,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL,
  state CHAR(2) NOT NULL,
  postal_code TEXT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  address_id TEXT REFERENCES addresses(id),
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('delivery', 'pickup')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'cash', 'credit_card', 'debit_card')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'cancelled', 'refunded')),
  order_status TEXT NOT NULL DEFAULT 'received' CHECK (order_status IN ('received', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
  subtotal NUMERIC(10, 2) NOT NULL,
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total NUMERIC(10, 2) NOT NULL,
  change_for NUMERIC(10, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(order_status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

INSERT INTO categories (id, slug, name, sort_order) VALUES
  ('cat-pizzas', 'pizzas', 'Pizzas', 1),
  ('cat-bebidas', 'bebidas', 'Bebidas', 2),
  ('cat-sobremesas', 'sobremesas', 'Sobremesas', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, category_id, name, description, base_price) VALUES
  ('pizza-margherita', 'cat-pizzas', 'Margherita da Casa', 'Molho artesanal, muçarela, tomate, manjericão e azeite.', 42.90),
  ('pizza-calabresa', 'cat-pizzas', 'Calabresa Defumada', 'Muçarela, calabresa defumada, cebola roxa e orégano.', 46.90),
  ('pizza-frango', 'cat-pizzas', 'Frango Cremoso', 'Frango temperado, requeijão cremoso, milho e muçarela.', 49.90),
  ('pizza-portuguesa', 'cat-pizzas', 'Portuguesa Especial', 'Presunto, ovos, cebola, azeitona, ervilha e muçarela.', 52.90),
  ('bebida-refrigerante', 'cat-bebidas', 'Refrigerante 2L', 'Escolha o sabor disponível ao finalizar o pedido.', 14.00),
  ('sobremesa-brownie', 'cat-sobremesas', 'Brownie de Chocolate', 'Brownie artesanal com chocolate meio amargo.', 16.90)
ON CONFLICT (id) DO NOTHING;

INSERT INTO store_settings (key, value) VALUES
  ('store', '{"name":"Brasa & Massa","deliveryFee":8,"currency":"BRL"}'),
  ('pix', '{"enabled":true,"key":"PIX-A-DEFINIR","recipient":"Brasa & Massa","manualConfirmation":true}')
ON CONFLICT (key) DO NOTHING;
