// ── Website template catalog (deterministic, extensible) ─────────────────────
// The catalog is the single source of truth for what the Sessions Design Studio
// can select and customize. It describes only templates/sections/variants that
// have a REAL local rendering (see src/components/design-studio/site-renderer.tsx).
// The model never invents ids: every operation is validated against this file.
//
// Provenance: the rendering is an original adaptation of the named upstream
// component patterns, which live isolated under
// `.agenthub/website-template-library/sources/`. All sources are MIT-licensed
// (the themixly free version is MIT; its README separately notes a Pro edition).
// Nothing here copies a whole upstream project; only component patterns were
// re-implemented against the host shadcn/Tailwind setup.

export type TemplateId = 'editorial' | 'business' | 'portfolio' | 'commerce'
export type ThemeMode = 'light' | 'dark'
export type TypographyId = 'sans' | 'serif' | 'display'
export type PaletteId = 'slate' | 'gold' | 'emerald' | 'rose' | 'indigo'

export type SectionKind =
  | 'navbar'
  | 'hero'
  | 'features'
  | 'services'
  | 'gallery'
  | 'products'
  | 'testimonials'
  | 'pricing'
  | 'faq'
  | 'newsletter'
  | 'contact'
  | 'footer'

export interface Variant {
  id: string
  label: string
  description: string
}

export interface Provenance {
  sourceId: string
  name: string
  repository: string
  url: string
  commit: string
  license: string
  licenseFile: string | null
  licenseRisk: string
  /** Component roles whose prebuilt upstream component was inspected and adapted. */
  reusedFor: string[]
  /** Real files under the source checkout, inspected before integration (verify-on-disk). */
  inspectedFiles: string[]
}

export interface SectionSpec {
  kind: SectionKind
  label: string
  variants: Variant[]
}

export interface DesignTokens {
  themes: ThemeMode[]
  palettes: PaletteId[]
  typography: TypographyId[]
}

export interface TemplateFamily {
  id: TemplateId
  name: string
  categories: string[]
  summary: string
  provenance: Provenance[]
  defaultSections: SectionKind[]
  /** Sections this template can render, with their supported variants. */
  sections: SectionSpec[]
  heroVariants: Variant[]
  navbarVariants: Variant[]
  buttonVariants: Variant[]
  cardVariants: Variant[]
  tokens: DesignTokens
}

// ── Upstream provenance (mirrors source-lock.json; commit SHAs are evidence) ──
export const DESIGN_SOURCES: Provenance[] = [
  {
    sourceId: 'shadcnstore-dashboard-landing',
    name: 'ShadcnStore Dashboard + Landing Template',
    repository: 'shadcnstore/shadcn-dashboard-landing-template',
    url: 'https://github.com/shadcnstore/shadcn-dashboard-landing-template',
    commit: '953300fa5176608a9d682943edfc359ce809f2c7',
    license: 'MIT',
    licenseFile: 'License.md',
    licenseRisk: 'low; inspect bundled images separately',
    reusedFor: ['navbar', 'hero', 'features', 'pricing', 'footer'],
    inspectedFiles: [
      'nextjs-version/src/components/site-header.tsx',
      'nextjs-version/src/components/site-footer.tsx',
      'nextjs-version/src/components/pricing-plans.tsx',
      'nextjs-version/src/app/landing/components/hero-section.tsx',
      'nextjs-version/src/app/landing/components/features-section.tsx',
      'nextjs-version/src/app/landing/components/pricing-section.tsx',
      'nextjs-version/src/app/landing/components/footer.tsx',
      'nextjs-version/src/app/landing/landing-page-content.tsx',
    ],
  },
  {
    sourceId: 'shadcnspace-ecommerce',
    name: 'shadcnspace E-commerce Template',
    repository: 'shadcnspace/ecommerce-shadcn-nextjs-template',
    url: 'https://github.com/shadcnspace/ecommerce-shadcn-nextjs-template',
    commit: '2df689427f1c22c6ed558ba59e13ac34965e6cec',
    license: 'MIT',
    licenseFile: 'LICENSE',
    licenseRisk: 'low; inspect assets',
    reusedFor: ['navbar', 'hero', 'products', 'features', 'testimonials', 'faq', 'newsletter', 'contact', 'footer', 'card', 'button'],
    inspectedFiles: [
      'components/shadcn-space/blocks/navbar-01/navbar.tsx',
      'components/shadcn-space/blocks/hero-01/hero.tsx',
      'components/shadcn-space/blocks/product-listing-01/product-card.tsx',
      'components/shadcn-space/blocks/product-catalog/product-catalog.tsx',
      'components/shadcn-space/blocks/feature-02/feature.tsx',
      'components/shadcn-space/blocks/testimonial-01/testimonial.tsx',
      'components/shadcn-space/blocks/faq-01/faq.tsx',
      'components/shadcn-space/blocks/newsletter-01/newsletter.tsx',
      'components/shadcn-space/blocks/contact-01/contact-form.tsx',
      'components/shadcn-space/blocks/footer-01/footer.tsx',
      'components/ui/card.tsx',
      'components/ui/button.tsx',
      'components/ui/badge.tsx',
    ],
  },
  {
    sourceId: 'nobruf-shadcn-landing',
    name: 'nobruf shadcn Landing Page',
    repository: 'nobruf/shadcn-landing-page',
    url: 'https://github.com/nobruf/shadcn-landing-page',
    commit: 'ec8e18e8ed56ed6636023ced09948515c19258cc',
    license: 'MIT',
    licenseFile: 'LICENSE',
    licenseRisk: 'low',
    reusedFor: ['navbar', 'hero', 'features', 'services', 'pricing', 'testimonials', 'faq', 'contact', 'footer', 'card', 'button'],
    inspectedFiles: [
      'components/layout/navbar.tsx',
      'components/layout/sections/hero.tsx',
      'components/layout/sections/features.tsx',
      'components/layout/sections/services.tsx',
      'components/layout/sections/pricing.tsx',
      'components/layout/sections/testimonial.tsx',
      'components/layout/sections/faq.tsx',
      'components/layout/sections/contact.tsx',
      'components/layout/sections/footer.tsx',
      'components/ui/card.tsx',
      'components/ui/button.tsx',
      'components/ui/badge.tsx',
    ],
  },
  {
    sourceId: 'danmolloy-portfolio',
    name: 'danmolloy Portfolio Template',
    repository: 'danmolloy/portfolio-template',
    url: 'https://github.com/danmolloy/portfolio-template',
    commit: '14798a3220263483f4fc5479d1f10ccdfdd1a01d',
    license: 'MIT (README; no LICENSE file in the download)',
    licenseFile: null,
    licenseRisk: 'verify LICENSE before production reuse',
    reusedFor: ['navbar', 'hero', 'gallery', 'testimonials', 'contact', 'footer'],
    inspectedFiles: [
      'components/header.tsx',
      'components/hero.tsx',
      'components/projects.tsx',
      'components/projectCard.tsx',
      'components/contact.tsx',
      'components/footer.tsx',
    ],
  },
  {
    sourceId: 'blackgirlbytes-restaurant-menu',
    name: 'Blackgyalbites Restaurant / QR Menu',
    repository: 'blackgirlbytes/blackgyalbites-nextjs',
    url: 'https://github.com/blackgirlbytes/blackgyalbites-nextjs',
    commit: '7592a5acc48bdeeb198dd22ca38ef3158879605d',
    license: 'MIT',
    licenseFile: 'LICENSE',
    licenseRisk: 'review image/design assets separately',
    reusedFor: ['navbar', 'products', 'footer'],
    inspectedFiles: [
      'src/components/Header.tsx',
      'src/components/Footer.tsx',
      'src/components/AdditionalInformation.tsx',
      'src/components/Buttons/MenuButton.tsx',
      'src/components/Buttons/MenuButtons.tsx',
    ],
  },
  {
    sourceId: 'themixly-bakery-review-license',
    name: 'Themixly React Bakery Template',
    repository: 'themixlyweb/react-bakery-website-template',
    url: 'https://github.com/themixlyweb/react-bakery-website-template',
    commit: '2d17178862bb015099d29274bcdd9cfc29bf711f',
    license: 'MIT (free GitHub version; README also lists a commercial Pro edition)',
    licenseFile: 'LICENSE',
    licenseRisk: 'manual review recommended before commercial reuse',
    reusedFor: ['navbar', 'hero', 'footer'],
    inspectedFiles: [
      'src/components/HeroBanner.tsx',
      'src/components/Navigation.tsx',
      'src/components/TopBar.tsx',
      'src/components/Footer.tsx',
    ],
  },
]

const SOURCE = Object.fromEntries(DESIGN_SOURCES.map((s) => [s.sourceId, s])) as Record<string, Provenance>

// ── Design tokens: palettes (accent sets) ────────────────────────────────────
export interface Palette {
  id: PaletteId
  label: string
  accent: string
  accentForeground: string
  swatch: string[]
}

export const PALETTES: Palette[] = [
  { id: 'slate', label: 'Slate', accent: '#0f172a', accentForeground: '#ffffff', swatch: ['#0f172a', '#64748b', '#e2e8f0'] },
  { id: 'gold', label: 'Gold', accent: '#a16207', accentForeground: '#ffffff', swatch: ['#a16207', '#eab308', '#fef3c7'] },
  { id: 'emerald', label: 'Emerald', accent: '#047857', accentForeground: '#ffffff', swatch: ['#047857', '#10b981', '#d1fae5'] },
  { id: 'rose', label: 'Rose', accent: '#be123c', accentForeground: '#ffffff', swatch: ['#be123c', '#fb7185', '#ffe4e6'] },
  { id: 'indigo', label: 'Indigo', accent: '#4338ca', accentForeground: '#ffffff', swatch: ['#4338ca', '#818cf8', '#e0e7ff'] },
]

export const THEMES: ThemeMode[] = ['light', 'dark']

export interface Typography {
  id: TypographyId
  label: string
  stack: string
}

export const TYPOGRAPHY: Typography[] = [
  { id: 'sans', label: 'Sans', stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' },
  { id: 'display', label: 'Display', stack: '"Trebuchet MS", "Segoe UI", ui-sans-serif, system-ui, sans-serif' },
]

// ── Variant sets (shared shapes; templates choose which to expose) ───────────
const HERO_VARIANTS: Record<TemplateId, Variant[]> = {
  editorial: [
    { id: 'centered', label: 'Centered editorial', description: 'Large centered headline, badge, dual CTA and a wide showcase plate.' },
    { id: 'split', label: 'Split screen', description: 'Text on the left, framed media plate on the right.' },
    { id: 'feature', label: 'Feature banner', description: 'Full-bleed banner with an oversized serif headline.' },
  ],
  business: [
    { id: 'split', label: 'Split value prop', description: 'Copy left, product/mock right, KPI strip underneath.' },
    { id: 'centered', label: 'Centered SaaS', description: 'Centered headline with logo cloud and dual CTA.' },
    { id: 'gradient', label: 'Gradient hero', description: 'Accent-gradient panel with CTA and stats.' },
  ],
  portfolio: [
    { id: 'minimal', label: 'Minimal intro', description: 'Understated "Hi, I am…" intro with two quiet links.' },
    { id: 'statement', label: 'Bold statement', description: 'Very large name, tagline and availability pill.' },
    { id: 'split', label: 'Split portrait', description: 'Intro copy beside a portrait/placeholder plate.' },
  ],
  commerce: [
    { id: 'promo', label: 'Promo hero', description: 'Bold product promo with price badge and shop CTA.' },
    { id: 'split', label: 'Product split', description: 'Product plate beside headline and add-to-cart.' },
    { id: 'collection', label: 'Collection grid', description: 'Category tiles beneath a short banner.' },
  ],
}

const NAVBAR_VARIANTS: Record<TemplateId, Variant[]> = {
  editorial: [
    { id: 'floating', label: 'Floating pill', description: 'Detached rounded pill bar (nobruf pattern).' },
    { id: 'framed', label: 'Framed editorial', description: 'Thin bordered bar with serif wordmark.' },
  ],
  business: [
    { id: 'solid', label: 'Solid SaaS', description: 'Full-width solid bar with a drop-down menu.' },
    { id: 'floating', label: 'Floating pill', description: 'Detached rounded pill bar.' },
  ],
  portfolio: [
    { id: 'quiet', label: 'Quiet inline', description: 'Borderless inline links, name on the left.' },
    { id: 'framed', label: 'Framed', description: 'Thin bordered bar.' },
  ],
  commerce: [
    { id: 'commerce', label: 'Store bar', description: 'Announcement strip + search + cart/account icons.' },
    { id: 'solid', label: 'Solid', description: 'Compact solid store nav.' },
  ],
}

const BUTTON_VARIANTS: Variant[] = [
  { id: 'solid', label: 'Solid', description: 'Filled accent button.' },
  { id: 'outline', label: 'Outline', description: 'Transparent with accent border.' },
  { id: 'gradient', label: 'Gradient', description: 'Accent gradient fill.' },
  { id: 'pill', label: 'Pill', description: 'Fully rounded solid button.' },
  { id: 'sharp', label: 'Sharp', description: 'Squared, editorial button.' },
]

const CARD_VARIANTS: Variant[] = [
  { id: 'elevated', label: 'Elevated', description: 'Soft shadow, rounded.' },
  { id: 'bordered', label: 'Bordered', description: 'Thin border, flat.' },
  { id: 'flat', label: 'Flat', description: 'Tinted surface, no border.' },
  { id: 'glass', label: 'Glass', description: 'Translucent blurred surface.' },
]

function sections(map: Partial<Record<SectionKind, Variant[]>>): SectionSpec[] {
  const labels: Record<SectionKind, string> = {
    navbar: 'Navigation bar',
    hero: 'Hero',
    features: 'Features',
    services: 'Services',
    gallery: 'Gallery / showcase',
    products: 'Products',
    testimonials: 'Testimonials',
    pricing: 'Pricing',
    faq: 'FAQ',
    newsletter: 'Newsletter',
    contact: 'Contact',
    footer: 'Footer',
  }
  return (Object.keys(map) as SectionKind[]).map((kind) => ({ kind, label: labels[kind], variants: map[kind]! }))
}

// ── The four template families ───────────────────────────────────────────────
export const TEMPLATES: TemplateFamily[] = [
  {
    id: 'editorial',
    name: 'Premium Editorial',
    categories: ['agency', 'business', 'landing-page', 'magazine'],
    summary: 'Magazine-style landing with an oversized serif headline, feature grid and testimonial wall.',
    provenance: [SOURCE['nobruf-shadcn-landing'], SOURCE['shadcnstore-dashboard-landing']],
    defaultSections: ['navbar', 'hero', 'features', 'gallery', 'testimonials', 'pricing', 'contact', 'footer'],
    heroVariants: HERO_VARIANTS.editorial,
    navbarVariants: NAVBAR_VARIANTS.editorial,
    buttonVariants: BUTTON_VARIANTS,
    cardVariants: CARD_VARIANTS,
    tokens: { themes: THEMES, palettes: ['slate', 'gold', 'indigo', 'rose'], typography: ['serif', 'sans', 'display'] },
    sections: sections({
      navbar: NAVBAR_VARIANTS.editorial,
      hero: HERO_VARIANTS.editorial,
      features: [
        { id: 'grid-3', label: 'Three-up grid', description: 'Three feature cards in a row.' },
        { id: 'split', label: 'Split list', description: 'Media beside a bulleted feature list.' },
      ],
      gallery: [
        { id: 'grid', label: 'Grid', description: 'Even gallery grid.' },
        { id: 'masonry', label: 'Masonry', description: 'Staggered gallery columns.' },
      ],
      testimonials: [
        { id: 'cards', label: 'Cards', description: 'Quote cards side by side.' },
        { id: 'single', label: 'Single quote', description: 'One large pull-quote.' },
      ],
      pricing: [
        { id: 'three-tier', label: 'Three tiers', description: 'Classic 3-plan table.' },
        { id: 'simple', label: 'Simple', description: 'Two plans.' },
      ],
      contact: [
        { id: 'split', label: 'Split', description: 'Copy beside a form.' },
        { id: 'form', label: 'Form', description: 'Centered form.' },
      ],
      footer: [
        { id: 'columns', label: 'Columns', description: 'Multi-column footer.' },
        { id: 'simple', label: 'Simple', description: 'Single-line footer.' },
      ],
    }),
  },
  {
    id: 'business',
    name: 'Modern Business / Agency',
    categories: ['agency', 'saas', 'business', 'b2b'],
    summary: 'Conversion-focused landing with a split value prop, KPI strip, pricing and FAQ.',
    provenance: [SOURCE['shadcnstore-dashboard-landing'], SOURCE['nobruf-shadcn-landing']],
    defaultSections: ['navbar', 'hero', 'features', 'services', 'testimonials', 'pricing', 'faq', 'contact', 'footer'],
    heroVariants: HERO_VARIANTS.business,
    navbarVariants: NAVBAR_VARIANTS.business,
    buttonVariants: BUTTON_VARIANTS,
    cardVariants: CARD_VARIANTS,
    tokens: { themes: THEMES, palettes: ['indigo', 'slate', 'emerald', 'gold'], typography: ['sans', 'display'] },
    sections: sections({
      navbar: NAVBAR_VARIANTS.business,
      hero: HERO_VARIANTS.business,
      features: [
        { id: 'grid-3', label: 'Three-up grid', description: 'Three value cards.' },
        { id: 'cards', label: 'Icon cards', description: 'Bordered icon cards.' },
      ],
      services: [
        { id: 'cards', label: 'Service cards', description: 'Service cards with copy.' },
        { id: 'list', label: 'Numbered list', description: 'Numbered service list.' },
      ],
      testimonials: [
        { id: 'cards', label: 'Cards', description: 'Customer quote cards.' },
      ],
      pricing: [
        { id: 'three-tier', label: 'Three tiers', description: 'Classic 3-plan table.' },
        { id: 'simple', label: 'Simple', description: 'Two plans.' },
      ],
      faq: [
        { id: 'accordion', label: 'Accordion', description: 'Expandable questions.' },
        { id: 'list', label: 'List', description: 'Static Q&A list.' },
      ],
      contact: [
        { id: 'split', label: 'Split', description: 'Copy beside a form.' },
      ],
      footer: [
        { id: 'columns', label: 'Columns', description: 'Multi-column footer.' },
      ],
    }),
  },
  {
    id: 'portfolio',
    name: 'Minimal Portfolio',
    categories: ['portfolio', 'personal', 'business', 'freelancer'],
    summary: 'Quiet personal portfolio with a minimal intro, project grid and resume link.',
    provenance: [SOURCE['danmolloy-portfolio']],
    defaultSections: ['navbar', 'hero', 'gallery', 'testimonials', 'contact', 'footer'],
    heroVariants: HERO_VARIANTS.portfolio,
    navbarVariants: NAVBAR_VARIANTS.portfolio,
    buttonVariants: BUTTON_VARIANTS,
    cardVariants: CARD_VARIANTS,
    tokens: { themes: THEMES, palettes: ['emerald', 'slate', 'indigo'], typography: ['sans', 'serif'] },
    sections: sections({
      navbar: NAVBAR_VARIANTS.portfolio,
      hero: HERO_VARIANTS.portfolio,
      gallery: [
        { id: 'grid', label: 'Project grid', description: 'Project cards in a grid.' },
        { id: 'masonry', label: 'Masonry', description: 'Staggered project columns.' },
      ],
      testimonials: [
        { id: 'cards', label: 'Cards', description: 'Client quotes.' },
        { id: 'single', label: 'Single quote', description: 'One large pull-quote.' },
      ],
      contact: [
        { id: 'form', label: 'Contact form', description: 'Quiet contact form.' },
        { id: 'split', label: 'Split', description: 'Copy beside a form.' },
      ],
      footer: [
        { id: 'simple', label: 'Simple', description: 'Single-line footer.' },
        { id: 'columns', label: 'Columns', description: 'Multi-column footer.' },
      ],
    }),
  },
  {
    id: 'commerce',
    name: 'Bold Product / E-commerce',
    categories: ['ecommerce', 'store', 'product', 'catalog'],
    summary: 'Storefront with a promo hero, category tiles, product grid and newsletter capture.',
    provenance: [SOURCE['shadcnspace-ecommerce'], SOURCE['themixly-bakery-review-license'], SOURCE['blackgirlbytes-restaurant-menu']],
    defaultSections: ['navbar', 'hero', 'features', 'products', 'testimonials', 'newsletter', 'footer'],
    heroVariants: HERO_VARIANTS.commerce,
    navbarVariants: NAVBAR_VARIANTS.commerce,
    buttonVariants: BUTTON_VARIANTS,
    cardVariants: CARD_VARIANTS,
    tokens: { themes: THEMES, palettes: ['rose', 'gold', 'emerald', 'slate'], typography: ['sans', 'display'] },
    sections: sections({
      navbar: NAVBAR_VARIANTS.commerce,
      hero: HERO_VARIANTS.commerce,
      features: [
        { id: 'grid-3', label: 'Category tiles', description: 'Three category tiles.' },
      ],
      products: [
        { id: 'grid', label: 'Product grid', description: 'Product cards with price/rating.' },
        { id: 'featured', label: 'Featured', description: 'One featured product plus a row.' },
      ],
      testimonials: [
        { id: 'cards', label: 'Reviews', description: 'Customer review cards.' },
      ],
      newsletter: [
        { id: 'inline', label: 'Inline', description: 'Inline email capture.' },
        { id: 'banner', label: 'Banner', description: 'Full-width capture banner.' },
      ],
      footer: [
        { id: 'columns', label: 'Columns', description: 'Multi-column store footer.' },
      ],
    }),
  },
]

const TEMPLATE_MAP: Record<TemplateId, TemplateFamily> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
) as Record<TemplateId, TemplateFamily>

export function listTemplates(): TemplateFamily[] {
  return TEMPLATES
}

export function getTemplate(id: TemplateId): TemplateFamily {
  const t = TEMPLATE_MAP[id]
  if (!t) throw new Error(`Unknown template "${id}".`)
  return t
}

export function isTemplateId(id: string): id is TemplateId {
  return Boolean(TEMPLATE_MAP[id as TemplateId])
}

export function getPalette(id: PaletteId): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

export function isPaletteId(id: string): id is PaletteId {
  return PALETTES.some((p) => p.id === id)
}

export function isTypographyId(id: string): id is TypographyId {
  return TYPOGRAPHY.some((t) => t.id === id)
}

export function sectionSpec(templateId: TemplateId, kind: SectionKind): SectionSpec | undefined {
  return getTemplate(templateId).sections.find((s) => s.kind === kind)
}

export function sectionVariantIds(templateId: TemplateId, kind: SectionKind): string[] {
  return sectionSpec(templateId, kind)?.variants.map((v) => v.id) ?? []
}

export function variantIds(templateId: TemplateId, role: 'hero' | 'navbar' | 'button' | 'card'): string[] {
  const t = getTemplate(templateId)
  const list =
    role === 'hero' ? t.heroVariants : role === 'navbar' ? t.navbarVariants : role === 'button' ? t.buttonVariants : t.cardVariants
  return list.map((v) => v.id)
}

export function paletteCssVars(
  theme: ThemeMode,
  palette: PaletteId,
  accent: string,
): Record<string, string> {
  const neutrals =
    theme === 'dark'
      ? { bg: '#0a0a0b', fg: '#f5f5f4', muted: '#18181b', card: '#121214', border: '#29292e' }
      : { bg: '#ffffff', fg: '#0b0b0c', muted: '#f4f4f5', card: '#ffffff', border: '#e6e6e9' }
  const pal = getPalette(palette)
  const useAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : pal.accent
  return {
    '--ds-bg': neutrals.bg,
    '--ds-fg': neutrals.fg,
    '--ds-muted': neutrals.muted,
    '--ds-card': neutrals.card,
    '--ds-border': neutrals.border,
    '--ds-accent': useAccent,
    '--ds-accent-fg': pal.accentForeground,
  }
}
