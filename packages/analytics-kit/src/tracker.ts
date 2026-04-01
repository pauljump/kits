import type Database from 'better-sqlite3'
import type {
  TrackParams,
  IdentifyParams,
  EventQuery,
  CountQuery,
  UniqueQuery,
  FunnelQuery,
  Event,
  CountResult,
  UniqueResult,
  FunnelResult,
} from './types.js'

export interface Tracker {
  track(params: TrackParams): void
  identify(params: IdentifyParams): void
  getEvents(query?: EventQuery): Event[]
  getCounts(query: CountQuery): CountResult[]
  getUniques(query: UniqueQuery): UniqueResult[]
  getFunnel(query: FunnelQuery): FunnelResult[]
}

function groupByFormat(groupBy: 'hour' | 'day' | 'week' | 'month'): string {
  switch (groupBy) {
    case 'hour':
      return '%Y-%m-%dT%H:00:00Z'
    case 'day':
      return '%Y-%m-%d'
    case 'week':
      // ISO week: Monday-based, returns the Monday date
      return '%Y-W%W'
    case 'month':
      return '%Y-%m'
  }
}

/**
 * Creates a tracker instance bound to the given SQLite database.
 * Call initAnalyticsTables(db) before using the tracker.
 */
export function createTracker(db: Database.Database): Tracker {
  const insertEvent = db.prepare(
    `INSERT INTO analytics_events (event, userId, properties, timestamp)
     VALUES (@event, @userId, @properties, @timestamp)`
  )

  const upsertUser = db.prepare(
    `INSERT INTO analytics_users (userId, traits, firstSeen, lastSeen)
     VALUES (@userId, @traits, @now, @now)
     ON CONFLICT(userId) DO UPDATE SET
       traits = json_patch(analytics_users.traits, @traits),
       lastSeen = @now`
  )

  return {
    track(params: TrackParams): void {
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      insertEvent.run({
        event: params.event,
        userId: params.userId ?? null,
        properties: JSON.stringify(params.properties ?? {}),
        timestamp: now,
      })
    },

    identify(params: IdentifyParams): void {
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      upsertUser.run({
        userId: params.userId,
        traits: JSON.stringify(params.traits),
        now,
      })
    },

    getEvents(query?: EventQuery): Event[] {
      const conditions: string[] = []
      const bindings: Record<string, unknown> = {}

      if (query?.event) {
        conditions.push('event = @event')
        bindings.event = query.event
      }
      if (query?.userId) {
        conditions.push('userId = @userId')
        bindings.userId = query.userId
      }
      if (query?.since) {
        conditions.push('timestamp >= @since')
        bindings.since = query.since
      }
      if (query?.until) {
        conditions.push('timestamp <= @until')
        bindings.until = query.until
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const limit = query?.limit ? `LIMIT ${Number(query.limit)}` : ''

      const rows = db
        .prepare(`SELECT id, event, userId, properties, timestamp FROM analytics_events ${where} ORDER BY timestamp DESC ${limit}`)
        .all(bindings) as Array<{ id: number; event: string; userId: string | null; properties: string; timestamp: string }>

      return rows.map((row) => ({
        id: row.id,
        event: row.event,
        userId: row.userId,
        properties: JSON.parse(row.properties) as Record<string, unknown>,
        timestamp: row.timestamp,
      }))
    },

    getCounts(query: CountQuery): CountResult[] {
      const fmt = groupByFormat(query.groupBy)
      const conditions: string[] = ['event = @event']
      const bindings: Record<string, unknown> = { event: query.event }

      if (query.since) {
        conditions.push('timestamp >= @since')
        bindings.since = query.since
      }
      if (query.until) {
        conditions.push('timestamp <= @until')
        bindings.until = query.until
      }

      const where = conditions.join(' AND ')

      const rows = db
        .prepare(
          `SELECT strftime('${fmt}', timestamp) AS period, COUNT(*) AS count
           FROM analytics_events
           WHERE ${where}
           GROUP BY period
           ORDER BY period ASC`
        )
        .all(bindings) as Array<{ period: string; count: number }>

      return rows
    },

    getUniques(query: UniqueQuery): UniqueResult[] {
      const fmt = groupByFormat(query.groupBy)
      const conditions: string[] = ['event = @event']
      const bindings: Record<string, unknown> = { event: query.event }

      if (query.since) {
        conditions.push('timestamp >= @since')
        bindings.since = query.since
      }
      if (query.until) {
        conditions.push('timestamp <= @until')
        bindings.until = query.until
      }

      const where = conditions.join(' AND ')

      const rows = db
        .prepare(
          `SELECT strftime('${fmt}', timestamp) AS period, COUNT(DISTINCT userId) AS count
           FROM analytics_events
           WHERE ${where}
           GROUP BY period
           ORDER BY period ASC`
        )
        .all(bindings) as Array<{ period: string; count: number }>

      return rows
    },

    getFunnel(query: FunnelQuery): FunnelResult[] {
      const conditions: string[] = []
      const bindings: Record<string, unknown> = {}

      if (query.since) {
        conditions.push('timestamp >= @since')
        bindings.since = query.since
      }
      if (query.until) {
        conditions.push('timestamp <= @until')
        bindings.until = query.until
      }

      const timeFilter = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

      return query.steps.map((step) => {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS count FROM analytics_events WHERE event = @step ${timeFilter}`
          )
          .get({ ...bindings, step }) as { count: number }

        return { step, count: row.count }
      })
    },
  }
}
