ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

UPDATE store_settings
SET value = jsonb_set(
  value,
  '{address}',
  '{"street":"Rua Lordleens","number":"","neighborhood":"","city":"Maceió","state":"AL","postalCode":""}'::jsonb
)
WHERE key = 'profile'
  AND COALESCE(value->'address'->>'city', '') IN ('', 'São Paulo');

UPDATE delivery_zones
SET city = 'Maceió', updated_at = CURRENT_TIMESTAMP
WHERE id = 'zone-centro-sp' AND city = 'São Paulo';
