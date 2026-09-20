-- Chat moderation metadata. Soft deletion keeps the audit trail while hiding removed content from members.
ALTER TABLE messages ADD COLUMN deleted_at TEXT;
ALTER TABLE messages ADD COLUMN deleted_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at);
