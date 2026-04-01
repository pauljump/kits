# @pauljump/search-kit

Full-text search and multi-field filtering for SQLite via FTS5. Designed to work with `@pauljump/api-kit`'s `getDb()`.

## Install

```bash
pnpm add @pauljump/search-kit
```

`better-sqlite3` is a peer dependency — your app already has it via `api-kit`.

## Full-Text Search

```typescript
import { createSearchIndex, search } from '@pauljump/search-kit'
import { getDb } from '@pauljump/api-kit'

const db = getDb({ path: './data/app.db' })

// Create FTS5 virtual table backed by your source table
createSearchIndex(db, {
  table: 'listings_fts',
  sourceTable: 'listings',
  columns: ['address', 'description', 'neighborhood'],
  tokenizer: 'porter unicode61', // stemming + unicode (default)
})

// Search with BM25 ranking
const results = search(db, {
  table: 'listings_fts',
  query: 'sunny two bedroom',
  limit: 20,
})
// Returns: [{ rowid, rank, snippet, ...sourceRow }]
```

### Rebuilding the Index

After bulk inserts/updates/deletes to the source table:

```typescript
import { rebuildSearchIndex } from '@pauljump/search-kit'

rebuildSearchIndex(db, 'listings_fts')
```

## Multi-Field Filtering

```typescript
import { buildFilters } from '@pauljump/search-kit'

const { where, params } = buildFilters({
  bedrooms: { eq: 2 },
  price: { lte: 4000 },
  neighborhood: { in: ['Stuytown', 'PCV'] },
})
// where = '"bedrooms" = ? AND "price" <= ? AND "neighborhood" IN (?, ?)'
// params = [2, 4000, 'Stuytown', 'PCV']

const rows = db.prepare(`SELECT * FROM listings WHERE ${where}`).all(...params)
```

### Supported Operators

| Operator  | Example                          | SQL Output            |
|-----------|----------------------------------|-----------------------|
| `eq`      | `{ eq: 2 }`                     | `= ?`                |
| `neq`     | `{ neq: 'draft' }`              | `!= ?`               |
| `gt`      | `{ gt: 100 }`                   | `> ?`                |
| `gte`     | `{ gte: 100 }`                  | `>= ?`               |
| `lt`      | `{ lt: 100 }`                   | `< ?`                |
| `lte`     | `{ lte: 4000 }`                 | `<= ?`               |
| `in`      | `{ in: ['A', 'B'] }`            | `IN (?, ?)`          |
| `notIn`   | `{ notIn: [1, 2] }`             | `NOT IN (?, ?)`      |
| `like`    | `{ like: '%sunny%' }`           | `LIKE ?`             |
| `between` | `{ between: [1000, 5000] }`     | `BETWEEN ? AND ?`    |

### Combining with FTS

```typescript
const { where, params } = buildFilters({ price: { lte: 4000 }, bedrooms: { gte: 2 } })

const results = db.prepare(`
  SELECT s.*, f.rank
  FROM listings_fts f
  JOIN listings s ON s.rowid = f.rowid
  WHERE listings_fts MATCH ? AND ${where}
  ORDER BY f.rank
  LIMIT 20
`).all('"sunny"', ...params)
```
