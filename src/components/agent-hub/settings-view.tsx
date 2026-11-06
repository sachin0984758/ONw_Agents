'use client'

import { useState } from 'react'
import { Info, ShieldAlert } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AgentOptimization } from './agent-optimization'

const PACKAGE_MANAGER_DOMAINS = [
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'proxy.golang.org',
  'repo.maven.apache.org',
  'rubygems.org',
  'deb.debian.org',
]

export function SettingsView() {
  const settings = useHub((s) => s.state.settings)
  const toggleSetting = useHub((s) => s.toggleSetting)
  const setAllowlistMode = useHub((s) => s.setAllowlistMode)
  const addDomain = useHub((s) => s.addDomain)
  const removeDomain = useHub((s) => s.removeDomain)
  const [addingDomain, setAddingDomain] = useState(false)
  const [domainDraft, setDomainDraft] = useState('')

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AgentOptimization />
      <div>
        <h1 className="text-lg font-semibold">Capabilities</h1>
        <p className="text-xs text-muted-foreground">
          Control what your AI agent is allowed to do — code execution, file creation and network access.
        </p>
      </div>

      {/* code execution */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Code execution and file creation</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The agent can execute code and create or edit docs, spreadsheets, presentations, PDFs, and data
              reports. Required for skills.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Enforced: when off, Agent Session refuses to run commands or create/edit/delete files.
            </p>
          </div>
          <Switch checked={settings.codeExecution} onCheckedChange={() => toggleSetting('codeExecution')} />
        </div>
      </div>

      {/* network */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              Allow network egress
              <ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Give the agent network access to install packages and libraries for advanced data analysis,
              custom visualizations, and specialized file processing. Monitor closely — this comes with
              security risks.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              Recorded preference only — not enforced yet. There is no OS-level sandbox, so commands run with this
              machine&apos;s own network access.
            </p>
          </div>
          <Switch
            checked={settings.networkEgress}
            onCheckedChange={() => toggleSetting('networkEgress')}
            disabled={!settings.codeExecution}
          />
        </div>

        <div className={settings.networkEgress ? 'mt-4 space-y-3' : 'mt-4 space-y-3 opacity-50 pointer-events-none'}>
          <div className="rounded-lg border bg-secondary/40 p-3.5">
            <div className="text-xs font-medium">Domain allowlist</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Which domains the agent may reach (recorded preference — not enforced yet)
            </div>
            <Select value={settings.allowlistMode} onValueChange={(v) => setAllowlistMode(v as typeof settings.allowlistMode)}>
              <SelectTrigger className="mt-2 h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="package-managers">Package managers only</SelectItem>
                <SelectItem value="all">All domains (unrestricted)</SelectItem>
                <SelectItem value="custom">Custom allowlist</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border bg-secondary/30 p-3.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p>The agent can access common package managers plus any additional domains you specify below.</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-primary underline underline-offset-2">
                  View package manager domains
                </summary>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-mono text-[10px]">
                  {PACKAGE_MANAGER_DOMAINS.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium">Additional allowed domains</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {settings.additionalDomains.map((d) => (
                <Badge key={d} variant="outline" className="gap-1 font-mono text-[10px]">
                  {d}
                  <button
                    type="button"
                    title={`Remove ${d}`}
                    aria-label={`Remove ${d}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeDomain(d)}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {addingDomain ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const d = domainDraft.trim().toLowerCase()
                    if (!d) return
                    addDomain(d)
                    setDomainDraft('')
                    setAddingDomain(false)
                  }}
                >
                  <input
                    autoFocus
                    value={domainDraft}
                    onChange={(e) => setDomainDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setAddingDomain(false)
                        setDomainDraft('')
                      }
                    }}
                    placeholder="api.example.com"
                    className="h-6 w-36 rounded-md border border-input bg-secondary/50 px-2 font-mono text-[10px] outline-none placeholder:text-muted-foreground focus:border-ring"
                  />
                  <button type="submit" className="rounded-full border px-2 py-0.5 text-[10px] hover:bg-secondary">
                    Add
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingDomain(true)}
                  className="rounded-full border border-dashed px-2.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  + add domain
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* integrations summary */}
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">Connected tools</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Surfaces from the modules in this hub — everything the agent can reach.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {['Git', 'Filesystem', 'Web search', 'Code graph', 'Models', 'Sessions', 'Workflows', 'Plans'].map(
            (t) => (
              <div
                key={t}
                className="flex items-center gap-2 rounded-md border bg-secondary/40 px-2.5 py-2 text-[11px]"
              >
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {t}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
