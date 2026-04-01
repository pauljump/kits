import type Database from 'better-sqlite3'
import type { SearchConfig, SearchOptions, SearchResult } from './types.js'

/**
 * Create an FTS5 virtual table and populate it from an existing source table.
 *
 * Safe to call multiple times — uses IF NOT EXISTS for the virtual table
 * and re-populates by diffing on rowid.
 */
export function createSearchIndex(db: Database.Database, config: SearchConfig): void {
  const { table, sourceTable, columns, tokenizer = 'porter unicode61' } = config

  if (columns.length === 0) {
    throw new Error('search-kit: columns must contain at least one column')
  }

  // Validate identifiers (prevent SQL injection in dynamic DDL)
  for (const name of [table, sourceTable, ...columns]) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`search-kit: invalid identifier "${name}"`)
    }
  }

  const colList = columns.join(', ')

  // Create content-backed FTS5 table pointing at the source table.
  // content= keeps FTS in sync structurally; we handle population ourselves.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS "${table}"
    USING fts5(${colList}, content="${sourceTable}", content_rowid="rowid", tokenize="${tokenizer}");
  `)

  // Populate: insert any source rows not yet in the FTS index.
  // For a full rebuild, caller can call rebuildSearchIndex() first.
  db.exec(`
    INSERT INTO "${table}"("${table}", rowid, ${colList})
    SELECT 'delete', rowid, ${colList} FROM "${sourceTable}" WHERE 0;
  `)

  // Rebuild the entire index from source (idempotent)
  db.exec(`INSERT INTO "${table}"("${table}") VALUES('rebuild');`)
}

/**
 * Rebuild the FTS5 index from the source table.
 * Use after bulk inserts/updates/deletes to the source table.
 */
export function rebuildSearchIndex(db: Database.Database, table: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`search-kit: invalid identifier "${table}"`)
  }
  db.exec(`INSERT INTO "${table}"("${table}") VALUES('rebuild');`)
}

/**
 * Search the FTS5 index and return ranked results joined with source data.
 */
export function search<T extends Record<string, unknown> = Record<string, unknown>>(
  db: Database.Database,
  options: SearchOptions,
): SearchResult<T>[] {
  const { table, query, limit = 20, offset = 0 } = options

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`search-kit: invalid identifier "${table}"`)
  }

  const sanitized = sanitizeQuery(query)
  if (!sanitized) return []

  // Look up the source table name from FTS5 config
  const configRow = db
    .prepare(`SELECT * FROM "${table}_config" WHERE k = 'content'`)
    .get() as { k: string; v: string } | undefined

  const sourceTable = configRow?.v

  // Get column names from the FTS table
  const colInfo = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
  const ftsColumns = colInfo.map((c) => c.name)

  const snippetCol = options.snippetColumn ?? ftsColumns[0]
  if (!snippetCol || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(snippetCol)) {
    throw new Error(`search-kit: invalid snippet column "${snippetCol}"`)
  }
  const snippetIdx = ftsColumns.indexOf(snippetCol)

  let sql: string
  const params: (string | number)[] = [sanitized, limit, offset]

  if (sourceTable) {
    // Join FTS results with source table to get all columns
    sql = `
      SELECT
        s.*,
        f.rank,
        snippet("${table}", ${snippetIdx >= 0 ? snippetIdx : 0}, '<b>', '</b>', '...', 32) as snippet
      FROM "${table}" f
      JOIN "${sourceTable}" s ON s.rowid = f.rowid
      WHERE "${table}" MATCH ?
      ORDER BY f.rank
      LIMIT ?
      OFFSET ?
    `
  } else {
    // No content table — return FTS columns directly
    sql = `
      SELECT
        rowid,
        rank,
        snippet("${table}", ${snippetIdx >= 0 ? snippetIdx : 0}, '<b>', '</b>', '...', 32) as snippet,
        ${ftsColumns.map((c) => `"${c}"`).join(', ')}
      FROM "${table}"
      WHERE "${table}" MATCH ?
      ORDER BY rank
      LIMIT ?
      OFFSET ?
    `
  }

  const rows = db.prepare(sql).all(...params) as SearchResult<T>[]
  return rows
}

/**
 * Sanitize a user query for FTS5 MATCH.
 *
 * Strips special FTS5 operators and wraps each term in double quotes
 * to prevent syntax errors from user input.
 */
function sanitizeQuery(raw: string): string {
  // Remove FTS5 special characters that could cause syntax errors
  const cleaned = raw
    .replace(/[*"():^{}[\]]/g, ' ')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
    .trim()

  if (!cleaned) return ''

  // Split into terms and quote each one for safe matching
  const terms = cleaned.split(/\s+/).filter(Boolean)
  return terms.map((t) => `"${t}"`).join(' ')
}
