// Core
export { WatchEngine } from './engine.js'
export { SnapshotStore } from './store.js'
export { diffSnapshots } from './diff.js'

// Pre-built conditions
export {
  onAdded,
  onRemoved,
  onChanged,
  onFieldChanged,
  onThreshold,
  onDecrease,
  onIncrease,
  allOf,
  anyOf,
} from './conditions.js'

// Pre-built actions
export {
  logAction,
  callbackAction,
  emitAction,
} from './actions.js'

// Types
export type {
  FetchFn,
  ExtractFn,
  DiffableItem,
  WatchEventType,
  WatchEvent,
  WatchResult,
  ConditionFn,
  Condition,
  ActionFn,
  Action,
  GraceConfig,
  WatcherConfig,
  Snapshot,
  RunLogEntry,
  WatcherMeta,
  WatchEngineConfig,
} from './types.js'
