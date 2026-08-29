import Papa from 'papaparse';

/** Loose email shape check. Deliberately not RFC 5322 — the API re-validates with
 * Zod's `.email()`; this only needs to separate obvious addresses from garbage so
 * the compose UI can show a trustworthy count before submit. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Secondary split inside a PapaParse cell: Papa detects ONE delimiter per file,
 * so a file that mixes `,` `;` tabs or spaces leaves multiple addresses in one
 * cell. Splitting each cell again on any of these recovers them. */
const SEP_RE = /[,;\s|]+/;

export interface ParsedLeads {
  /** Deduped, lowercased, valid addresses. */
  valid: string[];
  /** Tokens that contained '@' but failed validation — shown to the user. */
  invalid: string[];
  /** How many duplicate valid addresses were collapsed. */
  duplicates: number;
}

/**
 * Parse pasted or uploaded CSV/TXT lead text into validated recipient addresses.
 * PapaParse reads the rows (handles quoting, CRLF, empty lines, the primary
 * delimiter); a regex then extracts and validates the addresses. Header cells and
 * other non-address tokens (they have no '@') are ignored, not counted invalid.
 */
export function parseLeads(text: string): ParsedLeads {
  const { data } = Papa.parse<string[]>(text, { skipEmptyLines: true });

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const row of data) {
    for (const cell of row) {
      for (const raw of String(cell ?? '').split(SEP_RE)) {
        const token = raw.trim();
        if (!token || !token.includes('@')) continue; // header words, names, blanks
        if (!EMAIL_RE.test(token)) {
          invalid.push(token);
          continue;
        }
        const key = token.toLowerCase();
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        valid.push(key);
      }
    }
  }

  return { valid, invalid, duplicates };
}
