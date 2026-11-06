'use client'

// ── Design Studio site renderer ──────────────────────────────────────────────
// The single real implementation behind every template preview AND the
// generated `/design-studio` route. Each template/section/variant here has a
// distinct layout (no shared "fake preview" skeleton). Patterns are original
// adaptations of the MIT-licensed upstream components listed in design-catalog
// provenance (nobruf landing, shadcnstore landing, danmolloy portfolio,
// shadcnspace e-commerce, themixly bakery, blackgirlbytes menu).

import { useMemo, useState } from 'react'
import {
  ArrowRight, Star, Heart, ShoppingCart, Search, Menu, X, Check, ChevronDown,
  Sparkles, Shield, Zap, Leaf, Coffee, MapPin, Mail,
} from 'lucide-react'
import { type DesignConfig } from '@/lib/agent-hub/design-engine'
import { type SectionKind, getPalette, getTemplate, paletteCssVars, TYPOGRAPHY } from '@/lib/agent-hub/design-catalog'

type BtnVariant = string
type CardVariant = string

const BASE = 'bg-[var(--ds-bg)] text-[var(--ds-fg)]'

function btnClass(variant: BtnVariant): string {
  const base = 'inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors'
  switch (variant) {
    case 'outline':
      return `${base} rounded-md border border-[var(--ds-accent)] text-[var(--ds-accent)] hover:bg-[var(--ds-accent)]/10`
    case 'gradient':
      return `${base} rounded-md text-white`
    case 'pill':
      return `${base} rounded-full bg-[var(--ds-accent)] text-[var(--ds-accent-fg)] hover:opacity-90`
    case 'sharp':
      return `${base} rounded-none bg-[var(--ds-accent)] text-[var(--ds-accent-fg)] hover:opacity-90`
    default:
      return `${base} rounded-md bg-[var(--ds-accent)] text-[var(--ds-accent-fg)] hover:opacity-90`
  }
}

function btnStyle(variant: BtnVariant): React.CSSProperties | undefined {
  if (variant === 'gradient') {
    return { backgroundImage: 'linear-gradient(135deg, var(--ds-accent), color-mix(in srgb, var(--ds-accent) 55%, #ffffff))' }
  }
  return undefined
}

function DSButton({ variant, children, primary }: { variant: BtnVariant; children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="button" className={btnClass(variant)} style={btnStyle(variant)} data-primary={primary ? 'true' : undefined}>
      {children}
    </button>
  )
}

function cardClass(variant: CardVariant, extra = ''): string {
  switch (variant) {
    case 'bordered':
      return `rounded-lg border border-[var(--ds-border)] bg-[var(--ds-card)] ${extra}`
    case 'flat':
      return `rounded-lg bg-[var(--ds-muted)] ${extra}`
    case 'glass':
      return `rounded-xl border border-[var(--ds-border)] backdrop-blur-md ${extra}`
    default:
      return `rounded-xl border border-[var(--ds-border)] bg-[var(--ds-card)] shadow-sm ${extra}`
  }
}

function cardStyle(variant: CardVariant): React.CSSProperties | undefined {
  if (variant === 'glass') return { backgroundColor: 'color-mix(in srgb, var(--ds-card) 72%, transparent)' }
  return undefined
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ds-border)] bg-[var(--ds-muted)] px-3 py-1 text-xs text-[var(--ds-fg)]/80">
      {children}
    </span>
  )
}

function SectionHeading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {eyebrow ? <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--ds-accent)]">{eyebrow}</div> : null}
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {sub ? <p className="mt-3 text-sm text-[var(--ds-fg)]/65">{sub}</p> : null}
    </div>
  )
}

const NAV_LINKS = ['Features', 'Collection', 'Reviews', 'Pricing', 'Contact']

function Navbar({ config, onToggleTheme }: { config: DesignConfig; onToggleTheme: () => void }) {
  const [open, setOpen] = useState(false)
  const links = NAV_LINKS.slice(0, config.sections.length + 2)
  const brand = config.content.brand
  const variant = config.navbar
  const themeBtn = (
    <button
      type="button"
      onClick={onToggleTheme}
      className="rounded-md border border-[var(--ds-border)] px-2 py-1 text-xs text-[var(--ds-fg)]/80 hover:bg-[var(--ds-muted)]"
      aria-label="Toggle theme"
    >
      {config.theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )

  if (variant === 'commerce') {
    return (
      <div className="w-full">
        <div className="bg-[var(--ds-accent)] px-4 py-1.5 text-center text-xs text-[var(--ds-accent-fg)]">
          Free delivery on orders over $40 — this week only
        </div>
        <header className="flex items-center gap-3 border-b border-[var(--ds-border)] px-4 py-3 sm:px-8">
          <span className="text-lg font-bold">{brand}</span>
          <div className="mx-2 hidden flex-1 items-center gap-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-muted)] px-3 py-1.5 text-sm text-[var(--ds-fg)]/60 sm:flex">
            <Search className="size-4" /> Search products…
          </div>
          <div className="ml-auto flex items-center gap-2">{themeBtn}
            <Heart className="size-5" />
            <div className="relative"><ShoppingCart className="size-5" /><span className="absolute -right-2 -top-2 rounded-full bg-[var(--ds-accent)] px-1 text-[10px] text-[var(--ds-accent-fg)]">2</span></div>
          </div>
        </header>
      </div>
    )
  }

  if (variant === 'floating') {
    return (
      <header className="sticky top-4 z-20 mx-auto flex w-[95%] max-w-5xl items-center justify-between rounded-2xl border border-[var(--ds-border)] bg-[var(--ds-card)] px-3 py-2 shadow-sm">
        <span className="flex items-center gap-2 text-lg font-bold"><Sparkles className="size-5 text-[var(--ds-accent)]" />{brand}</span>
        <nav className="hidden gap-5 text-sm text-[var(--ds-fg)]/75 md:flex">{links.map((l) => <span key={l}>{l}</span>)}</nav>
        <div className="hidden items-center gap-2 md:flex">{themeBtn}<DSButton variant={config.button}>Get started</DSButton></div>
        <button type="button" className="md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
        {open ? (
          <div className="absolute left-0 right-0 top-full mt-2 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-card)] p-3 md:hidden">
            {links.map((l) => <div key={l} className="px-2 py-2 text-sm">{l}</div>)}
          </div>
        ) : null}
      </header>
    )
  }

  if (variant === 'framed') {
    return (
      <header className="border-b border-[var(--ds-border)] bg-[var(--ds-bg)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-serif text-xl font-semibold tracking-tight">{brand}</span>
          <nav className="hidden gap-6 text-sm uppercase tracking-wide text-[var(--ds-fg)]/70 md:flex">{links.map((l) => <span key={l}>{l}</span>)}</nav>
          <div className="flex items-center gap-2">{themeBtn}<DSButton variant={config.button}>Subscribe</DSButton></div>
        </div>
      </header>
    )
  }

  if (variant === 'quiet') {
    return (
      <header className="border-b border-[var(--ds-border)]/60">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <span className="text-base font-semibold">{brand}</span>
          <nav className="hidden gap-6 text-sm text-[var(--ds-fg)]/70 md:flex">{links.slice(0, 4).map((l) => <span key={l}>{l}</span>)}</nav>
          <div>{themeBtn}</div>
        </div>
      </header>
    )
  }

  // solid
  return (
    <header className="bg-[var(--ds-accent)] text-[var(--ds-accent-fg)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <span className="text-lg font-bold">{brand}</span>
        <nav className="hidden gap-6 text-sm md:flex">{links.map((l) => <span key={l} className="opacity-90">{l}</span>)}</nav>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onToggleTheme} className="rounded-md border border-white/30 px-2 py-1 text-xs">
            {config.theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <span className="rounded-md bg-white/15 px-4 py-2 text-sm font-medium">Get started</span>
        </div>
      </div>
    </header>
  )
}

function Hero({ config }: { config: DesignConfig }) {
  const c = config.content
  const variant = config.hero
  const buttons = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <DSButton variant={config.button} primary>{c.ctaPrimary}<ArrowRight className="size-4" /></DSButton>
      <DSButton variant={config.button === 'outline' ? 'solid' : 'outline'}>{c.ctaSecondary}</DSButton>
    </div>
  )

  if (variant === 'split') {
    return (
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:grid-cols-2 md:py-24">
        <div>
          <Chip>{c.tagline}</Chip>
          <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{c.headline}</h1>
          <p className="mt-5 max-w-md text-base text-[var(--ds-fg)]/65">{c.subhead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <DSButton variant={config.button} primary>{c.ctaPrimary}<ArrowRight className="size-4" /></DSButton>
            <DSButton variant={config.button === 'outline' ? 'solid' : 'outline'}>{c.ctaSecondary}</DSButton>
          </div>
        </div>
        <div className={cardClass(config.card, 'relative aspect-[4/3] overflow-hidden')} style={cardStyle(config.card)}>
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--ds-accent)]/30 via-transparent to-[var(--ds-muted)]" />
          <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-card)]/80 p-4 backdrop-blur">
            <div className="flex items-center gap-3"><Zap className="size-5 text-[var(--ds-accent)]" /><div><div className="text-sm font-semibold">Fast by default</div><div className="text-xs text-[var(--ds-fg)]/60">Ships in milliseconds</div></div></div>
          </div>
        </div>
      </section>
    )
  }

  if (variant === 'gradient') {
    return (
      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-[var(--ds-border)] p-10 text-center" style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-accent) 18%, var(--ds-bg)), var(--ds-bg))' }}>
          <Chip><Sparkles className="size-3" />{c.tagline}</Chip>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">{c.headline}</h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-[var(--ds-fg)]/65">{c.subhead}</p>
          <div className="mt-9">{buttons}</div>
          <div className="mt-10 grid grid-cols-3 gap-4 text-center">
            {[['99.9%', 'uptime'], ['12k+', 'teams'], ['4.9/5', 'rating']].map(([a, b]) => (
              <div key={b}><div className="text-2xl font-bold text-[var(--ds-accent)]">{a}</div><div className="text-xs text-[var(--ds-fg)]/60">{b}</div></div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (variant === 'minimal' || variant === 'statement') {
    const big = variant === 'statement'
    return (
      <section className="mx-auto max-w-4xl px-6 py-20 md:py-28">
        <Chip><span className="size-2 rounded-full bg-emerald-500" />{c.tagline}</Chip>
        <h1 className={`mt-6 font-semibold leading-tight tracking-tight ${big ? 'text-5xl sm:text-7xl' : 'text-4xl sm:text-5xl'}`}>{c.headline}</h1>
        <p className="mt-5 max-w-xl text-lg text-[var(--ds-fg)]/65">{c.subhead}</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <DSButton variant={config.button} primary>{c.ctaPrimary}</DSButton>
          <DSButton variant="outline">{c.ctaSecondary}</DSButton>
        </div>
      </section>
    )
  }

  if (variant === 'promo') {
    return (
      <section className="px-6 py-14">
        <div className="mx-auto grid max-w-6xl items-center gap-8 overflow-hidden rounded-3xl bg-[var(--ds-accent)] px-8 py-12 text-[var(--ds-accent-fg)] md:grid-cols-2">
          <div>
            <Chip><Zap className="size-3" />{c.tagline}</Chip>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight sm:text-5xl">{c.headline}</h1>
            <p className="mt-4 max-w-md text-sm opacity-90">{c.subhead}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[var(--ds-accent)]">{c.ctaPrimary}</span>
              <span className="rounded-full border border-white/50 px-5 py-2.5 text-sm font-semibold">{c.ctaSecondary}</span>
            </div>
          </div>
          <div className="relative aspect-[4/3] rounded-2xl bg-white/10 backdrop-blur">
            <div className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-bold text-[var(--ds-accent)]">New</div>
            <div className="flex h-full items-center justify-center text-6xl">🧁</div>
          </div>
        </div>
      </section>
    )
  }

  if (variant === 'collection') {
    return (
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-center text-center">
          <Chip>{c.tagline}</Chip>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{c.headline}</h1>
          <p className="mt-4 max-w-xl text-sm text-[var(--ds-fg)]/65">{c.subhead}</p>
          <div className="mt-7">{buttons}</div>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          {['Breads', 'Pastries', 'Cakes', 'Coffee'].map((t) => (
            <div key={t} className={cardClass(config.card, 'flex aspect-square flex-col items-center justify-center gap-2')} style={cardStyle(config.card)}>
              <Coffee className="size-6 text-[var(--ds-accent)]" /><span className="text-sm font-medium">{t}</span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (variant === 'feature') {
    return (
      <section className="border-b border-[var(--ds-border)] px-6 py-20 text-center md:py-28">
        <div className="mx-auto max-w-3xl">
          <Chip>{c.tagline}</Chip>
          <h1 className="mt-6 font-serif text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">{c.headline}</h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-[var(--ds-fg)]/65">{c.subhead}</p>
          <div className="mt-9">{buttons}</div>
        </div>
      </section>
    )
  }

  // centered
  return (
    <section className="mx-auto max-w-4xl px-6 py-20 text-center md:py-28">
      <Chip><Sparkles className="size-3" />{c.tagline}</Chip>
      <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">{c.headline}</h1>
      <p className="mx-auto mt-5 max-w-xl text-base text-[var(--ds-fg)]/65">{c.subhead}</p>
      <div className="mt-9">{buttons}</div>
      <div className={cardClass(config.card, 'mx-auto mt-12 aspect-[16/7] max-w-3xl')} style={cardStyle(config.card)}>
        <div className="h-full w-full rounded-[inherit] bg-gradient-to-tr from-[var(--ds-accent)]/25 via-transparent to-[var(--ds-muted)]" />
      </div>
    </section>
  )
}

function Features({ config, variant }: { config: DesignConfig; variant: string }) {
  const items = [
    { icon: Zap, title: 'Fast', body: 'Optimised for speed on every device.' },
    { icon: Shield, title: 'Secure', body: 'Sensible defaults and safe permissions.' },
    { icon: Leaf, title: 'Sustainable', body: 'Lightweight pages, less energy.' },
  ]
  if (variant === 'split') {
    return (
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className={cardClass(config.card, 'aspect-[4/3]')} style={cardStyle(config.card)} />
          <div>
            <SectionHeading eyebrow="Why us" title="Built for real work" sub="Every detail tuned for performance and clarity." />
            <ul className="mx-auto mt-8 max-w-md space-y-4">
              {items.map((it) => (
                <li key={it.title} className="flex gap-3"><Check className="mt-0.5 size-5 text-[var(--ds-accent)]" /><div><div className="font-medium">{it.title}</div><div className="text-sm text-[var(--ds-fg)]/60">{it.body}</div></div></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <SectionHeading eyebrow="Features" title="Everything you need" sub="A focused set of capabilities, nothing you don't." />
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className={cardClass(config.card, 'p-6')} style={cardStyle(config.card)}>
            <it.icon className="size-6 text-[var(--ds-accent)]" />
            <h3 className="mt-4 font-semibold">{it.title}</h3>
            <p className="mt-1 text-sm text-[var(--ds-fg)]/60">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Services({ config, variant }: { config: DesignConfig; variant: string }) {
  const items = ['Strategy & research', 'Design systems', 'Build & launch']
  if (variant === 'list') {
    return (
      <section className="mx-auto max-w-4xl px-6 py-16">
        <SectionHeading eyebrow="Services" title="What we do" />
        <ol className="mt-10 divide-y divide-[var(--ds-border)]">
          {items.map((s, i) => (
            <li key={s} className="flex items-baseline gap-4 py-5"><span className="font-serif text-2xl text-[var(--ds-accent)]">0{i + 1}</span><span className="text-lg">{s}</span></li>
          ))}
        </ol>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <SectionHeading eyebrow="Services" title="What we do" />
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {items.map((s) => (
          <div key={s} className={cardClass(config.card, 'p-6')} style={cardStyle(config.card)}>
            <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--ds-accent)]/10 text-[var(--ds-accent)]"><Sparkles className="size-5" /></div>
            <h3 className="mt-4 font-semibold">{s}</h3>
            <p className="mt-1 text-sm text-[var(--ds-fg)]/60">End-to-end support from kickoff to launch.</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Gallery({ config, variant }: { config: DesignConfig; variant: string }) {
  const tiles = ['Aurora', 'Meridian', 'Lumen', 'Basalt', 'Cobalt', 'Vellum']
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <SectionHeading eyebrow="Selected work" title="Recent projects" />
      <div className={variant === 'masonry' ? 'mt-10 columns-2 gap-4 md:columns-3 [&>*]:mb-4' : 'mt-10 grid grid-cols-2 gap-4 md:grid-cols-3'}>
        {tiles.map((t, i) => (
          <div key={t} className={cardClass(config.card, `${variant === 'masonry' ? (i % 2 ? 'h-56' : 'h-40') : 'aspect-[4/3]'} overflow-hidden`)} style={cardStyle(config.card)}>
            <div className="flex h-full flex-col justify-end bg-gradient-to-t from-[var(--ds-accent)]/25 to-transparent p-4"><span className="font-medium">{t}</span></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Products({ config, variant }: { config: DesignConfig; variant: string }) {
  const products = [
    { name: 'Sourdough loaf', price: 6, rating: 5, cat: 'Bread', emoji: '🍞', tone: 'from-amber-200/60' },
    { name: 'Butter croissant', price: 4, rating: 5, cat: 'Pastry', emoji: '🥐', tone: 'from-orange-200/60' },
    { name: 'Berry tart', price: 7, rating: 4, cat: 'Cake', emoji: '🍰', tone: 'from-rose-200/60' },
    { name: 'House blend', price: 9, rating: 5, cat: 'Coffee', emoji: '☕', tone: 'from-stone-300/60' },
  ]
  const card = (p: (typeof products)[number]) => (
    <div key={p.name} className={cardClass(config.card, 'overflow-hidden')} style={cardStyle(config.card)}>
      <div className={`relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br ${p.tone} to-transparent text-5xl`}>
        <span>{p.emoji}</span>
        <span className="absolute left-3 top-3 rounded-full bg-[var(--ds-card)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">New</span>
        <button type="button" className="absolute right-3 top-3 rounded-full bg-[var(--ds-card)] p-1.5" aria-label="Wishlist"><Heart className="size-3.5" /></button>
      </div>
      <div className="p-4">
        <div className="text-xs uppercase tracking-wide text-[var(--ds-fg)]/50">{p.cat}</div>
        <div className="mt-1 font-medium">{p.name}</div>
        <div className="mt-1 flex items-center gap-1 text-orange-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`size-3.5 ${i < p.rating ? 'fill-orange-400' : 'fill-[var(--ds-muted)]'}`} />)}</div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-semibold">${p.price}</span>
          <DSButton variant={config.button}>Add</DSButton>
        </div>
      </div>
    </div>
  )
  if (variant === 'featured') {
    return (
      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionHeading eyebrow="Shop" title="Featured this week" />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className={cardClass(config.card, 'flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[var(--ds-accent)]/15 to-transparent p-10 text-center')} style={cardStyle(config.card)}>
            <span className="text-6xl">🥐</span><div className="text-xl font-semibold">Baker&apos;s dozen box</div><div className="text-sm text-[var(--ds-fg)]/60">Twelve pastries, one price.</div>
            <DSButton variant={config.button}>Add to cart</DSButton>
          </div>
          <div className="grid grid-cols-2 gap-5">{products.slice(0, 2).map(card)}</div>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 md:grid-cols-4">{products.slice(2).map(card)}{products.slice(0, 2).map(card)}</div>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <SectionHeading eyebrow="Shop" title="Popular products" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 md:grid-cols-4">{products.map(card)}</div>
    </section>
  )
}

function Testimonials({ config, variant }: { config: DesignConfig; variant: string }) {
  const quotes = [
    { q: 'The cleanest rebuild we have ever shipped.', n: 'Priya S.', r: 'Head of Product' },
    { q: 'Weeks of work done in an afternoon.', n: 'Marco L.', r: 'Founder' },
    { q: 'Accessible, fast and beautiful.', n: 'Dana R.', r: 'Design Lead' },
  ]
  if (variant === 'single') {
    return (
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="font-serif text-2xl leading-relaxed sm:text-3xl">“{quotes[0].q}”</p>
        <div className="mt-6 text-sm text-[var(--ds-fg)]/60">— {quotes[0].n}, {quotes[0].r}</div>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <SectionHeading eyebrow="Testimonials" title="Loved by teams" />
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {quotes.map((t) => (
          <div key={t.n} className={cardClass(config.card, 'p-6')} style={cardStyle(config.card)}>
            <div className="flex gap-0.5 text-orange-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-4 fill-orange-400" />)}</div>
            <p className="mt-4 text-sm">“{t.q}”</p>
            <div className="mt-4 text-xs text-[var(--ds-fg)]/60">{t.n} · {t.r}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Pricing({ config, variant }: { config: DesignConfig; variant: string }) {
  const tiers = variant === 'simple'
    ? [['Starter', '$0'], ['Pro', '$29']]
    : [['Starter', '$0'], ['Growth', '$29'], ['Scale', '$99']]
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <SectionHeading eyebrow="Pricing" title="Simple, honest pricing" />
      <div className={`mt-10 grid gap-5 ${tiers.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {tiers.map(([name, price], i) => (
          <div key={name} className={cardClass(config.card, `p-6 ${i === 1 ? 'ring-2 ring-[var(--ds-accent)]' : ''}`)} style={cardStyle(config.card)}>
            <div className="text-sm font-semibold uppercase tracking-wide text-[var(--ds-fg)]/60">{name}</div>
            <div className="mt-3 text-3xl font-bold">{price}<span className="text-sm font-normal text-[var(--ds-fg)]/50">/mo</span></div>
            <ul className="mt-5 space-y-2 text-sm text-[var(--ds-fg)]/70">
              {['Unlimited projects', 'Priority support', 'Custom domain'].map((f) => <li key={f} className="flex gap-2"><Check className="size-4 text-[var(--ds-accent)]" />{f}</li>)}
            </ul>
            <div className="mt-6"><DSButton variant={config.button} primary={i === 1}>Choose {name}</DSButton></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Faq({ config, variant }: { config: DesignConfig; variant: string }) {
  const qs = [
    ['Can I change everything?', 'Yes — every section and variant is validated against the catalog.'],
    ['Does it use my local model?', 'Yes, the Design Studio runs on the existing local provider.'],
    ['Is it safe?', 'Apply runs through the real Sessions pipeline with approval gates and a file-scope lock.'],
  ]
  const [open, setOpen] = useState(0)
  if (variant === 'list') {
    return (
      <section className="mx-auto max-w-3xl px-6 py-16">
        <SectionHeading eyebrow="FAQ" title="Questions" />
        <div className="mt-8 space-y-5">{qs.map(([q, a]) => (<div key={q}><div className="font-medium">{q}</div><p className="mt-1 text-sm text-[var(--ds-fg)]/60">{a}</p></div>))}</div>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <SectionHeading eyebrow="FAQ" title="Questions" />
      <div className="mt-8 space-y-3">
        {qs.map(([q, a], i) => (
          <div key={q} className={cardClass(config.card, 'overflow-hidden')} style={cardStyle(config.card)}>
            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium">
              {q}<ChevronDown className={`size-4 transition-transform ${open === i ? 'rotate-180' : ''}`} />
            </button>
            {open === i ? <p className="border-t border-[var(--ds-border)] px-5 py-4 text-sm text-[var(--ds-fg)]/65">{a}</p> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function Newsletter({ config, variant }: { config: DesignConfig; variant: string }) {
  if (variant === 'banner') {
    return (
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-2xl bg-[var(--ds-accent)] px-8 py-10 text-center text-[var(--ds-accent-fg)]">
          <h2 className="text-2xl font-bold">Get 10% off your first order</h2>
          <p className="mt-2 text-sm opacity-90">Fresh drops and seasonal specials, straight to your inbox.</p>
          <div className="mx-auto mt-6 flex max-w-md gap-2">
            <input placeholder="you@example.com" className="min-w-0 flex-1 rounded-md bg-white/95 px-3 py-2 text-sm text-black" />
            <span className="rounded-md bg-black/80 px-4 py-2 text-sm font-medium">Subscribe</span>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-3xl px-6 py-16 text-center">
      <SectionHeading eyebrow="Newsletter" title="Stay in the loop" sub="One email a month. No spam." />
      <div className="mx-auto mt-6 flex max-w-md gap-2">
        <input placeholder="you@example.com" className="min-w-0 flex-1 rounded-md border border-[var(--ds-border)] bg-[var(--ds-card)] px-3 py-2 text-sm" />
        <DSButton variant={config.button}>Subscribe</DSButton>
      </div>
    </section>
  )
}

function Contact({ config, variant }: { config: DesignConfig; variant: string }) {
  const form = (
    <div className={cardClass(config.card, 'space-y-3 p-6')} style={cardStyle(config.card)}>
      <input placeholder="Your name" className="w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] px-3 py-2 text-sm" />
      <input placeholder="Email" className="w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] px-3 py-2 text-sm" />
      <textarea placeholder="Message" rows={3} className="w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] px-3 py-2 text-sm" />
      <DSButton variant={config.button}>Send message</DSButton>
    </div>
  )
  if (variant === 'split') {
    return (
      <section className="mx-auto grid max-w-5xl gap-10 px-6 py-16 md:grid-cols-2">
        <div>
          <SectionHeading eyebrow="Contact" title="Let's talk" />
          <div className="mt-6 space-y-3 text-sm text-[var(--ds-fg)]/70">
            <div className="flex items-center gap-2"><Mail className="size-4 text-[var(--ds-accent)]" />{config.content.contactEmail}</div>
            <div className="flex items-center gap-2"><MapPin className="size-4 text-[var(--ds-accent)]" />123 Example Street</div>
          </div>
        </div>
        {form}
      </section>
    )
  }
  return (
    <section className="mx-auto max-w-xl px-6 py-16">
      <SectionHeading eyebrow="Contact" title="Send us a message" />
      <div className="mt-8">{form}</div>
    </section>
  )
}

function Footer({ config, variant }: { config: DesignConfig; variant: string }) {
  if (variant === 'simple') {
    return (
      <footer className="border-t border-[var(--ds-border)] px-6 py-8 text-center text-sm text-[var(--ds-fg)]/60">
        © {new Date().getFullYear()} {config.content.brand}. All rights reserved.
      </footer>
    )
  }
  return (
    <footer className="border-t border-[var(--ds-border)] bg-[var(--ds-muted)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-4">
        <div>
          <div className="text-lg font-bold">{config.content.brand}</div>
          <p className="mt-2 text-sm text-[var(--ds-fg)]/60">{config.content.tagline}</p>
        </div>
        {[['Product', ['Features', 'Pricing', 'Docs']], ['Company', ['About', 'Careers', 'Blog']], ['Support', ['Help', 'Contact', 'Status']]].map(([h, items]) => (
          <div key={h as string}><div className="text-sm font-semibold">{h as string}</div><ul className="mt-3 space-y-2 text-sm text-[var(--ds-fg)]/60">{(items as string[]).map((i) => <li key={i}>{i}</li>)}</ul></div>
        ))}
      </div>
      <div className="border-t border-[var(--ds-border)] px-6 py-4 text-center text-xs text-[var(--ds-fg)]/50">
        © {new Date().getFullYear()} {config.content.brand}. Built with the AgentHub Design Studio.
      </div>
    </footer>
  )
}

function renderSection(kind: SectionKind, config: DesignConfig, variant: string) {
  switch (kind) {
    case 'features': return <Features config={config} variant={variant} />
    case 'services': return <Services config={config} variant={variant} />
    case 'gallery': return <Gallery config={config} variant={variant} />
    case 'products': return <Products config={config} variant={variant} />
    case 'testimonials': return <Testimonials config={config} variant={variant} />
    case 'pricing': return <Pricing config={config} variant={variant} />
    case 'faq': return <Faq config={config} variant={variant} />
    case 'newsletter': return <Newsletter config={config} variant={variant} />
    case 'contact': return <Contact config={config} variant={variant} />
    case 'footer': return <Footer config={config} variant={variant} />
    default: return null
  }
}

export function SiteRenderer({
  config,
  onToggleTheme,
  className = '',
}: {
  config: DesignConfig
  /** When provided, the navbar theme button calls this instead of mutating config. */
  onToggleTheme?: () => void
  className?: string
}) {
  const vars = useMemo(() => {
    const palette = paletteCssVars(config.theme, config.palette, config.accent)
    const stack = TYPOGRAPHY.find((t) => t.id === config.typography)?.stack ?? TYPOGRAPHY[0].stack
    return { ...palette, '--ds-font': stack } as React.CSSProperties
  }, [config.theme, config.palette, config.accent, config.typography])

  const toggle = onToggleTheme ?? (() => {})

  return (
    <div className={`${BASE} min-h-screen ${className}`} style={{ ...vars, fontFamily: 'var(--ds-font)' }}>
      <Navbar config={config} onToggleTheme={toggle} />
      <Hero config={config} />
      {config.sections.map((s) => (
        <div key={s.id} data-section={s.kind}>
          {renderSection(s.kind, config, s.variant)}
        </div>
      ))}
      <Footer config={config} variant={config.footer} />
    </div>
  )
}

/** A fixed-size, non-interactive thumbnail that renders the REAL template. */
export function TemplateThumbnail({ config, height = 190 }: { config: DesignConfig; height?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[var(--ds-bg)]" style={{ height }}>
      <div className="pointer-events-none origin-top-left scale-[0.32]" style={{ width: '312%' }}>
        <SiteRenderer config={config} />
      </div>
    </div>
  )
}

export function paletteSwatch(id: Parameters<typeof getPalette>[0]): string[] {
  return getPalette(id).swatch
}

export function templateNameFrom(id: Parameters<typeof getTemplate>[0]): string {
  return getTemplate(id).name
}
