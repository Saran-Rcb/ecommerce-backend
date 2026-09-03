-- Add authentication/profile fields required by the current User model.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "authProvider" TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "googleId" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- Google accounts must have a unique googleId when supplied.
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key"
  ON "User"("googleId");
