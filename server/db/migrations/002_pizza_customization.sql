ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS customizations JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS pizza_sizes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slices INTEGER NOT NULL,
  price_delta NUMERIC(10, 2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pizza_crusts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_delta NUMERIC(10, 2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pizza_addons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_delta NUMERIC(10, 2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO categories (id, slug, name, sort_order, active)
VALUES ('cat-pizzas-doces', 'pizzas-doces', 'Pizzas doces', 2, TRUE)
ON CONFLICT (id) DO NOTHING;

UPDATE categories SET sort_order = 3 WHERE id = 'cat-bebidas';
UPDATE categories SET sort_order = 4 WHERE id = 'cat-sobremesas';

INSERT INTO products (id, category_id, name, description, base_price, active)
VALUES ('pizza-chocolate-morango', 'cat-pizzas-doces', 'Chocolate com Morango', 'Chocolate ao leite, morangos e leite em pó.', 47.90, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pizza_sizes (id, name, slices, price_delta, sort_order) VALUES
  ('size-small', 'Pequena', 4, 0, 1),
  ('size-medium', 'Média', 6, 8, 2),
  ('size-large', 'Grande', 8, 16, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pizza_crusts (id, name, price_delta, sort_order) VALUES
  ('crust-none', 'Sem borda recheada', 0, 1),
  ('crust-catupiry', 'Borda de catupiry', 8, 2),
  ('crust-cheddar', 'Borda de cheddar', 8, 3),
  ('crust-chocolate', 'Borda de chocolate', 9, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pizza_addons (id, name, price_delta, sort_order) VALUES
  ('addon-cheese', 'Muçarela extra', 7, 1),
  ('addon-bacon', 'Bacon', 8, 2),
  ('addon-olive', 'Azeitonas', 4, 3),
  ('addon-cream-cheese', 'Catupiry extra', 7, 4),
  ('addon-strawberry', 'Morangos extras', 8, 5)
ON CONFLICT (id) DO NOTHING;
