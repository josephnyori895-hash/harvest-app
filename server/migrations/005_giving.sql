-- 005_giving.sql — persistent giving/payment ledger
CREATE TABLE IF NOT EXISTS giving_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  amount_kes NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  purpose TEXT NOT NULL DEFAULT 'General Giving',
  provider TEXT NOT NULL DEFAULT 'mpesa',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  receipt_number TEXT,
  provider_result_code TEXT,
  provider_result_description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_giving_user_created ON giving_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_status_created ON giving_transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_receipt ON giving_transactions(receipt_number) WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_giving_merchant ON giving_transactions(merchant_request_id) WHERE merchant_request_id IS NOT NULL;
