'use client'

// ── HubSelect ────────────────────────────────────────────────────────────────
// One shared, portal-based select for the whole application.
//
// Why this exists: every AgentHub view previously used a raw native <select>.
// Native selects hand their popup to the operating system, so the list has no
// maximum height, no viewport collision handling and no internal scrolling — a
// long option list (e.g. the Playground model selector) simply covers the
// working area underneath it. This wrapper is built on @radix-ui/react-select,
// which renders the popup in a portal (never clipped by an ancestor's
// `overflow-hidden`), flips/shifts it to stay inside the viewport
// (`avoidCollisions` + `collisionPadding`), caps its height to the space that
// is actually available and scrolls internally when the list is long.
//
// Radix forbids an empty string as an item value, but several AgentHub
// selectors use '' to mean "Auto" / "None" / "Default". We translate '' to a
// private sentinel in each direction so call sites keep their natural
// empty-value semantics.

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConversationAppearanceContext } from './conversation-color-scheme'
import conversationStyles from './conversation-profile.module.css'

const EMPTY_VALUE = '__hub_select_empty__'
const toRadix = (value: string) => (value === '' ? EMPTY_VALUE : value)
const fromRadix = (value: string) => (value === EMPTY_VALUE ? '' : value)

// Radix only renders its own placeholder when the Root value is ''/undefined —
// but we map '' to a sentinel, and some callers use '' to mean "nothing
// selected" (no matching item exists). So we look the current value up in the
// rendered items ourselves and fall back to the placeholder when there is no
// match. Both "'' is a real option" (Auto / Default) and "'' is no selection"
// (Reassign to…) therefore behave correctly.
function collectLabels(children: React.ReactNode, out: Map<string, React.ReactNode>) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: unknown; children?: React.ReactNode }
    if (child.type === HubSelectItem && props.value !== undefined) {
      out.set(toRadix(String(props.value)), props.children)
      return
    }
    if (props.children !== undefined) collectLabels(props.children, out)
  })
}

export type HubSelectSize = 'xs' | 'sm' | 'default'

const TRIGGER_SIZE: Record<HubSelectSize, string> = {
  xs: 'h-6 gap-1 rounded px-1.5 text-[10px]',
  sm: 'h-7 gap-1 rounded-md px-2 text-[11px]',
  default: 'h-8 gap-1.5 rounded-md px-2 text-xs',
}

export interface HubSelectProps {
  /** Current value. '' is allowed and means "none / auto / default". */
  value?: string
  onValueChange?: (value: string) => void
  /** Shown when no item matches the value. */
  placeholder?: string
  /** Accessible name (maps to aria-label on the trigger). */
  ariaLabel?: string
  id?: string
  title?: string
  disabled?: boolean
  size?: HubSelectSize
  /** Extra classes for the trigger. Use to set width / max-width. */
  className?: string
  /** Extra classes for the floated content panel. */
  contentClassName?: string
  /** Apply a local conversation palette to portal content, which renders outside its theme wrapper. */
  contentTheme?: string
  'data-testid'?: string
  children?: React.ReactNode
}

export function HubSelect({
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  id,
  title,
  disabled,
  size = 'default',
  className,
  contentClassName,
  contentTheme,
  children,
  ...rest
}: HubSelectProps) {
  const inheritedTheme = React.useContext(ConversationAppearanceContext)
  const popupTheme = contentTheme ?? inheritedTheme
  const labels = new Map<string, React.ReactNode>()
  collectLabels(children, labels)
  const selected = value === undefined ? undefined : labels.get(toRadix(value))

  return (
    <SelectPrimitive.Root
      value={value === undefined ? undefined : toRadix(value)}
      onValueChange={onValueChange ? (next) => onValueChange(fromRadix(next)) : undefined}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        title={title}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          'flex max-w-full min-w-0 items-center justify-between border border-input bg-secondary/50 font-medium text-foreground shadow-xs outline-none transition-colors',
          'hover:bg-secondary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          TRIGGER_SIZE[size],
          className,
        )}
        {...rest}
      >
        <span className="min-w-0 flex-1 truncate text-left" data-slot="hub-select-value">
          {selected !== undefined ? (
            selected
          ) : (
            <span className="text-muted-foreground">{placeholder ?? 'Select…'}</span>
          )}
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          data-conversation-theme={popupTheme}
          position="popper"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          className={cn(
            popupTheme && conversationStyles.theme,
            'hub-scroll z-50 overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg',
            // Never taller than the space actually available in the viewport.
            'max-h-[min(18rem,var(--radix-select-content-available-height))]',
            // At least as wide as the trigger; grows for long labels; clamped
            // so it can never spill past the viewport edges.
            'w-max min-w-[var(--radix-select-trigger-width)] max-w-[min(30rem,calc(100vw-1.5rem))]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export function HubSelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group className={cn('py-0.5', className)} {...props} />
}

export function HubSelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function HubSelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

export function HubSelectItem({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      value={toRadix(value ?? '')}
      className={cn(
        'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-7 text-xs outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
        <Check className="size-3.5 text-primary" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="min-w-0 truncate">{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}
