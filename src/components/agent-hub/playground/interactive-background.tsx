'use client'

import { useRef, type ReactNode } from 'react'

/** Decorative perspective grid; normal mode has no animation or grid layer. */
export function InteractiveBackground({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const grid = useRef<HTMLDivElement>(null)
  return (
    <div
      className="relative isolate h-full min-h-0"
      onPointerMove={(event) => {
        if (!enabled || !grid.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const bounds = event.currentTarget.getBoundingClientRect()
        const x = (event.clientX - bounds.left) / bounds.width - 0.5
        const y = (event.clientY - bounds.top) / bounds.height - 0.5
        grid.current.style.transform = `perspective(900px) rotateX(${y * -8}deg) rotateY(${x * 8}deg) translate(${x * 12}px, ${y * 12}px)`
      }}
      onPointerLeave={() => { if (grid.current) grid.current.style.transform = '' }}
    >
      {enabled && (
        <div aria-hidden="true" className="pointer-events-none absolute -inset-3 -z-10 overflow-hidden rounded-2xl bg-secondary/30">
          <div ref={grid} className="absolute -inset-10 text-foreground/15 transition-transform duration-200 ease-out motion-reduce:transform-none" style={{ transformStyle: 'preserve-3d' }}>
            <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px), radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '64px 64px, 64px 64px, 16px 16px' }} />
            <div className="absolute inset-x-0 bottom-0 h-1/2 origin-bottom" style={{ backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)', backgroundSize: '48px 48px', transform: 'perspective(350px) rotateX(55deg) scale(1.8)' }} />
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
