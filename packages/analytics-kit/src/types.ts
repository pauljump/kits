import type Database from 'better-sqlite3'

export interface AnalyticsConfig {
  db: Database.Database
}

export interface TrackParams {
  event: string
  userId?: string
  properties?: Record<string, unknown>
}

export interface IdentifyParams {
  userId: string
  traits: Record<string, unknown>
}

export interface EventQuery {
  event?: string
  userId?: string
  since?: string
  until?: string
  limit?: number
}

export interface CountQuery {
  event: string
  groupBy: 'hour' | 'day' | 'week' | 'month'
  since?: string
  until?: string
}

export interface UniqueQuery {
  event: string
  groupBy: 'hour' | 'day' | 'week' | 'month'
  since?: string
  until?: string
}

export interface FunnelQuery {
  steps: string[]
  since?: string
  until?: string
}

export interface Event {
  id: number
  event: string
  userId: string | null
  properties: Record<string, unknown>
  timestamp: string
}

export interface UserTraits {
  userId: string
  traits: Record<string, unknown>
  firstSeen: string
  lastSeen: string
}

export interface CountResult {
  period: string
  count: number
}

export interface UniqueResult {
  period: string
  count: number
}

export interface FunnelResult {
  step: string
  count: number
}
