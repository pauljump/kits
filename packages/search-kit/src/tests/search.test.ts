import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSearchIndex, rebuildSearchIndex, search } from "../fts.js";
import { buildFilters } from "../filter.js";

// ── Helpers ──────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function seedArticles(db: Database.Database) {
  db.exec(`
    CREATE TABLE articles (
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT,
      score INTEGER DEFAULT 0
    )
  `);
  const insert = db.prepare(
    "INSERT INTO articles (title, body, category, score) VALUES (?, ?, ?, ?)"
  );
  insert.run("Introduction to SQLite", "SQLite is a lightweight database engine used in many applications.", "tech", 90);
  insert.run("Advanced PostgreSQL", "PostgreSQL offers advanced features for enterprise databases.", "tech", 75);
  insert.run("Cooking with Pasta", "Learn how to cook delicious pasta dishes at home.", "food", 60);
  insert.run("SQLite Full-Text Search", "FTS5 provides full-text search capabilities in SQLite databases.", "tech", 95);
  insert.run("Garden Design Tips", "Beautiful garden designs for your backyard paradise.", "lifestyle", 40);
  insert.run("Database Performance Tuning", "Optimize your database queries for maximum performance.", "tech", 85);
}

function seedProducts(db: Database.Database) {
  db.exec(`
    CREATE TABLE products (
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT,
      in_stock INTEGER DEFAULT 1
    )
  `);
  const insert = db.prepare(
    "INSERT INTO products (name, price, category, in_stock) VALUES (?, ?, ?, ?)"
  );
  insert.run("Widget A", 9.99, "electronics", 1);
  insert.run("Widget B", 29.99, "electronics", 0);
  insert.run("Gadget C", 49.99, "gadgets", 1);
  insert.run("Doohickey D", 4.99, "misc", 1);
  insert.run("Thingamajig E", 99.99, "electronics", 1);
}

// ── FTS: createSearchIndex ───────────────────────────────────────

describe("createSearchIndex", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedArticles(db);
  });

  it("creates an FTS5 virtual table and populates it", () => {
    createSearchIndex(db, {
      table: "articles_fts",
      sourceTable: "articles",
      columns: ["title", "body"],
    });

    // FTS table should exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles_fts'")
      .all();
    expect(tables).toHaveLength(1);

    // FTS should contain data — search for a known term
    const rows = db
      .prepare(`SELECT rowid FROM articles_fts WHERE articles_fts MATCH '"SQLite"'`)
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(2); // "Introduction to SQLite" + "SQLite Full-Text Search"
  });

  it("is idempotent — calling twice does not error", () => {
    const config = {
      table: "articles_fts",
      sourceTable: "articles",
      columns: ["title", "body"],
    };
    createSearchIndex(db, config);
    expect(() => createSearchIndex(db, config)).not.toThrow();
  });

  it("throws when columns array is empty", () => {
    expect(() =>
      createSearchIndex(db, {
        table: "articles_fts",
        sourceTable: "articles",
        columns: [],
      })
    ).toThrow("columns must contain at least one column");
  });

  it("throws on invalid identifier names", () => {
    expect(() =>
      createSearchIndex(db, {
        table: "articles_fts; DROP TABLE articles",
        sourceTable: "articles",
        columns: ["title"],
      })
    ).toThrow("invalid identifier");

    expect(() =>
      createSearchIndex(db, {
        table: "articles_fts",
        sourceTable: "articles",
        columns: ["title", "body; DROP TABLE articles"],
      })
    ).toThrow("invalid identifier");
  });

  it("accepts a custom tokenizer", () => {
    // Should not throw
    createSearchIndex(db, {
      table: "articles_fts",
      sourceTable: "articles",
      columns: ["title", "body"],
      tokenizer: "unicode61",
    });

    const rows = db
      .prepare(`SELECT rowid FROM articles_fts WHERE articles_fts MATCH '"pasta"'`)
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ── FTS: search ──────────────────────────────────────────────────

describe("search", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedArticles(db);
    createSearchIndex(db, {
      table: "articles_fts",
      sourceTable: "articles",
      columns: ["title", "body"],
    });
  });

  it("returns ranked results with snippets", () => {
    const results = search(db, { table: "articles_fts", query: "SQLite" });
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Each result should have rank and snippet
    for (const r of results) {
      expect(r).toHaveProperty("rank");
      expect(typeof r.rank).toBe("number");
      expect(r).toHaveProperty("snippet");
      expect(typeof r.snippet).toBe("string");
    }

    // Results should contain the FTS-indexed columns
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("body");
    // rowid is returned for joining back to source table
    expect(results[0]).toHaveProperty("rowid");
  });

  it("snippets contain bold-highlighted terms", () => {
    const results = search(db, { table: "articles_fts", query: "SQLite" });
    const hasHighlight = results.some((r) => r.snippet.includes("<b>"));
    expect(hasHighlight).toBe(true);
  });

  it("returns empty array when no matches found", () => {
    const results = search(db, {
      table: "articles_fts",
      query: "xyznonexistentterm",
    });
    expect(results).toEqual([]);
  });

  it("returns empty array for empty/whitespace query", () => {
    expect(search(db, { table: "articles_fts", query: "" })).toEqual([]);
    expect(search(db, { table: "articles_fts", query: "   " })).toEqual([]);
  });

  it("returns empty array when query is only FTS operators", () => {
    expect(search(db, { table: "articles_fts", query: "AND OR NOT" })).toEqual(
      []
    );
  });

  it("respects limit", () => {
    const results = search(db, {
      table: "articles_fts",
      query: "database",
      limit: 1,
    });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("respects offset", () => {
    const allResults = search(db, {
      table: "articles_fts",
      query: "database",
      limit: 10,
    });
    const offsetResults = search(db, {
      table: "articles_fts",
      query: "database",
      limit: 10,
      offset: 1,
    });

    if (allResults.length > 1) {
      expect(offsetResults.length).toBe(allResults.length - 1);
      // The first offset result should match the second full result
      expect(offsetResults[0].title).toBe(allResults[1].title);
    }
  });

  it("supports snippetColumn option", () => {
    const results = search(db, {
      table: "articles_fts",
      query: "SQLite database",
      snippetColumn: "body",
    });
    expect(results.length).toBeGreaterThan(0);
    // snippet should come from body column content
    for (const r of results) {
      expect(typeof r.snippet).toBe("string");
    }
  });

  it("sanitizes special FTS5 characters in queries", () => {
    // These should not throw — special characters get stripped
    expect(() =>
      search(db, { table: "articles_fts", query: 'SQLite "OR 1=1' })
    ).not.toThrow();
    expect(() =>
      search(db, { table: "articles_fts", query: "test()" })
    ).not.toThrow();
    expect(() =>
      search(db, { table: "articles_fts", query: "col:value" })
    ).not.toThrow();
    expect(() =>
      search(db, { table: "articles_fts", query: "NEAR(a b)" })
    ).not.toThrow();
  });

  it("throws on invalid table name", () => {
    expect(() =>
      search(db, { table: "bad table; DROP", query: "test" })
    ).toThrow("invalid identifier");
  });

  it("results are ordered by relevance (rank)", () => {
    const results = search(db, {
      table: "articles_fts",
      query: "SQLite",
    });
    if (results.length >= 2) {
      // BM25 rank: lower = more relevant. Results should be ascending.
      for (let i = 1; i < results.length; i++) {
        expect(results[i].rank).toBeGreaterThanOrEqual(results[i - 1].rank);
      }
    }
  });
});

// ── FTS: rebuildSearchIndex ──────────────────────────────────────

describe("rebuildSearchIndex", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedArticles(db);
    createSearchIndex(db, {
      table: "articles_fts",
      sourceTable: "articles",
      columns: ["title", "body"],
    });
  });

  it("picks up new rows after rebuild", () => {
    // Add a new article
    db.prepare(
      "INSERT INTO articles (title, body, category, score) VALUES (?, ?, ?, ?)"
    ).run(
      "New SQLite Features",
      "SQLite version 3.40 brings exciting new capabilities.",
      "tech",
      100
    );

    // Rebuild and verify
    rebuildSearchIndex(db, "articles_fts");

    const afterResults = search(db, {
      table: "articles_fts",
      query: "exciting capabilities",
    });
    expect(afterResults.length).toBeGreaterThanOrEqual(1);
    expect(afterResults.some((r) => (r.title as string).includes("New SQLite"))).toBe(true);
  });

  it("reflects deleted rows after rebuild", () => {
    // Delete an article
    db.prepare("DELETE FROM articles WHERE title LIKE '%Pasta%'").run();

    rebuildSearchIndex(db, "articles_fts");

    const results = search(db, {
      table: "articles_fts",
      query: "pasta dishes",
    });
    expect(results).toEqual([]);
  });

  it("throws on invalid table name", () => {
    expect(() => rebuildSearchIndex(db, "bad; DROP")).toThrow(
      "invalid identifier"
    );
  });
});

// ── buildFilters ─────────────────────────────────────────────────

describe("buildFilters", () => {
  it("builds eq clause", () => {
    const { where, params } = buildFilters({ category: { eq: "tech" } });
    expect(where).toBe('"category" = ?');
    expect(params).toEqual(["tech"]);
  });

  it("builds eq with number", () => {
    const { where, params } = buildFilters({ score: { eq: 90 } });
    expect(where).toBe('"score" = ?');
    expect(params).toEqual([90]);
  });

  it("builds eq with boolean", () => {
    const { where, params } = buildFilters({ active: { eq: true } });
    expect(where).toBe('"active" = ?');
    expect(params).toEqual([true]);
  });

  it("builds eq null as IS NULL", () => {
    const { where, params } = buildFilters({ deleted_at: { eq: null } });
    expect(where).toBe('"deleted_at" IS NULL');
    expect(params).toEqual([]);
  });

  it("builds neq clause", () => {
    const { where, params } = buildFilters({ status: { neq: "archived" } });
    expect(where).toBe('"status" != ?');
    expect(params).toEqual(["archived"]);
  });

  it("builds neq null as IS NOT NULL", () => {
    const { where, params } = buildFilters({ deleted_at: { neq: null } });
    expect(where).toBe('"deleted_at" IS NOT NULL');
    expect(params).toEqual([]);
  });

  it("builds gt clause", () => {
    const { where, params } = buildFilters({ price: { gt: 10 } });
    expect(where).toBe('"price" > ?');
    expect(params).toEqual([10]);
  });

  it("builds gte clause", () => {
    const { where, params } = buildFilters({ price: { gte: 10 } });
    expect(where).toBe('"price" >= ?');
    expect(params).toEqual([10]);
  });

  it("builds lt clause", () => {
    const { where, params } = buildFilters({ price: { lt: 50 } });
    expect(where).toBe('"price" < ?');
    expect(params).toEqual([50]);
  });

  it("builds lte clause", () => {
    const { where, params } = buildFilters({ price: { lte: 50 } });
    expect(where).toBe('"price" <= ?');
    expect(params).toEqual([50]);
  });

  it("builds in clause", () => {
    const { where, params } = buildFilters({
      category: { in: ["tech", "food"] },
    });
    expect(where).toBe('"category" IN (?, ?)');
    expect(params).toEqual(["tech", "food"]);
  });

  it("handles empty in array as always-false", () => {
    const { where, params } = buildFilters({ category: { in: [] } });
    expect(where).toBe("0");
    expect(params).toEqual([]);
  });

  it("builds notIn clause", () => {
    const { where, params } = buildFilters({
      category: { notIn: ["misc", "lifestyle"] },
    });
    expect(where).toBe('"category" NOT IN (?, ?)');
    expect(params).toEqual(["misc", "lifestyle"]);
  });

  it("handles empty notIn array as always-true (no clause)", () => {
    const { where, params } = buildFilters({ category: { notIn: [] } });
    // Empty notIn produces no clause, so the where should be the default "1"
    expect(where).toBe("1");
    expect(params).toEqual([]);
  });

  it("builds like clause", () => {
    const { where, params } = buildFilters({
      name: { like: "%widget%" },
    });
    expect(where).toBe('"name" LIKE ?');
    expect(params).toEqual(["%widget%"]);
  });

  it("builds between clause", () => {
    const { where, params } = buildFilters({
      price: { between: [10, 50] },
    });
    expect(where).toBe('"price" BETWEEN ? AND ?');
    expect(params).toEqual([10, 50]);
  });

  it("combines multiple filters with AND", () => {
    const { where, params } = buildFilters({
      category: { eq: "tech" },
      score: { gte: 80 },
      deleted_at: { eq: null },
    });
    expect(where).toBe('"category" = ? AND "score" >= ? AND "deleted_at" IS NULL');
    expect(params).toEqual(["tech", 80]);
  });

  it("returns '1' (always true) when no filters provided", () => {
    const { where, params } = buildFilters({});
    expect(where).toBe("1");
    expect(params).toEqual([]);
  });

  it("throws on invalid column names (SQL injection prevention)", () => {
    expect(() =>
      buildFilters({ "category; DROP TABLE users": { eq: "x" } })
    ).toThrow('invalid column name');

    expect(() =>
      buildFilters({ "1leading_digit": { eq: "x" } })
    ).toThrow('invalid column name');

    expect(() =>
      buildFilters({ "col name": { eq: "x" } })
    ).toThrow('invalid column name');

    expect(() =>
      buildFilters({ 'col"quote': { eq: "x" } })
    ).toThrow('invalid column name');
  });

  it("accepts valid column names with underscores and digits", () => {
    expect(() =>
      buildFilters({
        _private: { eq: 1 },
        column_2: { gt: 5 },
        CamelCase: { like: "%test%" },
      })
    ).not.toThrow();
  });
});

// ── Integration: buildFilters + actual SQL execution ─────────────

describe("buildFilters integration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedProducts(db);
  });

  it("filters work in a real SQL query", () => {
    const { where, params } = buildFilters({
      category: { eq: "electronics" },
      price: { lt: 50 },
      in_stock: { eq: 1 },
    });

    const rows = db
      .prepare(`SELECT * FROM products WHERE ${where}`)
      .all(...params) as Array<{ name: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Widget A");
  });

  it("in filter works against real data", () => {
    const { where, params } = buildFilters({
      category: { in: ["electronics", "gadgets"] },
    });

    const rows = db
      .prepare(`SELECT * FROM products WHERE ${where}`)
      .all(...params) as Array<{ name: string }>;

    expect(rows).toHaveLength(4); // Widget A, Widget B, Gadget C, Thingamajig E
  });

  it("between filter works against real data", () => {
    const { where, params } = buildFilters({
      price: { between: [10, 50] },
    });

    const rows = db
      .prepare(`SELECT * FROM products WHERE ${where}`)
      .all(...params) as Array<{ name: string }>;

    expect(rows).toHaveLength(2); // Widget B (29.99) and Gadget C (49.99)
  });

  it("like filter works against real data", () => {
    const { where, params } = buildFilters({
      name: { like: "Widget%" },
    });

    const rows = db
      .prepare(`SELECT * FROM products WHERE ${where}`)
      .all(...params) as Array<{ name: string }>;

    expect(rows).toHaveLength(2); // Widget A, Widget B
  });

  it("null filter works against real data", () => {
    // Insert a row with null category
    db.prepare(
      "INSERT INTO products (name, price, category, in_stock) VALUES (?, ?, ?, ?)"
    ).run("Mystery Item", 1.99, null, 1);

    const { where, params } = buildFilters({
      category: { eq: null },
    });

    const rows = db
      .prepare(`SELECT * FROM products WHERE ${where}`)
      .all(...params) as Array<{ name: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Mystery Item");
  });
});
