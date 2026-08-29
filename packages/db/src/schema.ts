import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema. All timestamps are `timestamptz`, stored UTC, converted only
 * at render time (CONVENTIONS.md). IDs are server-generated UUIDs. Every email status
 * write goes through packages/db/emails.ts — nothing writes these tables ad hoc.
 */

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const emailStatus = pgEnum('email_status', [
  'scheduled',
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled',
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const senders = pgTable('senders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  fromName: text('from_name').notNull(),
  fromEmail: text('from_email').notNull(),
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull(),
  smtpUser: text('smtp_user').notNull(),
  smtpPass: text('smtp_pass').notNull(),
  hourlyLimit: integer('hourly_limit'), // NULL = fall back to env global limit
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const slackIntegrations = pgTable('slack_integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),
  channel: text('channel').notNull(),
  webhookUrl: text('webhook_url').notNull(),
  accessToken: text('access_token').notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  startAt: ts('start_at').notNull(),
  delayMs: integer('delay_ms').notNull(),
  hourlyLimit: integer('hourly_limit'), // NULL = fall back to sender/env limit
  totalRecipients: integer('total_recipients').notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const emails = pgTable(
  'emails',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Sender is assigned when the worker claims the job (Phase 3), so null while
    // the row is merely scheduled.
    senderId: uuid('sender_id').references(() => senders.id, {
      onDelete: 'set null',
    }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: emailStatus('status').notNull().default('scheduled'),
    seq: integer('seq').notNull(),
    scheduledAt: ts('scheduled_at').notNull(),
    sentAt: ts('sent_at'),
    attempts: integer('attempts').notNull().default(0),
    messageId: text('message_id'),
    previewUrl: text('preview_url'),
    lastError: text('last_error'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('emails_campaign_recipient_uq').on(t.campaignId, t.recipient),
    index('emails_status_scheduled_idx').on(t.status, t.scheduledAt),
    index('emails_user_status_scheduled_idx').on(
      t.userId,
      t.status,
      t.scheduledAt.desc(),
    ),
    index('emails_campaign_seq_idx').on(t.campaignId, t.seq),
  ],
);
