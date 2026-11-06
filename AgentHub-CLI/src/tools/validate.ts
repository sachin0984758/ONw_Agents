import { ToolInputError } from './types.ts'

export function requireString(
  input: Record<string, unknown>,
  key: string,
  opts: { max?: number; allowEmpty?: boolean } = {},
): string {
  const value = input[key]
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be a string.`)
  if (!opts.allowEmpty && value.length === 0) throw new ToolInputError(`"${key}" must not be empty.`)
  const max = opts.max ?? 2000
  if (value.length > max) throw new ToolInputError(`"${key}" is longer than ${max} characters.`)
  return value
}

export function optionalString(
  input: Record<string, unknown>,
  key: string,
  opts: { max?: number } = {},
): string | undefined {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be a string.`)
  const max = opts.max ?? 2000
  if (value.length > max) throw new ToolInputError(`"${key}" is longer than ${max} characters.`)
  return value
}

export function optionalNumber(
  input: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(`"${key}" must be a number.`)
  }
  if (opts.integer && !Number.isInteger(value)) throw new ToolInputError(`"${key}" must be an integer.`)
  if (opts.min !== undefined && value < opts.min) throw new ToolInputError(`"${key}" must be at least ${opts.min}.`)
  if (opts.max !== undefined && value > opts.max) throw new ToolInputError(`"${key}" must be at most ${opts.max}.`)
  return value
}

export function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new ToolInputError(`"${key}" must be true or false.`)
  return value
}

export function requireStringArray(
  input: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number; itemMax?: number } = {},
): string[] {
  const value = input[key]
  if (!Array.isArray(value)) throw new ToolInputError(`"${key}" must be an array of strings.`)
  if (value.some((v) => typeof v !== 'string')) throw new ToolInputError(`"${key}" must contain only strings.`)
  const arr = value as string[]
  if (opts.min !== undefined && arr.length < opts.min) throw new ToolInputError(`"${key}" needs at least ${opts.min} item(s).`)
  if (opts.max !== undefined && arr.length > opts.max) throw new ToolInputError(`"${key}" allows at most ${opts.max} items.`)
  const itemMax = opts.itemMax ?? 500
  for (const item of arr) {
    if (item.length > itemMax) throw new ToolInputError(`Each "${key}" item must be at most ${itemMax} characters.`)
  }
  return arr
}

export function enumValue<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = input[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ToolInputError(`"${key}" must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}
