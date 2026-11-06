'use client'

import Image from 'next/image'

import { HubSelect, HubSelectItem } from './hub-select'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Bot,
  Boxes,
  Boxes as CapabilityIcon,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  Gauge,
  GitBranch,
  Heart,
  ImagePlus,
  LayoutDashboard,
  PanelsTopLeft,
  MessageCircle,
  MousePointer2,
  Plug,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import { useHub, flattenAgents } from '@/lib/agent-hub/store'
import { CONVERSATION_APPEARANCES, type ConversationAppearance } from './conversation-profile'
import { isViewId, resolveViewFromDeepLink } from '@/lib/agent-hub/view-url'
import type { ViewId } from '@/lib/agent-hub/types'
import { seedState } from '@/lib/agent-hub/seed'
import { useRuntimeModels } from '@/lib/agent-hub/use-runtime-models'
import { useLivePoll } from '@/lib/agent-hub/use-live-poll'
import { cn } from '@/lib/utils'
import { OverviewView } from './overview'
import { ChatView } from './chat-view'
import { AgentsView } from './agents-view'
import { SessionChatView } from './session-chat-view'
import { ModelsView } from './models-view'
import { TasksView } from './tasks-view'
import { ChangesView } from './changes-view'
import { SettingsView } from './settings-view'
import { AgentApiView } from './agent-api-view'
import { PlaygroundView } from './playground-view'
import { ThemeToggle } from './theme-toggle'
import { SidebarHoverMenu } from './sidebar-hover-menu'
import { AgentMascot } from './agent-mascot'
import { AutoComputerView } from './auto-computer-view'
import { UIComponentsView } from './ui-components-view'
import { CapabilitiesView } from './capabilities-view'
import conversationStyles from './conversation-profile.module.css'
import { ConversationAppearanceContext, ConversationColorScheme } from './conversation-color-scheme'

type LocalProfile = { displayName: string; profileImage?: string; conversationLayout: 'unified' | 'separate'; conversationAppearance: ConversationAppearance; showMascot: boolean }
const PROFILE_STORAGE_KEY = 'agenthub-local-profile-v1'
const DEFAULT_LOCAL_PROFILE: LocalProfile = { displayName: 'Sachin', conversationLayout: 'unified', conversationAppearance: 'day', showMascot: true }
const APPEARANCE_LABELS: Record<ConversationAppearance, string> = { day: 'Day · default', night: 'Night', 'warm-sand': '04 · Warm Sand', 'ocean-panels': '07 · Ocean Panels', 'bold-outline': '08 · Bold Outline' }

// Views that own their full viewport height (no page scrolling; inner panes
// scroll instead).
const FULL_HEIGHT_VIEWS: ViewId[] = ['chat', 'sessions', 'auto', 'playground', 'agents']

const NAV: Array<{ id: ViewId; label: string; icon: React.ElementType; group: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Monitor' },
  { id: 'chat', label: 'Chat', icon: MessageCircle, group: 'Monitor' },
  { id: 'agents', label: 'Agents', icon: Bot, group: 'Monitor' },
  { id: 'sessions', label: 'Sessions', icon: Activity, group: 'Monitor' },
  { id: 'auto', label: 'Auto', icon: MousePointer2, group: 'Monitor' },
  { id: 'tasks', label: 'Plan / Tasks', icon: Boxes, group: 'Build' },
  { id: 'changes', label: 'Changes', icon: GitBranch, group: 'Build' },
  { id: 'playground', label: 'Playground', icon: FlaskConical, group: 'Build' },
  { id: 'ui-components', label: 'UI Components', icon: PanelsTopLeft, group: 'Build' },
  { id: 'capabilities', label: 'Capabilities', icon: CapabilityIcon, group: 'Build' },
  { id: 'models', label: 'Models', icon: Braces, group: 'Resources' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'Resources' },
  { id: 'agent-api', label: 'Agent API', icon: Plug, group: 'Resources' },
]

const GROUPS = ['Monitor', 'Build', 'Resources']

export function Shell() {
  const storedView = useHub((s) => s.view)
  // A hot reload can retain an obsolete view id from the previous navigation list.
  const view = isViewId(storedView) ? storedView : 'overview'
  const setView = useHub((s) => s.setView)
  const state = useHub((s) => s.state)
  const syncStatus = useHub((s) => s.syncStatus)
  const resetState = useHub((s) => s.resetState)
  const selectAgent = useHub((s) => s.selectAgent)
  const selectSession = useHub((s) => s.selectSession)
  const [search, setSearch] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileAppearanceOpen, setProfileAppearanceOpen] = useState(false)
  const [profileHelpOpen, setProfileHelpOpen] = useState(false)
  const [profileImageError, setProfileImageError] = useState('')
  const profileImageInput = useRef<HTMLInputElement>(null)
  const [localProfile, setLocalProfile] = useState<LocalProfile>(DEFAULT_LOCAL_PROFILE)
  const profileName = localProfile.displayName
  // Guards the URL write until the initial deep link (?view=… / #…) has been
  // applied, so the first commit can never overwrite it with the default view.
  const urlSyncedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY)
      if (stored) {
        try {
          const saved = JSON.parse(stored) as Partial<LocalProfile>
          setLocalProfile({
            displayName: typeof saved.displayName === 'string' && saved.displayName.trim() ? saved.displayName.trim().slice(0, 40) : DEFAULT_LOCAL_PROFILE.displayName,
            profileImage: typeof saved.profileImage === 'string' && saved.profileImage.startsWith('data:image/') ? saved.profileImage : undefined,
            conversationLayout: saved.conversationLayout === 'separate' ? 'separate' : 'unified',
            conversationAppearance: CONVERSATION_APPEARANCES.includes(saved.conversationAppearance as ConversationAppearance) ? saved.conversationAppearance as ConversationAppearance : DEFAULT_LOCAL_PROFILE.conversationAppearance,
            showMascot: saved.showMascot !== false,
          })
        } catch { window.localStorage.removeItem(PROFILE_STORAGE_KEY) }
      } else {
        const savedName = window.localStorage.getItem('agenthub-profile-name')
        const profile = { ...DEFAULT_LOCAL_PROFILE, displayName: savedName?.trim().slice(0, 40) || DEFAULT_LOCAL_PROFILE.displayName }
        setLocalProfile(profile)
        window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
      }
    })
    return () => { cancelled = true }
  }, [])

  const updateLocalProfile = (updates: Partial<LocalProfile>) => {
    setLocalProfile((current) => {
      const next = { ...current, ...updates }
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next))
      window.localStorage.setItem('agenthub-profile-name', next.displayName)
      return next
    })
  }

  const saveProfileImage = async (file?: File) => {
    if (!file) return
    setProfileImageError('')
    if (!file.type.startsWith('image/')) {
      setProfileImageError('Choose an image file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setProfileImageError('Choose an image smaller than 10 MB.')
      return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not process this image.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      updateLocalProfile({ profileImage: canvas.toDataURL('image/jpeg', 0.84) })
    } catch {
      setProfileImageError('Could not save this image. Try a different photo.')
    }
  }

  const openProfileView = (target: ViewId) => {
    setView(target)
    setProfileOpen(false)
    setProfileAppearanceOpen(false)
    setProfileHelpOpen(false)
    setNavOpen(false)
  }

  // Sync view from URL search param or hash (?view=chat or #chat)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const urlView = resolveViewFromDeepLink(window.location.search, window.location.hash)
    if (urlView) setView(urlView)
    urlSyncedRef.current = true
  }, [setView])

  // Keep URL updated with active view so page reloads stay on the current view
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!urlSyncedRef.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('view') !== view) {
      url.searchParams.set('view', view)
      window.history.replaceState(null, '', url.toString())
    }
  }, [view])

  // Keyboard shortcuts (footer hint): press g, then 1–0 to jump to the first
  // ten views. Ignored while typing or with modifier keys held.
  useEffect(() => {
    let armed = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        armed = 0
        return
      }
      if (e.key === 'g' || e.key === 'G') {
        armed = Date.now()
        return
      }
      if (/^[0-9]$/.test(e.key) && armed !== 0 && Date.now() - armed < 1500) {
        armed = 0
        const target = NAV[e.key === '0' ? 9 : Number(e.key) - 1]
        if (target) setView(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  // Search covers what the shell can actually navigate to: views, agents and
  // tracked sessions (there is no file/task index to search yet).
  const q = search.trim().toLowerCase()
  const searchResults = q
    ? [
        ...NAV.filter((n) => n.label.toLowerCase().includes(q)).map((n) => ({
          key: `view-${n.id}`,
          kind: 'View',
          label: n.label,
          action: () => setView(n.id),
        })),
        ...flattenAgents(state.agents)
          .filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
          .slice(0, 5)
          .map((a) => ({
            key: `agent-${a.id}`,
            kind: 'Agent',
            label: a.name,
            action: () => {
              setView('agents')
              selectAgent(a.id)
            },
          })),
        ...state.sessions
          .filter((s) => s.name.toLowerCase().includes(q))
          .slice(0, 5)
          .map((s) => ({
            key: `session-${s.id}`,
            kind: 'Session',
            label: s.name,
            action: () => {
              setView('sessions')
              selectSession(s.id)
            },
          })),
      ].slice(0, 8)
    : []

  // Live runtime state — only models a provider confirms are loaded. Never the
  // seeded model list (that inventory belongs to the Models view, not here).
  const runtime = useRuntimeModels()
  const hydrateIfNewer = useHub((s) => s.hydrateIfNewer)

  // Saved configuration can change externally. Refresh only while visible;
  // token totals themselves arrive through the Overview usage event stream.
  const refreshState = useCallback(async (signal: AbortSignal) => {
    const response = await fetch('/api/agent', { cache: 'no-store', signal })
    const json = await response.json()
    if (!signal.aborted && json?.state) hydrateIfNewer(json.state as typeof seedState)
  }, [hydrateIfNewer])
  useLivePoll(refreshState, 10000)

  return (
    <div className={cn('flex bg-background text-foreground', FULL_HEIGHT_VIEWS.includes(view) ? 'h-screen overflow-hidden' : 'min-h-screen')}>
      {/* ── Sidebar ── */}
      <div className="hidden w-16 shrink-0 lg:block" aria-hidden="true" />
      <div className={cn('fixed inset-y-0 left-0 z-40 w-60 lg:w-16', navOpen ? 'block' : 'hidden lg:block')}>
      <aside className="absolute inset-0 flex flex-col border-r bg-sidebar">
        <div className="flex h-10 shrink-0 items-center px-3 lg:h-3">
          <div className="text-sm font-semibold lg:hidden">AgentHub</div>
        </div>

        <nav className="hub-scroll flex-1 overflow-y-auto px-2 pb-4">
          {GROUPS.map((g) => (
            <div key={g} className="mb-1">
              <div className={cn('px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70', 'lg:hidden')}>
                {g}
              </div>
              {NAV.filter((n) => n.group === g).map((n) => {
                const Icon = n.icon
                const active = view === n.id
                const button = (
                  <button
                    key={n.id}
                    onClick={() => {
                      setView(n.id)
                      setNavOpen(false)
                    }}
                    className={cn(
                      'mb-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors duration-150',
                      'lg:mx-auto lg:size-10 lg:justify-center lg:px-0 lg:py-0',
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                    aria-label={n.label}
                  >
                    <Icon className={cn('size-4 shrink-0', 'lg:size-5')} />
                    <span className={cn('lg:hidden')}>{n.label}</span>
                    {n.id === 'changes' && state.changes.files.filter((f) => !f.staged).length > 0 ? (
                      <span className={cn('ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300', 'lg:hidden')}>
                        {state.changes.files.filter((f) => !f.staged).length}
                      </span>
                    ) : null}
                  </button>
                )
                return <SidebarHoverMenu key={n.id} viewId={n.id} label={n.label}>{button}</SidebarHoverMenu>
              })}
            </div>
          ))}
        </nav>

        <div className={cn('relative border-t px-4 py-3', 'lg:px-2')}>
          <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', 'lg:justify-center')} data-testid="sidebar-runtime">
            <span
              className={cn(
                'size-2 rounded-full',
                runtime.loaded.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/40',
              )}
            />
            <span className={cn('lg:hidden')}>{runtime.loaded.length > 0
              ? `${runtime.loaded.length} model${runtime.loaded.length > 1 ? 's' : ''} running`
              : runtime.status === 'loading'
                ? 'Checking models…'
                : runtime.status === 'offline'
                  ? 'Provider offline'
                  : 'No model loaded'}</span>
          </div>
          <button
            onClick={resetState}
            title="Reset demo state"
            className={cn('mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground', 'lg:mx-auto lg:size-10 lg:justify-center')}
          >
            <RefreshCw className="size-3" /> <span className={cn('lg:hidden')}>Reset demo state</span>
          </button>
          {profileOpen ? (
            <div className="absolute bottom-full left-2 z-50 mb-2 max-h-[min(82vh,580px)] w-[min(300px,calc(100vw-1rem))] overflow-y-auto rounded-2xl border bg-popover p-2 text-popover-foreground shadow-2xl" role="dialog" aria-label="Local profile">
              <div className="flex items-start gap-3 rounded-xl px-2.5 py-2.5">
                {localProfile.profileImage ? <Image src={localProfile.profileImage} width={40} height={40} unoptimized alt="" className="size-10 shrink-0 rounded-full object-cover ring-1 ring-border/70" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-border/70" aria-hidden="true">{(profileName.trim()[0] || 'S').toUpperCase()}</span>}
                <div className="min-w-0 flex-1">
                  <label htmlFor="profile-display-name" className="sr-only">Display name</label>
                  <input id="profile-display-name" value={profileName} maxLength={40} onChange={(e) => updateLocalProfile({ displayName: e.target.value })} className="h-7 w-full truncate border-0 bg-transparent p-0 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span>Local profile</span><span aria-hidden="true">·</span><span>No account</span></div>
                </div>
                <button type="button" onClick={() => setProfileOpen(false)} aria-label="Close profile menu" className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" /></button>
              </div>

              <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl border bg-background/70 p-2">
                <input ref={profileImageInput} type="file" accept="image/*" className="sr-only" aria-label="Choose profile image" onChange={(event) => { void saveProfileImage(event.target.files?.[0]); event.currentTarget.value = '' }} />
                <button type="button" onClick={() => profileImageInput.current?.click()} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-secondary">
                  <ImagePlus className="size-4 shrink-0 text-muted-foreground" />
                  <span>{localProfile.profileImage ? 'Change profile photo' : 'Add profile photo'}</span>
                </button>
                {localProfile.profileImage ? <button type="button" onClick={() => updateLocalProfile({ profileImage: undefined })} className="rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground">Remove</button> : null}
                {profileImageError ? <span role="alert" className="basis-full text-[10px] text-red-600">{profileImageError}</span> : null}
              </div>

              <div className="my-1 border-t" />
              <button type="button" onClick={() => openProfileView('overview')} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-secondary">
                <Gauge className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium">Usage &amp; activity</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{state.tokenUsage.records.length} recorded model calls · view usage</span></span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <button type="button" role="switch" aria-checked={localProfile.showMascot} onClick={() => updateLocalProfile({ showMascot: !localProfile.showMascot })} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-secondary">
                <Heart className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium">Show Pet</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Toggle the draggable agent companion</span></span>
                <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', localProfile.showMascot ? 'bg-primary' : 'bg-muted')}><span className={cn('absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform', localProfile.showMascot ? 'translate-x-4' : 'translate-x-0.5')} /></span>
              </button>
              <button type="button" onClick={() => openProfileView('models')} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-secondary">
                <Boxes className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium">Manage local models</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Choose available model capacity</span></span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>

              <div className="my-1 border-t" />
              <button type="button" aria-expanded={profileAppearanceOpen} onClick={() => setProfileAppearanceOpen((open) => !open)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-secondary">
                <PanelsTopLeft className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium">Appearance</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{APPEARANCE_LABELS[localProfile.conversationAppearance]} · {localProfile.conversationLayout === 'unified' ? 'Unified layout' : 'Original layout'}</span></span>
                <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', profileAppearanceOpen && 'rotate-180')} />
              </button>
              {profileAppearanceOpen ? (
                <div className="mx-2 mb-2 space-y-2 rounded-xl border bg-background/70 p-2.5">
                  <label htmlFor="profile-conversation-appearance" className="block text-[10px] font-medium text-muted-foreground">Chat, Agents, Sessions + Auto theme</label>
                  <HubSelect ariaLabel="Conversation appearance" id="profile-conversation-appearance" value={localProfile.conversationAppearance} onValueChange={(nextValue) => updateLocalProfile({ conversationAppearance: nextValue as ConversationAppearance })} className="h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-ring">
                    <HubSelectItem value="day">Day · default</HubSelectItem><HubSelectItem value="night">Night</HubSelectItem><HubSelectItem value="warm-sand">04 · Warm Sand</HubSelectItem><HubSelectItem value="ocean-panels">07 · Ocean Panels</HubSelectItem><HubSelectItem value="bold-outline">08 · Bold Outline</HubSelectItem>
                  </HubSelect>
                  <label htmlFor="profile-conversation-layout" className="block text-[10px] font-medium text-muted-foreground">Conversation layout</label>
                  <HubSelect ariaLabel="Conversation layout" id="profile-conversation-layout" value={localProfile.conversationLayout} onValueChange={(nextValue) => updateLocalProfile({ conversationLayout: nextValue === 'separate' ? 'separate' : 'unified' })} className="h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-ring">
                    <HubSelectItem value="unified">Unified chat style</HubSelectItem><HubSelectItem value="separate">Original view styles</HubSelectItem>
                  </HubSelect>
                </div>
              ) : null}

              <button type="button" onClick={() => openProfileView('settings')} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-xs transition hover:bg-secondary"><SettingsIcon className="size-4 shrink-0 text-muted-foreground" />Settings<ChevronRight className="ml-auto size-4 text-muted-foreground" /></button>
              <button type="button" aria-expanded={profileHelpOpen} onClick={() => setProfileHelpOpen((open) => !open)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-xs transition hover:bg-secondary"><CircleHelp className="size-4 shrink-0 text-muted-foreground" />Help<ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', profileHelpOpen && 'rotate-180')} /></button>
              {profileHelpOpen ? (
                <div className="mx-2 mb-2 rounded-xl border bg-background/70 p-2">
                  <p className="px-1 pb-1.5 text-[10px] leading-4 text-muted-foreground">Choose a workspace to get started. Auto plans desktop tasks; Sessions works with a selected project; Models manages local providers.</p>
                  <div className="grid grid-cols-2 gap-1">
                    {([{ id: 'auto', label: 'Auto tasks' }, { id: 'chat', label: 'Chat' }, { id: 'sessions', label: 'Coding sessions' }, { id: 'models', label: 'Local models' }] as const).map((item) => <button key={item.id} type="button" onClick={() => openProfileView(item.id)} className="rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-secondary">{item.label}</button>)}
                  </div>
                </div>
              ) : null}
              <div className="my-1 border-t" />
              <p className="px-2.5 py-1 text-[10px] text-muted-foreground">Preferences are saved in this browser.</p>
            </div>
          ) : null}
          <button type="button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen} aria-label={`Open ${profileName || 'Local user'} profile`} title="Local profile" className={cn('mt-3 flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs hover:bg-secondary', 'lg:justify-center')}>
            {localProfile.profileImage ? <Image src={localProfile.profileImage} width={32} height={32} unoptimized alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border/60" /> : <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-border/60">{(profileName.trim()[0] || 'S').toUpperCase()}</span>}
            <span className={cn('min-w-0 truncate', 'lg:hidden')}>{profileName || 'Local user'}</span>
          </button>
        </div>
      </aside>
      </div>

      {navOpen ? (
        <button
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
        />
      ) : null}

      {/* ── Main column ── */}
      <div className={cn('flex min-w-0 flex-1 flex-col lg:pl-0', FULL_HEIGHT_VIEWS.includes(view) ? 'h-screen min-h-0 overflow-hidden' : 'min-h-screen')}>
          <button
            className="fixed left-3 top-3 z-20 rounded-lg border bg-background p-2 shadow-sm lg:hidden"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <LayoutDashboard className="size-5" />
          </button>

        {/* View */}
        <ConversationAppearanceContext.Provider value={localProfile.conversationAppearance}>
        <ConversationColorScheme.Provider value={['night', 'ocean-panels'].includes(localProfile.conversationAppearance) ? 'dark' : 'light'}>
        <main
          className={cn(
            conversationStyles.theme,
            localProfile.conversationLayout === 'unified' && conversationStyles.unified,
            view === 'auto' || view === 'agents'
              ? 'hub-scroll flex min-h-0 flex-1 flex-col overflow-hidden p-0'
              : 'hub-scroll p-4 pt-16 md:p-6 md:pt-16 lg:pt-6',
            FULL_HEIGHT_VIEWS.includes(view)
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : 'flex-1 overflow-x-hidden'
          )}
          data-conversation-theme={localProfile.conversationAppearance}
        >
          {view === 'overview' && <OverviewView />}
          {view === 'chat' && <ChatView conversationLayout={localProfile.conversationLayout} profileImage={localProfile.profileImage} />}
          {view === 'auto' && <AutoComputerView conversationLayout={localProfile.conversationLayout} />}
          {view === 'agents' && <AgentsView />}
          {view === 'sessions' && <SessionChatView conversationLayout={localProfile.conversationLayout} conversationAppearance={localProfile.conversationAppearance} />}
          {view === 'models' && <ModelsView />}
          {view === 'tasks' && <TasksView />}
          {view === 'changes' && <ChangesView />}
          {view === 'playground' && <PlaygroundView />}
          {view === 'ui-components' && <UIComponentsView />}
          {view === 'capabilities' && <CapabilitiesView />}
          {view === 'settings' ? (
            <>
              <section aria-label="Workspace preferences" className="mx-auto mb-5 flex w-full max-w-2xl flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
                <div className="flex w-full items-center gap-2 text-sm">
                  <span className="font-medium">{state.projectName}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground capitalize">Workspace preferences</span>
                </div>
                <div className="relative w-full">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setSearch('')
                    }}
                    placeholder="Search views, agents, sessions…"
                    aria-label="Search views, agents, and sessions"
                    className="h-8 w-full rounded-md border border-input bg-secondary/50 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                  />
                  {q ? (
                    <div className="hub-scroll absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-md" data-testid="global-search-menu">
                      {searchResults.length > 0 ? (
                        searchResults.map((r) => (
                          <button
                            key={r.key}
                            onClick={() => {
                              r.action()
                              setSearch('')
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
                          >
                            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {r.kind}
                            </span>
                            <span className="truncate">{r.label}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-2.5 py-2 text-xs text-muted-foreground">No matches</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                    syncStatus === 'saved'
                      ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : syncStatus === 'error'
                        ? 'border-red-500/30 text-red-500 dark:text-red-400'
                        : 'border-border text-muted-foreground'
                  )}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  {syncStatus === 'saved' ? 'State synced' : syncStatus === 'error' ? 'Sync failed' : 'API ready'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Appearance</span>
                  <ThemeToggle />
                </div>
              </section>

              <SettingsView />
            </>
          ) : null}
          {view === 'agent-api' && <AgentApiView />}
        </main>
        </ConversationColorScheme.Provider>
        </ConversationAppearanceContext.Provider>

        {localProfile.showMascot ? <AgentMascot /> : null}

      </div>
    </div>
  )
}
