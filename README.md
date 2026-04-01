# Kits

**Composable backend primitives — extracted from 16 production apps.**

After building 16 apps on the same stack, I extracted the pieces that kept showing up. Search, analytics, job queues, payments, notifications, availability monitoring, LLM integration, and more. Each one is a standalone npm package. Most use SQLite — no Postgres, no Redis, no external infrastructure.

## Packages

### Data & Storage (SQLite-backed)

| Package | What it does | Used by |
|---------|-------------|---------|
| **[@pauljump/search-kit](packages/search-kit)** | Full-text search via FTS5 with BM25 ranking, snippets, and composable filters | 2 apps |
| **[@pauljump/job-queue](packages/job-queue)** | Persistent job scheduler with cron expressions, retry on failure, polling | 1 app |
| **[@pauljump/analytics-kit](packages/analytics-kit)** | Event tracking, user identification, time-series counts, funnels | 2 apps |
| **[@pauljump/gamify-kit](packages/gamify-kit)** | Points ledger, streaks with gap detection, achievements with conditions | — |
| **[@pauljump/watch-kit](packages/watch-kit)** | Availability monitoring — snapshot diffs, condition engine, grace periods | 2 apps |

### Intelligence

| Package | What it does | Used by |
|---------|-------------|---------|
| **[@pauljump/predict-kit](packages/predict-kit)** | Segmented pattern learning — outcome probabilities from dimensional bucketing | 2 apps |
| **[@pauljump/llm-kit](packages/llm-kit)** | Provider-agnostic LLM client — OpenAI, Anthropic, Gemini with tool use | 10 apps |

### Infrastructure

| Package | What it does | Used by |
|---------|-------------|---------|
| **[@pauljump/etl-kit](packages/etl-kit)** | Fetch with retry, rate limiting, HTML scraping, pipeline orchestration | 5 apps |
| **[@pauljump/event-bus](packages/event-bus)** | In-process pub/sub + webhook delivery with HMAC-SHA256 and retry | — |
| **[@pauljump/notify-kit](packages/notify-kit)** | Email (Resend) + push notifications (APNs HTTP/2 with JWT) | 6 apps |
| **[@pauljump/payments-kit](packages/payments-kit)** | Stripe checkout, billing portal, webhook verification | 2 apps |

## Why SQLite

Most apps don't need Postgres. They need a database that:
- Requires zero infrastructure (no Docker, no connection strings, no managed service)
- Survives restarts (unlike in-memory stores)
- Handles concurrent reads without contention (WAL mode)
- Deploys as a single file you can copy, backup, or inspect with `sqlite3`

The tradeoff is horizontal scaling — you can't shard SQLite across machines. For the vast majority of apps (internal tools, side projects, early-stage products, mobile backends), that's not a real constraint. If your app serves 10,000 users, SQLite handles it. If it serves 10 million, you'll have the revenue to migrate.

## Quick Start

```bash
npm install @pauljump/search-kit better-sqlite3
```

```typescript
import Database from "better-sqlite3";
import { createSearchIndex, search } from "@pauljump/search-kit";

const db = new Database("app.db");

// Create a source table
db.exec(`CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT)`);
db.prepare("INSERT INTO articles (title, body) VALUES (?, ?)").run(
  "SQLite is enough",
  "Most apps don't need Postgres. Here's why."
);

// Index it
createSearchIndex(db, {
  table: "articles_fts",
  sourceTable: "articles",
  columns: ["title", "body"],
});

// Search it
const results = search(db, { table: "articles_fts", query: "postgres" });
// [{ rowid: 1, rank: -0.42, snippet: "Most apps don't need <b>Postgres</b>..." }]
```

## Package Details

### search-kit

Wraps SQLite FTS5 so you don't write raw FTS5 SQL. Creates virtual tables, populates from source tables, searches with BM25 ranking and snippet generation. Includes a composable filter builder for WHERE clauses with SQL injection prevention.

```typescript
import { createSearchIndex, search, buildFilters } from "@pauljump/search-kit";

createSearchIndex(db, {
  table: "listings_fts",
  sourceTable: "listings",
  columns: ["address", "description"],
});

const results = search(db, { table: "listings_fts", query: "park slope", limit: 10 });

const { where, params } = buildFilters({
  price: { op: "between", value: [2000, 4000] },
  bedrooms: { op: "gte", value: 2 },
});
```

### job-queue

Persistent job scheduler backed by SQLite. Alternative to Bull/BullMQ when you don't want Redis. Supports cron expressions, one-time jobs, retry with configurable attempts, and job history. Includes a built-in cron parser (no external dependency).

```typescript
import Database from "better-sqlite3";
import { initJobTables, createJobQueue } from "@pauljump/job-queue";

const db = new Database("jobs.db");
initJobTables(db);

const queue = createJobQueue(db);
queue.register("send-digest", async (payload) => {
  await sendEmail(payload.userId, buildDigest());
});
queue.schedule({ name: "send-digest", cron: "0 9 * * *" });
queue.start();
```

### analytics-kit

Product analytics without Mixpanel. Track events, identify users, query counts by time period, count uniques, and build funnels. All stored in SQLite — your analytics data never leaves your server.

```typescript
import { initAnalyticsTables, createTracker } from "@pauljump/analytics-kit";

initAnalyticsTables(db);
const tracker = createTracker(db);

tracker.track({ event: "page_view", userId: "user-1", properties: { path: "/pricing" } });
tracker.identify({ userId: "user-1", traits: { plan: "pro" } });

const daily = tracker.getCounts({ event: "page_view", groupBy: "day" });
const funnel = tracker.getFunnel({ steps: ["signup", "onboarding", "first_action"] });
```

### gamify-kit

Points, streaks, and achievements for apps that need engagement mechanics. The streak logic handles gap detection (consecutive days only), same-day idempotency, and longest-streak tracking. Achievements support three condition types: points threshold, streak threshold, and activity count.

```typescript
import { initGamifyTables, addPoints, recordActivity, defineAchievement, checkAchievements } from "@pauljump/gamify-kit";

initGamifyTables(db);
addPoints(db, { userId: 1, amount: 50, reason: "daily_login" });
recordActivity(db, { userId: 1, activity: "login" });

defineAchievement(db, {
  id: "streak-7",
  name: "Week Warrior",
  description: "7-day login streak",
  condition: { type: "streak_threshold", activity: "login", threshold: 7 },
});

const newlyUnlocked = checkAchievements(db, 1);
```

### predict-kit

Domain-agnostic pattern predictor. Segments observations by user-defined dimensions, tallies outcomes per segment, and returns probabilities with confidence scoring. No SQLite dependency — runs entirely in memory.

Used in production for real estate price predictions and tee time availability forecasting.

```typescript
import { createPredictor, numericBucket, dayOfWeek } from "@pauljump/predict-kit";

const predictor = createPredictor({
  dimensions: {
    bedrooms: (obs) => `${obs.bedrooms}br`,
    priceLevel: (obs) => numericBucket([3000, 5000], ["low", "mid", "high"])(obs.price),
    dayListed: (obs) => dayOfWeek(obs.listedAt),
  },
  outcomes: ["increase", "decrease", "stable"],
});

predictor.learn(historicalData.map((d) => ({ data: d, outcome: d.priceChange })));

const prediction = predictor.predict({ bedrooms: 2, price: 4200, listedAt: "2026-03-15" });
// { mostLikely: "decrease", confidence: "high", probabilities: { decrease: 68, increase: 12, stable: 20 } }
```

### event-bus

In-process pub/sub with isolated error handling, plus webhook delivery with HMAC-SHA256 signing and exponential backoff retry. Handlers run concurrently via `Promise.allSettled` — one failing handler doesn't block others.

```typescript
import { createEventBus, deliverWebhook } from "@pauljump/event-bus";

const bus = createEventBus();
bus.on("order.completed", async (order) => {
  await deliverWebhook({
    url: "https://partner-api.example.com/orders",
    event: "order.completed",
    payload: order,
    secret: process.env.WEBHOOK_SECRET,
  });
});

bus.emit("order.completed", { id: "ord_123", total: 99.00 });
```

### etl-kit

Data pipeline utilities: HTTP fetch with exponential backoff retry, token-bucket rate limiting, HTML scraping via Cheerio, and a fetch-transform-load pipeline orchestrator. Optional Puppeteer peer dependency for JS-rendered pages.

```typescript
import { fetchWithRetry, RateLimiter, scrapeHTML, createPipeline } from "@pauljump/etl-kit";

const limiter = new RateLimiter({ maxPerSecond: 2 });

const result = await createPipeline({
  name: "weather",
  fetch: async () => {
    await limiter.wait();
    const res = await fetchWithRetry("https://api.weather.gov/alerts/active", { retries: 3 });
    return res.json();
  },
  transform: (raw) => raw.features.map((f) => ({ title: f.properties.headline })),
  load: (alerts) => db.insertAlerts(alerts),
});
```

## Design Principles

1. **SQLite or nothing.** If it needs Redis, Postgres, or any external service, it doesn't belong here.
2. **Zero config.** Pass a `Database` instance and go. No connection strings, no environment variables, no setup wizards.
3. **Composable, not coupled.** Each package works alone. Use one, use all, or use none — they don't import each other.
4. **Typed end-to-end.** TypeScript with strict mode. Every function signature, every return type, every option.
5. **Test what matters.** Every package has tests that run against real SQLite (`:memory:`), not mocks.

## Context

These packages were built inside a private monorepo over months of daily shipping — 16 apps across iOS, web, and backend. They're not new code in new repos; they're extracted patterns that proved themselves across multiple production apps. I'm open-sourcing them to maintain them properly as standalone packages and because they solved problems I couldn't find good existing solutions for.

Related projects from the same monorepo:
- **[ai-factory](https://github.com/pauljump/ai-factory)** — the CLI that manages the knowledge layer across all these projects
- **[teek](https://github.com/pauljump/teek)** — persona simulation engine, one of the packages the monorepo produces
- **[polyfeeds](https://github.com/pauljump/polyfeeds)** — 106 prediction market data feeds, one of the apps these kits power

## Running Tests

```bash
pnpm install
pnpm test        # runs all 11 packages — 408 tests
```

## License

MIT
