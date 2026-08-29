import { eq } from 'drizzle-orm';
import type { Me } from '@outbox/shared';
import { db } from './index.js';
import { users } from './schema.js';

/**
 * Get-or-create a user by their Google subject id. Phase 6's OAuth callback
 * calls this at login; until then a test token drives it so Phase 2 endpoints
 * have a real, persisted user to scope by.
 *
 * ponytail: upsert lives here, not per-request. The auth middleware only needs
 * getUser once a token exists; this is the login-time write.
 */
export async function ensureUser(profile: {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<Me> {
  const [row] = await db
    .insert(users)
    .values({
      googleSub: profile.googleSub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl ?? null,
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl ?? null,
      },
    })
    .returning();
  if (!row) throw new Error('user upsert returned no row');
  return toMe(row);
}

export async function getUser(id: string): Promise<Me | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toMe(row) : null;
}

function toMe(row: typeof users.$inferSelect): Me {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
  };
}
