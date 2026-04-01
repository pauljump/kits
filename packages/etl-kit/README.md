# @pauljump/etl-kit

Shared building blocks for data pipelines. Fetch with retries, rate-limit external APIs, scrape HTML with cheerio, and orchestrate fetch-transform-load pipelines.

## Install

Already available in the monorepo workspace. Add to your project's `package.json`:

```json
"dependencies": {
  "@pauljump/etl-kit": "workspace:*"
}
```

## API

### fetchWithRetry(url, options?)

Fetch a URL with exponential backoff retries and timeout. Returns the raw `Response` object.

```typescript
import { fetchWithRetry } from '@pauljump/etl-kit'

const response = await fetchWithRetry('https://api.example.com/data', {
  retries: 3,       // default: 3
  backoffMs: 1000,  // default: 1000 (doubles each retry)
  timeoutMs: 10000, // default: 10000
  headers: { 'Authorization': 'Bearer ...' },
})
const data = await response.json()
```

### RateLimiter

Token-bucket rate limiter. Call `wait()` before each request to respect external API limits.

```typescript
import { RateLimiter } from '@pauljump/etl-kit'

const limiter = new RateLimiter({ maxPerSecond: 5 })

for (const url of urls) {
  await limiter.wait() // blocks until a token is available
  const res = await fetch(url)
}
```

### scrapeHTML(url, options?)

Fetch a page and parse with cheerio. Returns the cheerio `$` root.

```typescript
import { scrapeHTML } from '@pauljump/etl-kit'

const $ = await scrapeHTML('https://example.com/page')
const titles = $('h1').map((_, el) => $(el).text()).get()
```

### createPipeline(config)

Orchestrate fetch -> transform -> load with logging and timing.

```typescript
import { createPipeline, fetchWithRetry } from '@pauljump/etl-kit'

const result = await createPipeline({
  name: 'stuywatch-listings',
  fetch: async () => {
    const res = await fetchWithRetry('https://...')
    return res.json()
  },
  transform: (raw) => raw.map(normalize),
  load: (items) => db.insertMany(items),
  logger: app.log, // optional, defaults to console
})

console.log(`Loaded in ${result.durationMs}ms`)
```

## No Puppeteer

This package intentionally excludes Puppeteer. It's too heavy for a shared dependency. Projects that need browser automation (e.g., bookem) should install Puppeteer directly and use `fetchWithRetry` + `RateLimiter` for the parts that don't need a browser.
