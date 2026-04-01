import type Database from 'better-sqlite3'

// ── Search Index ──────────────────────────────────────────────

export interface SearchConfig {
  /** Name of the FTS5 virtual table to create (e.g. 'listings_fts') */
  table: string
  /** Name of the source table whose rows will be indexed */
  sourceTable: string
  /** Columns from sourceTable to include in the full-text index */
  columns: string[]
  /**
   * FTS5 tokenizer string.
   * Defaults to 'porter unicode61' (stemming + unicode normalization).
   */
  tokenizer?: string
}

export interface SearchOptions {
  /** FTS5 virtual table to search */
  table: string
  /** User search query (will be sanitized) */
  query: string
  /** Max results to return. Defaults to 20. */
  limit?: number
  /** Offset for pagination. Defaults to 0. */
  offset?: number
  /** Column to generate snippet from. Defaults to first indexed column. */
  snippetColumn?: string
}

export interface SearchResult<T extends Record<string, unknown> = Record<string, unknown>> {
  /** rowid of the matching row in the source table */
  rowid: number
  /** BM25 relevance rank (lower = more relevant) */
  rank: number
  /** Highlighted snippet if requested, otherwise empty string */
  snippet: string
  /** All columns from the source row */
  [key: string]: unknown
}

// ── Filters ───────────────────────────────────────────────────

export type FilterOp =
  | { eq: string | number | boolean | null }
  | { neq: string | number | boolean | null }
  | { gt: number }
  | { gte: number }
  | { lt: number }
  | { lte: number }
  | { in: (string | number)[] }
  | { notIn: (string | number)[] }
  | { like: string }
  | { between: [number, number] }

export type FilterDef = Record<string, FilterOp>

export interface FilterResult {
  /** SQL WHERE clause (without the WHERE keyword) */
  where: string
  /** Bind parameters matching the placeholders in `where` */
  params: (string | number | boolean | null)[]
}
