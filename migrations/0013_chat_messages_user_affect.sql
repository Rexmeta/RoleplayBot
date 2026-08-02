-- Add user_affect JSONB column to chat_messages for storing UserAffectState analysis
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_affect jsonb;
