// ── Design intent: user request → validated operations ───────────────────────
// Two paths, both validated against the catalog:
//   1. requestToOps()          — deterministic, offline, covers the common phrases.
//   2. extractOpsWithModel()    — asks the local model for JSON ops, then validates.
// The model never invents ids: every op is coerced to shape and run through
// applyOps(), and anything unknown is rejected with a reason.

import {
  type PaletteId,
  type SectionKind,
  type TemplateId,
  listTemplates,
  getTemplate,
  TYPOGRAPHY,
} from './design-catalog'
import {
  type ContentKey,
  type DesignConfig,
  type DesignOp,
  applyOps,
  availableMiddleKinds,
  describeOp,
} from './design-engine'

export interface DesignIntentResult {
  ops: DesignOp[]
  rejected: Array<{ op: DesignOp; reason: string }>
  notes: string[]
  usedModel: boolean
  reply: string
}

const SECTION_WORDS: Array<[RegExp, SectionKind]> = [
  [/\b(navbars?|navigation)\b/, 'navbar'],
  [/\b(heros?|headers?)\b/, 'hero'],
  [/\b(features?)\b/, 'features'],
  [/\b(services?)\b/, 'services'],
  [/\b(galler(y|ies)|showcase|projects?)\b/, 'gallery'],
  [/\b(products?|shop|store|menu|catalog(ue)?)\b/, 'products'],
  [/\b(testimonials?|reviews?|quotes?)\b/, 'testimonials'],
  [/\b(pricing|plans?|packages?)\b/, 'pricing'],
  [/\b(faqs?|questions?)\b/, 'faq'],
  [/\b(newsletter|subscribe|sign-?up)\b/, 'newsletter'],
  [/\b(contacts?)\b/, 'contact'],
  [/\b(footers?)\b/, 'footer'],
]

const PALETTE_WORDS: Array<[RegExp, PaletteId, string]> = [
  [/\b(gold|amber|yellow|mustard)\b/, 'gold', '#a16207'],
  [/\b(emerald|green|forest)\b/, 'emerald', '#047857'],
  [/\b(rose|red|pink|crimson)\b/, 'rose', '#be123c'],
  [/\b(indigo|blue|purple|violet)\b/, 'indigo', '#4338ca'],
  [/\b(slate|black|grey|gray|charcoal|neutral)\b/, 'slate', '#0f172a'],
]

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5,
}

function ordinalNear(text: string): number | null {
  const m = /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+)\b/i.exec(text)
  if (!m) return null
  const token = m[1].toLowerCase()
  if (ORDINALS[token]) return ORDINALS[token]
  const n = Number(token)
  return Number.isFinite(n) ? n : null
}

function templateFromText(text: string): TemplateId | null {
  const lower = text.toLowerCase()
  if (/\b(baker|restaurant|cafe|café|food|coffee|shop|store|ecommerce|e-commerce|product|catalog|boutique)\b/.test(lower)) return 'commerce'
  if (/\b(portfolio|personal|freelanc|designer|developer)\b/.test(lower)) return 'portfolio'
  if (/\b(agency|business|company|consult|saas|b2b|startup|corporate)\b/.test(lower)) return 'business'
  if (/\b(magazine|editorial|journal|blog|news|publication)\b/.test(lower)) return 'editorial'
  return null
}

/** Deterministic phrase → ops. Never throws; unknown phrases yield no ops. */
export function requestToOps(
  raw: string,
  config: DesignConfig,
): { ops: DesignOp[]; notes: string[] } {
  const text = (raw ?? '').trim()
  const lower = text.toLowerCase()
  const ops: DesignOp[] = []
  const notes: string[] = []
  if (!text) return { ops, notes }

  const template = getTemplate(config.templateId)

  // Theme.
  if (/\b(dark)\b/.test(lower)) ops.push({ op: 'set-theme', theme: 'dark' })
  else if (/\b(light)\b/.test(lower)) ops.push({ op: 'set-theme', theme: 'light' })

  // Accent / palette by colour name.
  for (const [re, palette, hex] of PALETTE_WORDS) {
    if (re.test(lower)) {
      const wantsPalette = /\b(palette|theme|colou?r|accent)\b/.test(lower) || /\b(button|btn|cta)s?\b/.test(lower)
      if (/\b(palette|theme|colou?r scheme)\b/.test(lower)) ops.push({ op: 'set-palette', palette })
      if (wantsPalette || /\b(gold|emerald|rose|indigo)\b/.test(lower)) ops.push({ op: 'set-accent', accent: hex })
      break
    }
  }

  // Typography.
  if (/\bserif\b/.test(lower)) ops.push({ op: 'set-typography', typography: 'serif' })
  else if (/\b(display|headline font)\b/.test(lower)) ops.push({ op: 'set-typography', typography: 'display' })
  else if (/\b(sans|clean)\b/.test(lower)) ops.push({ op: 'set-typography', typography: 'sans' })

  // Template selection.
  if (/\b(template|design|layout|website|site)\b/.test(lower)) {
    const n = ordinalNear(lower)
    const byName = templateFromText(lower)
    if (n && n >= 1 && n <= listTemplates().length) {
      ops.push({ op: 'select-template', templateId: listTemplates()[n - 1].id })
    } else if (byName && byName !== config.templateId) {
      ops.push({ op: 'select-template', templateId: byName })
    }
  } else if (/\b(create|build|make|design)\b/.test(lower)) {
    const byName = templateFromText(lower)
    if (byName) ops.push({ op: 'select-template', templateId: byName })
  }

  // Component variant swaps. A variant is only changed when a known id can be
  // matched by name (or an explicit ordinal): the parser never substitutes an
  // unrelated variant just because it could not understand the request.
  const n = ordinalNear(lower)
  if (/\bnavbar\b/.test(lower) && /\b(replace|swap|use|change|first|second|third|\d)\b/.test(lower)) {
    const v = template.navbarVariants
    const pick = navVariantFromText(lower, template.id) ?? (n && v[n - 1] ? v[n - 1].id : null)
    if (pick) ops.push({ op: 'set-navbar', variant: pick })
    else notes.push('Could not match a navbar variant by name — leaving the navbar unchanged.')
  }
  if (/\bhero\b/.test(lower) && /\b(replace|swap|use|change|split|centered|gradient|minimal|statement|promo|collection|feature|\d)\b/.test(lower)) {
    const v = template.heroVariants
    const pick = heroVariantFromText(lower, template.id) ?? (n && v[n - 1] ? v[n - 1].id : null)
    if (pick) ops.push({ op: 'set-hero', variant: pick })
    else notes.push('Could not match a hero variant by name — leaving the hero unchanged.')
  }
  if (/\b(footer)\b/.test(lower) && /\b(replace|swap|use|change|columns|simple)\b/.test(lower)) {
    const v = template.sections.find((s) => s.kind === 'footer')?.variants ?? []
    const want = /\bsimple\b/.test(lower) ? 'simple' : /\bcolumns\b/.test(lower) ? 'columns' : null
    if (want && v.some((x) => x.id === want)) ops.push({ op: 'set-footer', variant: want })
    else notes.push('Could not match a footer variant by name — leaving the footer unchanged.')
  }
  if (/\b(button|btn|cta)s?\b/.test(lower) && /\b(replace|swap|use|change|style|solid|outline|gradient|pill|round|sharp|square)\b/.test(lower)) {
    const v = template.buttonVariants
    const pick =
      (/\b(outline|ghost)\b/.test(lower) && 'outline') ||
      (/\b(gradient)\b/.test(lower) && 'gradient') ||
      (/\b(pill|round)\b/.test(lower) && 'pill') ||
      (/\b(sharp|square)\b/.test(lower) && 'sharp') ||
      (/\b(solid|fill)\b/.test(lower) && 'solid') ||
      null
    if (pick && v.some((x) => x.id === pick)) ops.push({ op: 'set-button', variant: pick })
  }
  if (/\b(card)s?\b/.test(lower) && /\b(replace|swap|use|change|style|elevated|bordered|flat|glass|shadow)\b/.test(lower)) {
    const pick =
      (/\b(elevated|shadow)\b/.test(lower) && 'elevated') ||
      (/\b(bordered|border)\b/.test(lower) && 'bordered') ||
      (/\b(glass|blur|translucent)\b/.test(lower) && 'glass') ||
      (/\b(flat)\b/.test(lower) && 'flat') ||
      null
    if (pick) ops.push({ op: 'set-card', variant: pick })
  }

  // Add / remove / reorder sections.
  const wantsRemove = /\b(remove|delete|drop|hide)\b/.test(lower)
  const wantsAdd = /\b(add|insert|include|append)\b/.test(lower)
  const wantsMove = /\b(move|reorder|put|place)\b/.test(lower)
  for (const [re, kind] of SECTION_WORDS) {
    if (!re.test(lower)) continue
    if (kind === 'navbar' || kind === 'hero' || kind === 'footer') continue
    if (wantsRemove) {
      const inst = config.sections.find((s) => s.kind === kind)
      if (inst) ops.push({ op: 'remove-section', sectionId: inst.id })
      else notes.push(`No ${kind} section to remove.`)
    } else if (wantsAdd) {
      if (!config.sections.some((s) => s.kind === kind)) ops.push({ op: 'add-section', kind })
      else notes.push(`${kind} is already present.`)
    } else if (wantsMove) {
      const mine = config.sections.find((s) => s.kind === kind)
      if (!mine) {
        notes.push(`No ${kind} section to move.`)
        continue
      }
      // "move X above/after Y"
      const targetKind = SECTION_WORDS.find(([re2, k2]) => k2 !== kind && re2.test(lower))?.[1]
      if (targetKind) {
        const idx = config.sections.findIndex((s) => s.id === mine.id)
        const targetIdx = config.sections.findIndex((s) => s.kind === targetKind)
        if (targetIdx >= 0 && idx >= 0) {
          const above = /\b(above|before|over)\b/.test(lower)
          const dir: 'up' | 'down' = targetIdx < idx ? (above ? 'up' : 'down') : above ? 'up' : 'down'
          // Emit enough single-step moves to cross the target.
          const steps = Math.abs(targetIdx - idx)
          for (let s = 0; s < steps; s++) ops.push({ op: 'move-section', sectionId: mine.id, direction: dir })
        }
      } else if (/\b(up|top|first|before)\b/.test(lower)) {
        ops.push({ op: 'move-section', sectionId: mine.id, direction: 'up' })
      } else if (/\b(down|bottom|last|after)\b/.test(lower)) {
        ops.push({ op: 'move-section', sectionId: mine.id, direction: 'down' })
      }
    }
  }

  // Content edits: "change the headline to X". A trailing sentence period (or a
  // surrounding pair of quotes) is not part of the value.
  const contentMatch = /(?:change|set|update|make)\s+(?:the\s+)?(headline|tagline|sub-?headline|brand(?:\s+name)?|primary button|secondary button|contact email)\s+(?:to|=)\s*["“]?([^"”]+?)["”]?\s*[.!?]?\s*$/i.exec(
    text,
  )
  if (contentMatch) {
    const key = contentKeyFromWords(contentMatch[1])
    if (key) ops.push({ op: 'set-content', key, value: contentMatch[2].trim() })
  }

  return { ops, notes }
}

function contentKeyFromWords(w: string): ContentKey | null {
  const s = w.toLowerCase().replace(/\s+/g, ' ')
  if (s.includes('headline')) return 'headline'
  if (s.includes('tagline')) return 'tagline'
  if (s.includes('sub')) return 'subhead'
  if (s.includes('brand')) return 'brand'
  if (s.includes('primary')) return 'ctaPrimary'
  if (s.includes('secondary')) return 'ctaSecondary'
  if (s.includes('email')) return 'contactEmail'
  return null
}

function navVariantFromText(lower: string, id: TemplateId): string | null {
  const t = getTemplate(id)
  const pick = (w: string): string | null => (t.navbarVariants.some((v) => v.id === w) ? w : null)
  if (/\b(floating|pill|detached)\b/.test(lower)) return pick('floating')
  if (/\b(framed|border)\b/.test(lower)) return pick('framed')
  if (/\b(solid|full)\b/.test(lower)) return pick('solid')
  if (/\b(quiet|minimal|inline|borderless)\b/.test(lower)) return pick('quiet')
  if (/\b(commerce|store|shop)\b/.test(lower)) return pick('commerce')
  return null
}

function heroVariantFromText(lower: string, id: TemplateId): string | null {
  const t = getTemplate(id)
  const pick = (w: string): string | null => (t.heroVariants.some((v) => v.id === w) ? w : null)
  if (/\bsplit(\s*screen)?\b/.test(lower)) return pick('split')
  if (/\bcentered?\b/.test(lower)) return pick('centered')
  if (/\bgradient\b/.test(lower)) return pick('gradient')
  if (/\bminimal\b/.test(lower)) return pick('minimal')
  if (/\bstatement\b/.test(lower)) return pick('statement')
  if (/\bpromo\b/.test(lower)) return pick('promo')
  if (/\bcollection\b/.test(lower)) return pick('collection')
  if (/\bfeature\b/.test(lower)) return pick('feature')
  return null
}

/** Does this message look like a website-design request for the studio? */
export function isDesignRequest(text: string): boolean {
  const lower = (text ?? '').toLowerCase()
  if (!lower.trim()) return false
  const siteWord = /\b(website|web site|landing page|webpage|web page|site|template|theme|palette|navbar|hero section|homepage)\b/.test(lower)
  const verb = /\b(create|build|make|design|generate|customize|customise|redo|restyle|redesign)\b/.test(lower)
  const createSite = verb && siteWord
  const templateName = Boolean(templateFromText(lower)) && /\b(website|site|page|template|design)\b/.test(lower)
  const directOps =
    /\b(replace|swap|change|move|reorder|remove|add)\b/.test(lower) &&
    /\b(navbar|hero|footer|button|card|section|testimonials|pricing|features|palette|theme)\b/.test(lower)
  const browse =
    /\b(show|see|preview|browse|give me|four|options?|different|pick|choose)\b/.test(lower) &&
    /\b(designs?|templates?|layouts?|options?|styles?|looks?)\b/.test(lower)
  return createSite || templateName || directOps || browse
}

export function isDesignApplyRequest(text: string): boolean {
  return /design-studio\/site-config|design configuration to src\//i.test(text ?? '')
}

// ── Model-assisted path ──────────────────────────────────────────────────────
export function buildModelPrompt(text: string, config: DesignConfig): string {
  const t = getTemplate(config.templateId)
  const catalog = listTemplates()
    .map((tmpl) => `  - ${tmpl.id}: ${tmpl.name} — ${tmpl.categories.join('/')}`)
    .join('\n')
  const schema =
    'Allowed ops (JSON objects):\n' +
    '  {"op":"select-template","templateId":"editorial|business|portfolio|commerce"}\n' +
    '  {"op":"set-theme","theme":"light|dark"}\n' +
    '  {"op":"set-palette","palette":"slate|gold|emerald|rose|indigo"}\n' +
    '  {"op":"set-accent","accent":"#rrggbb"}\n' +
    '  {"op":"set-typography","typography":"sans|serif|display"}\n' +
    '  {"op":"set-navbar","variant":"<id>"}\n' +
    '  {"op":"set-hero","variant":"<id>"}\n' +
    '  {"op":"set-footer","variant":"<id>"}\n' +
    '  {"op":"set-button","variant":"<id>"}\n' +
    '  {"op":"set-card","variant":"<id>"}\n' +
    '  {"op":"add-section","kind":"<kind>"}\n' +
    '  {"op":"remove-section","sectionId":"<id>"}\n' +
    '  {"op":"set-section-variant","sectionId":"<id>","variant":"<id>"}\n' +
    '  {"op":"move-section","sectionId":"<id>","direction":"up|down"}\n' +
    '  {"op":"set-content","key":"brand|tagline|headline|subhead|ctaPrimary|ctaSecondary|contactEmail","value":"..."}\n'
  return (
    `You are the UI/UX Design Agent. Convert the user's design request into a JSON array of operations.\n` +
    `Templates:\n${catalog}\n\n` +
    `Current template: ${config.templateId} (${t.name}).\n` +
    `Available hero variants: ${t.heroVariants.map((v) => v.id).join(', ')}.\n` +
    `Available navbar variants: ${t.navbarVariants.map((v) => v.id).join(', ')}.\n` +
    `Available button variants: ${t.buttonVariants.map((v) => v.id).join(', ')}.\n` +
    `Available card variants: ${t.cardVariants.map((v) => v.id).join(', ')}.\n` +
    `Available section kinds: ${availableMiddleKinds(config.templateId).join(', ')}.\n` +
    `Current sections: ${config.sections.map((s) => `${s.id}(${s.kind})`).join(', ')}.\n\n` +
    `${schema}\n` +
    `User request: ${text}\n\n` +
    `Reply with ONLY a JSON array of op objects (no prose, no code fences). Use only ids listed above.`
  )
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Coerce arbitrary JSON into candidate DesignOps (shape only; applyOps validates). */
export function coerceOps(value: unknown): DesignOp[] {
  const arr = Array.isArray(value) ? value : []
  const out: DesignOp[] = []
  for (const item of arr) {
    const r = asRecord(item)
    if (!r || typeof r.op !== 'string') continue
    const op = r.op
    const s = (k: string): string => (typeof r[k] === 'string' ? (r[k] as string) : '')
    if (op === 'select-template') out.push({ op: 'select-template', templateId: s('templateId') as TemplateId })
    else if (op === 'set-theme') out.push({ op: 'set-theme', theme: s('theme') as 'light' | 'dark' })
    else if (op === 'set-palette') out.push({ op: 'set-palette', palette: s('palette') as PaletteId })
    else if (op === 'set-accent') out.push({ op: 'set-accent', accent: s('accent') })
    else if (op === 'set-typography') out.push({ op: 'set-typography', typography: s('typography') as DesignConfig['typography'] })
    else if (op === 'set-navbar') out.push({ op: 'set-navbar', variant: s('variant') })
    else if (op === 'set-hero') out.push({ op: 'set-hero', variant: s('variant') })
    else if (op === 'set-footer') out.push({ op: 'set-footer', variant: s('variant') })
    else if (op === 'set-button') out.push({ op: 'set-button', variant: s('variant') })
    else if (op === 'set-card') out.push({ op: 'set-card', variant: s('variant') })
    else if (op === 'add-section') out.push({ op: 'add-section', kind: s('kind') as SectionKind })
    else if (op === 'remove-section') out.push({ op: 'remove-section', sectionId: s('sectionId') })
    else if (op === 'set-section-variant') out.push({ op: 'set-section-variant', sectionId: s('sectionId'), variant: s('variant') })
    else if (op === 'move-section') out.push({ op: 'move-section', sectionId: s('sectionId'), direction: s('direction') === 'up' ? 'up' : 'down' })
    else if (op === 'set-content') out.push({ op: 'set-content', key: s('key') as ContentKey, value: s('value') })
  }
  return out
}

export function extractJsonArray(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply ?? '')
  const body = fenced ? fenced[1] : reply
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return []
  }
}

/**
 * Extract ops with the model, validated. `callModel` is injected by the runtime
 * (its internal LLM transport). Falls back to the deterministic parser when the
 * model is unavailable or proposes nothing usable.
 */
export async function extractOpsWithModel(
  text: string,
  config: DesignConfig,
  callModel: (prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>,
): Promise<DesignIntentResult> {
  const fallback = requestToOps(text, config)
  let modelReply = ''
  try {
    const res = await callModel(buildModelPrompt(text, config))
    if (res.ok && res.text) modelReply = res.text
  } catch {
    /* fall through to deterministic */
  }
  const modelOps = modelReply ? coerceOps(extractJsonArray(modelReply)) : []
  const chosen = modelOps.length > 0 ? modelOps : fallback.ops
  const usedModel = modelOps.length > 0
  const batch = applyOps(config, chosen)
  const lines = batch.applied.map((o) => `• ${describeOp(o)}`)
  const notes = [...fallback.notes]
  if (batch.rejected.length) {
    for (const r of batch.rejected) notes.push(`Rejected ${describeOp(r.op)} — ${r.reason}`)
  }
  const reply = lines.length
    ? `Applied ${batch.applied.length} change(s):\n${lines.join('\n')}${
        notes.length ? `\n\nNotes:\n${notes.map((n) => `- ${n}`).join('\n')}` : ''
      }`
    : `No matching design change was found in "${text}".${notes.length ? `\n\n${notes.map((n) => `- ${n}`).join('\n')}` : ''}`
  return { ops: batch.applied, rejected: batch.rejected, notes, usedModel, reply }
}

/** Typography ids for the UI. */
export const TYPOGRAPHY_IDS = TYPOGRAPHY.map((t) => t.id)

export function templateLabel(id: TemplateId): string {
  return getTemplate(id).name
}
