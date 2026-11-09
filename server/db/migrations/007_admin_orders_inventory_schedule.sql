ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
ALTER TABLE pizza_sizes ADD COLUMN IF NOT EXISTS stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
ALTER TABLE pizza_crusts ADD COLUMN IF NOT EXISTS stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
ALTER TABLE pizza_addons ADD COLUMN IF NOT EXISTS stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'site';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by_admin_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, ingredient_id)
);

UPDATE store_settings
SET value = value || '{
  "weeklyHours": {
    "monday":{"enabled":false,"opensAt":"18:00","closesAt":"22:30"},
    "tuesday":{"enabled":true,"opensAt":"18:00","closesAt":"22:30"},
    "wednesday":{"enabled":true,"opensAt":"18:00","closesAt":"22:30"},
    "thursday":{"enabled":true,"opensAt":"18:00","closesAt":"22:30"},
    "friday":{"enabled":true,"opensAt":"18:00","closesAt":"23:00"},
    "saturday":{"enabled":true,"opensAt":"18:00","closesAt":"23:00"},
    "sunday":{"enabled":true,"opensAt":"18:00","closesAt":"22:30"}
  },
  "specialDates": []
}'::jsonb
WHERE key = 'operation' AND NOT (value ? 'weeklyHours');
