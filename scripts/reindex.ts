import { sql } from '@outbox/db';
import { getAllEmailsForIndex } from '@outbox/db';
import {
  createEs,
  ensureEmailsIndex,
  EMAILS_INDEX,
  toEmailDoc,
} from '@outbox/search';

/**
 * Full Elasticsearch rebuild from Postgres (the source of truth). Idempotent:
 * upsert-by-id means running it repeatedly just overwrites each doc. Run after a
 * mapping change, an ES data-loss, or to backfill rows indexed while ES was down.
 *
 *   pnpm reindex
 *
 * ponytail: single bulk pass over all rows, chunked. Fine for demo volume; for a
 * huge table, stream with keyset paging instead of getAllEmailsForIndex().
 */

const CHUNK = 1000;

async function main(): Promise<void> {
  const es = createEs();
  await ensureEmailsIndex(es);

  const rows = await getAllEmailsForIndex();
  let indexed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const operations = slice.flatMap((r) => {
      const doc = toEmailDoc(r);
      return [{ index: { _index: EMAILS_INDEX, _id: doc.id } }, doc];
    });
    const res = await es.bulk({ operations, refresh: i + CHUNK >= rows.length });
    if (res.errors) {
      const firstErr = res.items.find((it) => it.index?.error)?.index?.error;
      throw new Error(`bulk index had errors: ${JSON.stringify(firstErr)}`);
    }
    indexed += slice.length;
    console.log(`  indexed ${indexed}/${rows.length}`);
  }
  console.log(`Reindex complete: ${indexed} email(s).`);
  await sql.end();
}

main().catch((err) => {
  console.error('Reindex failed:', err);
  process.exit(1);
});
