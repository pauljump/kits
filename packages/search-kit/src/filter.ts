import type { FilterDef, FilterResult } from './types.js'

/**
 * Build a composable WHERE clause from a filter definition.
 *
 * Each key is a column name, each value is an operator object.
 * Returns { where, params } ready to splice into a SQL query.
 *
 * @example
 * ```ts
 * const { where, params } = buildFilters({
 *   bedrooms: { eq: 2 },
 *   price: { lte: 4000 },
 *   neighborhood: { in: ['Stuytown', 'PCV'] },
 * })
 * // where = "\"bedrooms\" = ? AND \"price\" <= ? AND \"neighborhood\" IN (?, ?)"
 * // params = [2, 4000, 'Stuytown', 'PCV']
 * ```
 */
export function buildFilters(filters: FilterDef): FilterResult {
  const clauses: string[] = []
  const params: (string | number | boolean | null)[] = []

  for (const [column, op] of Object.entries(filters)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
      throw new Error(`search-kit: invalid column name "${column}"`)
    }

    const col = `"${column}"`

    if ('eq' in op) {
      if (op.eq === null) {
        clauses.push(`${col} IS NULL`)
      } else {
        clauses.push(`${col} = ?`)
        params.push(op.eq)
      }
    } else if ('neq' in op) {
      if (op.neq === null) {
        clauses.push(`${col} IS NOT NULL`)
      } else {
        clauses.push(`${col} != ?`)
        params.push(op.neq)
      }
    } else if ('gt' in op) {
      clauses.push(`${col} > ?`)
      params.push(op.gt)
    } else if ('gte' in op) {
      clauses.push(`${col} >= ?`)
      params.push(op.gte)
    } else if ('lt' in op) {
      clauses.push(`${col} < ?`)
      params.push(op.lt)
    } else if ('lte' in op) {
      clauses.push(`${col} <= ?`)
      params.push(op.lte)
    } else if ('in' in op) {
      const arr = op.in
      if (arr.length === 0) {
        // Empty IN → always false
        clauses.push('0')
      } else {
        const placeholders = arr.map(() => '?').join(', ')
        clauses.push(`${col} IN (${placeholders})`)
        params.push(...arr)
      }
    } else if ('notIn' in op) {
      const arr = op.notIn
      if (arr.length === 0) {
        // Empty NOT IN → always true, skip
      } else {
        const placeholders = arr.map(() => '?').join(', ')
        clauses.push(`${col} NOT IN (${placeholders})`)
        params.push(...arr)
      }
    } else if ('like' in op) {
      clauses.push(`${col} LIKE ?`)
      params.push(op.like)
    } else if ('between' in op) {
      clauses.push(`${col} BETWEEN ? AND ?`)
      params.push(op.between[0], op.between[1])
    }
  }

  return {
    where: clauses.length > 0 ? clauses.join(' AND ') : '1',
    params,
  }
}
