/**
 * Bounded JSON Schema validation for MCP tool arguments. MCP servers publish
 * arbitrary schemas; unsupported constructs are rejected rather than silently
 * treated as valid. The goal is to stop malformed or surprising tool calls, not
 * to implement every JSON Schema draft.
 */
export interface SchemaValidation {
  ok: boolean
  errors: string[]
  unsupported?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function validateValue(schema: Record<string, unknown>, value: unknown, path: string, errors: string[], depth: number): void {
  if (depth > 12) {
    errors.push(`${path}: schema nesting is too deep.`)
    return
  }
  for (const key of ['$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'patternProperties', 'propertyNames']) {
    if (schema[key] !== undefined) {
      errors.push(`${path}: schema uses unsupported construct "${key}".`)
      return
    }
  }
  const types = Array.isArray(schema.type) ? schema.type : typeof schema.type === 'string' ? [schema.type] : []
  if (types.length > 0) {
    const actual = typeOf(value)
    const matches = types.some((type) => {
      if (type === 'integer') return actual === 'number' && Number.isInteger(value)
      if (type === 'number') return actual === 'number' && Number.isFinite(value)
      if (type === 'object') return actual === 'object'
      return type === actual
    })
    if (!matches) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${actual}.`)
      return
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path}: value is not one of the allowed enum values.`)
  }
  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${path}: string is shorter than ${schema.minLength}.`)
  }
  if (typeof schema.maxLength === 'number' && typeof value === 'string' && value.length > schema.maxLength) {
    errors.push(`${path}: string is longer than ${schema.maxLength}.`)
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${path}: number is below ${schema.minimum}.`)
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errors.push(`${path}: number is above ${schema.maximum}.`)
  }
  const objectLike = types.includes('object') || (types.length === 0 && (schema.properties !== undefined || schema.required !== undefined))
  if (objectLike && isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}".`)
    }
    for (const [key, item] of Object.entries(value)) {
      const child = properties[key]
      if (isRecord(child)) {
        validateValue(child, item, `${path}.${key}`, errors, depth + 1)
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}".`)
      }
    }
  }
  const arrayLike = types.includes('array') || (types.length === 0 && schema.items !== undefined)
  if (arrayLike && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: fewer than ${schema.minItems} items.`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: more than ${schema.maxItems} items.`)
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => validateValue(schema.items as Record<string, unknown>, item, `${path}[${index}]`, errors, depth + 1))
    }
  }
}

export function validateMcpArguments(schema: Record<string, unknown>, args: Record<string, unknown>): SchemaValidation {
  const errors: string[] = []
  if (schema.type !== undefined && schema.type !== 'object' && !(Array.isArray(schema.type) && schema.type.includes('object'))) {
    return { ok: false, errors: [`tool input schema does not describe an object (type ${String(schema.type)}).`] }
  }
  validateValue(schema, args, 'arguments', errors, 0)
  const unsupported = errors.find((error) => error.includes('unsupported construct'))
  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 20),
    ...(unsupported ? { unsupported } : {}),
  }
}
