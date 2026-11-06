// ── Design engine: config model, validated operations, deterministic output ──
// All selection/validation lives here (never in React). The model proposes ops;
// every op is validated against design-catalog.ts before anything changes. The
// generated site is written as data (a config module), so ordinary changes never
// regenerate the page — Apply rewrites only what actually changed.

import {
  type PaletteId,
  type SectionKind,
  type TemplateId,
  type ThemeMode,
  type TypographyId,
  getTemplate,
  isPaletteId,
  isTemplateId,
  isTypographyId,
  sectionVariantIds,
  variantIds,
} from './design-catalog'

export interface SectionInstance {
  id: string
  kind: SectionKind
  variant: string
}

export type ContentKey =
  | 'brand'
  | 'tagline'
  | 'headline'
  | 'subhead'
  | 'ctaPrimary'
  | 'ctaSecondary'
  | 'contactEmail'

export type DesignContent = Record<ContentKey, string>

export interface DesignConfig {
  version: 1
  templateId: TemplateId
  theme: ThemeMode
  palette: PaletteId
  /** Hex accent override; '' means "use the palette accent". */
  accent: string
  typography: TypographyId
  navbar: string
  hero: string
  footer: string
  button: string
  card: string
  sections: SectionInstance[]
  content: DesignContent
}

/** Chrome sections are fixed top/bottom; `sections` holds the reorderable middle. */
export const CHROME_KINDS: SectionKind[] = ['navbar', 'hero', 'footer']

export const CONTENT_KEYS: ContentKey[] = [
  'brand',
  'tagline',
  'headline',
  'subhead',
  'ctaPrimary',
  'ctaSecondary',
  'contactEmail',
]

export const CONTENT_LABELS: Record<ContentKey, string> = {
  brand: 'Brand name',
  tagline: 'Tagline',
  headline: 'Headline',
  subhead: 'Sub-headline',
  ctaPrimary: 'Primary button',
  ctaSecondary: 'Secondary button',
  contactEmail: 'Contact email',
}

const DEFAULT_CONTENT: Record<TemplateId, DesignContent> = {
  editorial: {
    brand: 'Marrow',
    tagline: 'Independent studio',
    headline: 'Stories worth slowing down for.',
    subhead: 'A premium editorial layout for studios that treat words and whitespace as the product.',
    ctaPrimary: 'Read the journal',
    ctaSecondary: 'Our services',
    contactEmail: 'hello@example.com',
  },
  business: {
    brand: 'Northwind',
    tagline: 'B2B platform',
    headline: 'Ship faster with a team that scales.',
    subhead: 'Everything your agency needs to plan, deliver and prove results — in one workspace.',
    ctaPrimary: 'Start free',
    ctaSecondary: 'Book a demo',
    contactEmail: 'sales@example.com',
  },
  portfolio: {
    brand: 'Ada Molloy',
    tagline: 'Web developer',
    headline: 'Hi, I am Ada — I build fast, accessible websites.',
    subhead: 'I create high-performance web applications and open-source tools.',
    ctaPrimary: 'See my work',
    ctaSecondary: 'Download CV',
    contactEmail: 'ada@example.com',
  },
  commerce: {
    brand: 'Crumb & Co.',
    tagline: 'Bakery & provisions',
    headline: 'Freshly baked, every single morning.',
    subhead: 'Small-batch breads, pastries and seasonal treats delivered across the city.',
    ctaPrimary: 'Shop the menu',
    ctaSecondary: 'Find a store',
    contactEmail: 'orders@example.com',
  },
}

export function middleKinds(templateId: TemplateId): SectionKind[] {
  return getTemplate(templateId).defaultSections.filter((k) => !CHROME_KINDS.includes(k))
}

/** Supported middle-section kinds for a template (in canonical order). */
export function availableMiddleKinds(templateId: TemplateId): SectionKind[] {
  return getTemplate(templateId)
    .sections.map((s) => s.kind)
    .filter((k) => !CHROME_KINDS.includes(k))
}

function defaultVariant(templateId: TemplateId, kind: SectionKind): string {
  const ids = sectionVariantIds(templateId, kind)
  return ids[0] ?? 'default'
}

export function createDefaultConfig(templateId: TemplateId = 'editorial'): DesignConfig {
  const t = getTemplate(templateId)
  const sections: SectionInstance[] = middleKinds(templateId).map((kind, i) => ({
    id: `${kind}-${i + 1}`,
    kind,
    variant: defaultVariant(templateId, kind),
  }))
  return {
    version: 1,
    templateId,
    theme: 'light',
    palette: t.tokens.palettes[0],
    accent: '',
    typography: t.tokens.typography[0],
    navbar: t.navbarVariants[0].id,
    hero: t.heroVariants[0].id,
    footer: defaultVariant(templateId, 'footer'),
    button: t.buttonVariants[0].id,
    card: t.cardVariants[0].id,
    sections,
    content: { ...DEFAULT_CONTENT[templateId] },
  }
}

// ── Operations ───────────────────────────────────────────────────────────────
export type DesignOp =
  | { op: 'select-template'; templateId: TemplateId }
  | { op: 'set-theme'; theme: ThemeMode }
  | { op: 'set-palette'; palette: PaletteId }
  | { op: 'set-accent'; accent: string }
  | { op: 'set-typography'; typography: TypographyId }
  | { op: 'set-navbar'; variant: string }
  | { op: 'set-hero'; variant: string }
  | { op: 'set-footer'; variant: string }
  | { op: 'set-button'; variant: string }
  | { op: 'set-card'; variant: string }
  | { op: 'add-section'; kind: SectionKind; at?: number }
  | { op: 'remove-section'; sectionId: string }
  | { op: 'set-section-variant'; sectionId: string; variant: string }
  | { op: 'move-section'; sectionId: string; direction: 'up' | 'down' }
  | { op: 'set-content'; key: ContentKey; value: string }

export interface OpResult {
  ok: boolean
  op: DesignOp
  reason?: string
  config: DesignConfig
}

function isHex(v: string): boolean {
  return v === '' || /^#[0-9a-fA-F]{3,8}$/.test(v)
}

function cloneConfig(c: DesignConfig): DesignConfig {
  return { ...c, sections: c.sections.map((s) => ({ ...s })), content: { ...c.content } }
}

/** Validate an op against the catalog and the current config. Returns a reason. */
export function validateOp(config: DesignConfig, op: DesignOp): string | null {
  const t = getTemplate(config.templateId)
  switch (op.op) {
    case 'select-template':
      return isTemplateId(op.templateId) ? null : `Unknown template "${op.templateId}".`
    case 'set-theme':
      return t.tokens.themes.includes(op.theme) ? null : `${t.name} does not support the ${op.theme} theme.`
    case 'set-palette':
      return isPaletteId(op.palette) && t.tokens.palettes.includes(op.palette)
        ? null
        : `${t.name} does not offer the "${op.palette}" palette.`
    case 'set-accent':
      return isHex(op.accent) ? null : `Accent must be a hex colour like #a16207 (got "${op.accent}").`
    case 'set-typography':
      return isTypographyId(op.typography) && t.tokens.typography.includes(op.typography)
        ? null
        : `${t.name} does not offer the "${op.typography}" typography.`
    case 'set-navbar':
      return t.navbarVariants.some((v) => v.id === op.variant) ? null : `Unknown navbar variant "${op.variant}" for ${t.name}.`
    case 'set-hero':
      return t.heroVariants.some((v) => v.id === op.variant) ? null : `Unknown hero variant "${op.variant}" for ${t.name}.`
    case 'set-footer':
      return sectionVariantIds(config.templateId, 'footer').includes(op.variant)
        ? null
        : `Unknown footer variant "${op.variant}" for ${t.name}.`
    case 'set-button':
      return variantIds(config.templateId, 'button').includes(op.variant) ? null : `Unknown button variant "${op.variant}".`
    case 'set-card':
      return variantIds(config.templateId, 'card').includes(op.variant) ? null : `Unknown card variant "${op.variant}".`
    case 'add-section': {
      if (CHROME_KINDS.includes(op.kind)) return `"${op.kind}" is fixed chrome, not a movable section.`
      if (!availableMiddleKinds(config.templateId).includes(op.kind)) return `${t.name} has no "${op.kind}" section.`
      if (config.sections.some((s) => s.kind === op.kind)) return `A "${op.kind}" section is already present.`
      return null
    }
    case 'remove-section': {
      const s = config.sections.find((x) => x.id === op.sectionId)
      if (!s) return `No section "${op.sectionId}".`
      return null
    }
    case 'set-section-variant': {
      const s = config.sections.find((x) => x.id === op.sectionId)
      if (!s) return `No section "${op.sectionId}".`
      return sectionVariantIds(config.templateId, s.kind).includes(op.variant)
        ? null
        : `Unknown "${s.kind}" variant "${op.variant}".`
    }
    case 'move-section': {
      const idx = config.sections.findIndex((x) => x.id === op.sectionId)
      if (idx < 0) return `No section "${op.sectionId}".`
      if (op.direction === 'up' && idx === 0) return 'Already the first section.'
      if (op.direction === 'down' && idx === config.sections.length - 1) return 'Already the last section.'
      return null
    }
    case 'set-content': {
      if (!CONTENT_KEYS.includes(op.key)) return `Unknown content field "${op.key}".`
      if (op.value.length > 240) return 'Content is too long (max 240 chars).'
      return null
    }
    default:
      return 'Unknown operation.'
  }
}

/** Apply one op. Invalid ops never mutate the config. */
export function applyOp(config: DesignConfig, op: DesignOp): OpResult {
  const reason = validateOp(config, op)
  if (reason) return { ok: false, op, reason, config }
  const next = cloneConfig(config)
  switch (op.op) {
    case 'select-template': {
      const fresh = createDefaultConfig(op.templateId)
      // Preserve user-written copy; the new template supplies its own sections.
      fresh.content = { ...next.content }
      fresh.theme = next.theme
      return { ok: true, op, config: fresh }
    }
    case 'set-theme':
      next.theme = op.theme
      break
    case 'set-palette':
      next.palette = op.palette
      next.accent = ''
      break
    case 'set-accent':
      next.accent = op.accent
      break
    case 'set-typography':
      next.typography = op.typography
      break
    case 'set-navbar':
      next.navbar = op.variant
      break
    case 'set-hero':
      next.hero = op.variant
      break
    case 'set-footer':
      next.footer = op.variant
      break
    case 'set-button':
      next.button = op.variant
      break
    case 'set-card':
      next.card = op.variant
      break
    case 'add-section': {
      const inst: SectionInstance = { id: `${op.kind}-${Date.now().toString(36)}`, kind: op.kind, variant: defaultVariant(next.templateId, op.kind) }
      const at = typeof op.at === 'number' ? Math.max(0, Math.min(next.sections.length, op.at)) : next.sections.length
      next.sections.splice(at, 0, inst)
      break
    }
    case 'remove-section':
      next.sections = next.sections.filter((s) => s.id !== op.sectionId)
      break
    case 'set-section-variant': {
      const s = next.sections.find((x) => x.id === op.sectionId)
      if (s) s.variant = op.variant
      break
    }
    case 'move-section': {
      const idx = next.sections.findIndex((x) => x.id === op.sectionId)
      const to = op.direction === 'up' ? idx - 1 : idx + 1
      const [item] = next.sections.splice(idx, 1)
      next.sections.splice(to, 0, item)
      break
    }
    case 'set-content':
      next.content = { ...next.content, [op.key]: op.value }
      break
  }
  return { ok: true, op, config: next }
}

export interface BatchResult {
  config: DesignConfig
  applied: DesignOp[]
  rejected: Array<{ op: DesignOp; reason: string }>
}

/** Apply a batch in order; each op validates against the config as it evolves. */
export function applyOps(config: DesignConfig, ops: DesignOp[]): BatchResult {
  let current = config
  const applied: DesignOp[] = []
  const rejected: Array<{ op: DesignOp; reason: string }> = []
  for (const op of ops) {
    const r = applyOp(current, op)
    if (r.ok) {
      current = r.config
      applied.push(op)
    } else {
      rejected.push({ op, reason: r.reason ?? 'invalid' })
    }
  }
  return { config: current, applied, rejected }
}

/** Full validation used before Apply writes anything. */
export function validateConfig(config: DesignConfig): string | null {
  if (!config || typeof config !== 'object') return 'Design config is missing.'
  if (!isTemplateId(config.templateId)) return `Unknown template "${config.templateId}".`
  const t = getTemplate(config.templateId)
  if (!t.tokens.themes.includes(config.theme)) return `Unsupported theme "${config.theme}".`
  if (!t.tokens.palettes.includes(config.palette)) return `Unsupported palette "${config.palette}".`
  if (!isHex(config.accent)) return `Invalid accent "${config.accent}".`
  if (!t.tokens.typography.includes(config.typography)) return `Unsupported typography "${config.typography}".`
  if (!t.navbarVariants.some((v) => v.id === config.navbar)) return `Unknown navbar variant "${config.navbar}".`
  if (!t.heroVariants.some((v) => v.id === config.hero)) return `Unknown hero variant "${config.hero}".`
  if (!sectionVariantIds(config.templateId, 'footer').includes(config.footer)) return `Unknown footer variant "${config.footer}".`
  if (!t.buttonVariants.some((v) => v.id === config.button)) return `Unknown button variant "${config.button}".`
  if (!t.cardVariants.some((v) => v.id === config.card)) return `Unknown card variant "${config.card}".`
  const available = availableMiddleKinds(config.templateId)
  const seen = new Set<string>()
  for (const s of config.sections) {
    if (!available.includes(s.kind)) return `${t.name} has no "${s.kind}" section.`
    if (seen.has(s.kind)) return `Duplicate "${s.kind}" section.`
    seen.add(s.kind)
    if (!sectionVariantIds(config.templateId, s.kind).includes(s.variant)) return `Unknown "${s.kind}" variant "${s.variant}".`
  }
  for (const k of CONTENT_KEYS) {
    if (typeof config.content?.[k] !== 'string') return `Missing content field "${k}".`
  }
  return null
}

// ── Deterministic output: the generated site is data ─────────────────────────
// The design is emitted as a JSON module. Ordinary changes rewrite only this
// file (the page and the renderer are stable), so a small change never
// regenerates the whole site. JSON is a format the runtime's own `syntax_check`
// can genuinely parse, so the Checker verifies the emitted artifact for real.
export const DESIGN_CONFIG_PATH = 'src/components/design-studio/site-config.json'
export const DESIGN_PAGE_PATH = 'src/app/design-studio/page.tsx'

export function renderSiteConfigFile(config: DesignConfig): string {
  return JSON.stringify(config, null, 2) + '\n'
}

export function renderPageFile(): string {
  return (
    '// Generated target route for the Sessions Design Studio.\n' +
    '// This page is stable; "Apply Design" rewrites only site-config.json.\n' +
    "import { GeneratedSite } from '@/components/design-studio/generated-site'\n" +
    "import { siteConfig } from '@/components/design-studio/site-config'\n\n" +
    'export default function DesignStudioPage() {\n' +
    '  return <GeneratedSite config={siteConfig} />\n' +
    '}\n'
  )
}

/** Request text that names the target paths so the file-scope lock permits them. */
export function designApplyRequest(config: DesignConfig): string {
  return (
    `Apply the ${getTemplate(config.templateId).name} design configuration to ` +
    `${DESIGN_CONFIG_PATH} and ${DESIGN_PAGE_PATH}`
  )
}

/** Compact human summary of what Apply will change. */
export function describeConfig(config: DesignConfig): string {
  const t = getTemplate(config.templateId)
  return (
    `${t.name} · ${config.theme} · ${config.palette}${config.accent ? ` (${config.accent})` : ''} · ` +
    `${config.typography} · navbar=${config.navbar} · hero=${config.hero} · button=${config.button} · card=${config.card} · ` +
    `sections=[${config.sections.map((s) => `${s.kind}:${s.variant}`).join(', ')}]`
  )
}

export function describeOp(op: DesignOp): string {
  switch (op.op) {
    case 'select-template':
      return `template → ${op.templateId}`
    case 'set-theme':
      return `theme → ${op.theme}`
    case 'set-palette':
      return `palette → ${op.palette}`
    case 'set-accent':
      return `accent → ${op.accent || 'palette default'}`
    case 'set-typography':
      return `typography → ${op.typography}`
    case 'set-navbar':
      return `navbar → ${op.variant}`
    case 'set-hero':
      return `hero → ${op.variant}`
    case 'set-footer':
      return `footer → ${op.variant}`
    case 'set-button':
      return `buttons → ${op.variant}`
    case 'set-card':
      return `cards → ${op.variant}`
    case 'add-section':
      return `add section ${op.kind}`
    case 'remove-section':
      return `remove section ${op.sectionId}`
    case 'set-section-variant':
      return `section ${op.sectionId} → ${op.variant}`
    case 'move-section':
      return `move ${op.sectionId} ${op.direction}`
    case 'set-content':
      return `${op.key} → "${op.value}"`
    default:
      return 'op'
  }
}
