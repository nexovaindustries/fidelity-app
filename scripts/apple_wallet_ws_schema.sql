-- Apple Wallet Web Service: auth token + last update timestamp per card
ALTER TABLE public.tarjetas_activas
  ADD COLUMN IF NOT EXISTS apple_auth_token text,
  ADD COLUMN IF NOT EXISTS apple_pass_updated_at timestamptz DEFAULT now();

-- Stores the push token for each device that has a pass saved
CREATE TABLE IF NOT EXISTS public.apple_wallet_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_library_identifier text NOT NULL,
  pass_type_identifier text NOT NULL,
  serial_number text NOT NULL,      -- tarjeta_id
  push_token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_device_pass UNIQUE(device_library_identifier, serial_number)
);

-- RLS: accessible only via service role key (no public access)
ALTER TABLE public.apple_wallet_registrations ENABLE ROW LEVEL SECURITY;
