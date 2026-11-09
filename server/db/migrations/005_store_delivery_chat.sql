CREATE TABLE IF NOT EXISTS delivery_zones (
  id TEXT PRIMARY KEY,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  fee NUMERIC(10, 2) NOT NULL CHECK (fee >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_zones_location_idx
  ON delivery_zones (LOWER(neighborhood), LOWER(city));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_review_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_review_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone_id TEXT REFERENCES delivery_zones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_delivery_review_idx ON orders(delivery_review_status);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('question', 'clarification', 'complaint', 'compliment', 'other')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chat_conversations_user_idx ON chat_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_status_idx ON chat_conversations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'admin')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages(conversation_id, created_at);

INSERT INTO store_settings (key, value) VALUES
  ('profile', '{"name":"Brasa & Massa","phone":"","address":{"street":"Rua Lordleens","number":"","neighborhood":"","city":"Maceió","state":"AL","postalCode":""}}'),
  ('operation', '{"status":"automatic","opensAt":"18:00","closesAt":"22:30","etaMin":35,"etaMax":40,"deliveryRadiusKm":5}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO delivery_zones (id, neighborhood, city, fee) VALUES
  ('zone-centro-sp', 'Centro', 'Maceió', 8.00)
ON CONFLICT DO NOTHING;
