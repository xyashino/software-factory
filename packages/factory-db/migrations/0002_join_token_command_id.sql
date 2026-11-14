-- A join token remembers the command that created it, so a replayed create cannot make a second token.
-- Nullable: tokens created before this migration have no command id. SQLite allows many NULLs under UNIQUE.

ALTER TABLE join_tokens ADD COLUMN command_id TEXT;
CREATE UNIQUE INDEX join_tokens_command_id ON join_tokens (command_id);
