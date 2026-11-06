'use client'

import { useState, useEffect } from 'react'
import { Download, Play, RefreshCw, Trash2, Plus, Plug } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { Button } from '@/components/ui/button'
import { Metric } from './shared'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { LOCAL_PROVIDERS } from '@/lib/agent-hub/chat-settings'

export function ModelsView() {
  const state = useHub((s) => s.state)
  const deleteCustomModel = useHub((s) => s.deleteCustomModel)
  const addCustomModel = useHub((s) => s.addCustomModel)
  const [url, setUrl] = useState('')
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [newModel, setNewModel] = useState({ name: '', endpoint: '', apiKey: '', modelId: '' })
  const [addError, setAddError] = useState('')
  const [localProviders, setLocalProviders] = useState<{ id: string; name: string; available: boolean; models: string[] }[]>([])
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [, setRefreshing] = useState(false)

  // Only models actually reported by a running local provider count as
  // "detected". Nothing here is seeded or invented — an offline provider
  // contributes nothing.
  const detected: Array<{ providerId: string; providerName: string; modelId: string }> = localProviders
    .filter((p) => p.available)
    .flatMap((p) => (p.models ?? []).map((modelId) => ({ providerId: p.id, providerName: p.name, modelId })))

  // API models are only surfaced when a key is actually configured for them.
  const keyedApiModels = state.customModels.filter((cm) => cm.hasApiKey)
  const keylessCount = state.customModels.length - keyedApiModels.length

  // check local provider availability + list their models
  // Probes go through the server route: browsers cannot fetch
  // http://localhost:1234 / :11434 directly unless the runtime happens to send
  // CORS headers (LM Studio/Ollama don't by default), so a client-side probe
  // reported every running runtime as offline. /api/agent-session/models does
  // the same probe server-side with a 2s timeout per provider.
  const check = async () => {
    setRefreshing(true)
    try {
      let results: { id: string; name: string; available: boolean; models: string[] }[] = []
      const modelMap: Record<string, string[]> = {}
      try {
        const res = await fetch('/api/agent-session/models')
        const json = res.ok ? await res.json().catch(() => null) : null
        const locals = Array.isArray(json?.local)
          ? (json.local as Array<{ id?: unknown; name?: unknown; available?: unknown; models?: unknown }>)
          : null
        if (locals) {
          results = locals.map((p) => ({
            id: String(p.id ?? ''),
            name: String(p.name ?? p.id ?? ''),
            available: !!p.available,
            models: Array.isArray(p.models) ? p.models.map((m) => String(m)) : [],
          }))
        } else {
          results = LOCAL_PROVIDERS.map((p) => ({ id: p.id, name: p.name, available: false, models: [] }))
        }
      } catch {
        results = LOCAL_PROVIDERS.map((p) => ({ id: p.id, name: p.name, available: false, models: [] }))
      }
      for (const p of results) modelMap[p.id] = p.models
      setLocalProviders(results)
      setProviderModels(modelMap)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    // Kick the first probe off the synchronous effect pass (a sync setState
    // here trips react-hooks/set-state-in-effect); keep polling every 30s.
    const t = setTimeout(() => void check(), 0)
    const id = setInterval(() => void check(), 30000)
    return () => {
      clearTimeout(t)
      clearInterval(id)
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Local Models</h1>
          <p className="text-xs text-muted-foreground">
            Models reported by local runtimes on this machine, plus explicitly configured compatible endpoints.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => check()}>
          <RefreshCw className="size-3.5" /> Refresh Models
        </Button>
      </div>

      {/* detected banner */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border p-3.5',
          detected.length > 0 ? 'border-emerald-500/25 bg-emerald-500/8' : 'border-border bg-card/40'
        )}
      >
        <span className={cn('size-2.5 rounded-full', detected.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
        <div className="text-sm">
          {detected.length > 0 ? (
            <>
              <span className="text-emerald-700 dark:text-emerald-300">{detected.length} local model{detected.length === 1 ? '' : 's'} detected</span>
              <span className="ml-2 text-xs text-muted-foreground">
                from {localProviders.filter((p) => p.available).map((p) => p.name).join(' + ')}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No local runtime detected — start LM Studio or Ollama</span>
          )}
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Detected" value={detected.length} sub="models on running providers" accent="text-emerald-600 dark:text-emerald-400" />
        <Metric label="Providers" value={localProviders.filter((p) => p.available).length} sub={`of ${LOCAL_PROVIDERS.length} local runtimes`} />
        <Metric label="API Models" value={keyedApiModels.length} sub="with keys configured" />
        <Metric label="Keyless" value={keylessCount} sub="hidden until a key is added" />
      </div>

      {/* local providers status */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Local Providers</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {localProviders.length > 0 ? (
            localProviders.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
                <span className={`size-2 rounded-full ${p.available ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground'}`} />
                <div className="flex-1">
                  <div className="text-xs font-medium">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {p.available ? 'Connected' : 'Not running'} · localhost:{p.id === 'lmstudio' ? '1234' : '11434'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  disabled={!p.available || (providerModels[p.id] ?? []).length === 0}
                  onClick={() => {
                    const models = providerModels[p.id] ?? []
                    models.forEach((mid, i) => {
                      addCustomModel({
                        id: `cm-${p.id}-${Date.now()}-${i}`,
                        name: `${p.name} · ${mid}`,
                        endpoint: p.id === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1',
                        hasApiKey: false,
                        modelId: mid,
                        createdAt: new Date().toISOString(),
                      })
                    })
                    toast({ title: `${p.name} models linked`, description: `${models.length} keyless model(s) — hidden from the picker until a key is added.` })
                  }}
                >
                  Select
                </Button>
              </div>
            ))
          ) : (
            <div className="col-span-2 flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
              <span className="size-2 rounded-full bg-muted-foreground animate-pulse" />
              <div className="text-xs text-muted-foreground">Checking LM Studio and Ollama…</div>
            </div>
          )}
        </div>
      </div>

      {/* download bar */}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const id = url.trim()
          if (!id) return
          // There is no download/convert backend: this form can only link a
          // model that a running provider actually reports in the list below.
          const hit = detected.find((d) => d.modelId === id)
          if (!hit) {
            toast({
              title: 'Model not found',
              description: 'Pick an id from the Detected Local Models list below — this view cannot download models.',
            })
            return
          }
          const endpoint = hit.providerId === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1'
          if (state.customModels.some((cm) => cm.modelId === hit.modelId && cm.endpoint === endpoint)) {
            toast({ title: 'Already linked', description: `${hit.modelId} is already in your model picker.` })
            return
          }
          addCustomModel({
            id: `cm-${hit.providerId}-${Date.now()}`,
            name: `${hit.providerName} · ${hit.modelId}`,
            endpoint,
            hasApiKey: false,
            modelId: hit.modelId,
            createdAt: new Date().toISOString(),
          })
          setUrl('')
          toast({ title: 'Model linked', description: `${hit.modelId} linked as keyless — hidden from the picker until a key is added.` })
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link a detected local model by id (see list below)…"
          className="h-9 min-w-52 flex-1 rounded-md border border-input bg-secondary/50 px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
        />
        <Button type="submit" size="sm" className="gap-1.5 text-xs">
          <Plug className="size-3.5" /> Link Local Model
        </Button>
      </form>

      {/* detected local models — read from the live providers, never seeded */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Detected Local Models</div>
        {detected.map((d) => {
          const endpoint = d.providerId === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1'
          const linked = state.customModels.some((cm) => cm.modelId === d.modelId && cm.endpoint === endpoint)
          return (
            <div key={`${d.providerId}-${d.modelId}`} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/15 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                {d.providerId === 'ollama' ? 'OLLA' : 'LMS'}
              </div>
              <div className="min-w-40 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px]">{d.modelId}</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">detected</span>
                  {linked ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">linked</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  <span>{d.providerName}</span>
                  <span className="font-mono">{endpoint}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant={linked ? 'secondary' : 'default'}
                className="h-7 gap-1 px-2.5 text-[11px]"
                disabled={linked}
                onClick={() => {
                  addCustomModel({
                    id: `cm-${d.providerId}-${Date.now()}`,
                    name: `${d.providerName} · ${d.modelId}`,
                    endpoint,
                    hasApiKey: false,
                    modelId: d.modelId,
                    createdAt: new Date().toISOString(),
                  })
                  toast({ title: 'Model linked', description: `${d.modelId} linked as keyless — hidden from the picker until a key is added.` })
                }}
              >
                <Play className="size-3" /> {linked ? 'Linked' : 'Use'}
              </Button>
            </div>
          )
        })}
        {detected.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {localProviders.length === 0
              ? 'Checking local runtimes…'
              : 'No local models detected. Start LM Studio (port 1234) or Ollama (port 11434) to see your installed models here.'}
          </div>
        ) : null}
      </div>

      {/* add local runtime buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={() => {
            setNewModel({ name: 'Ollama Model', endpoint: 'http://localhost:11434/v1', apiKey: '', modelId: 'llama3.2' })
            setShowAddCustom(true)
          }}
        >
          <Download className="size-3.5" /> Add Ollama Model
        </Button>
      </div>

      {/* ── User-configured compatible endpoints ──────────────────────────── */}
      <div className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Custom model endpoints</h2>
            <p className="text-[11px] text-muted-foreground">
              Compatible runtimes you configure. Local models work by default; remote use requires explicit permission in Chat settings.
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowAddCustom((s) => !s)}>
            <Plus className="size-3.5" /> Add endpoint
          </Button>
        </div>

        {showAddCustom ? (
          <div className="space-y-2 rounded-lg border bg-card p-3.5">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={newModel.name}
                onChange={(e) => setNewModel((m) => ({ ...m, name: e.target.value }))}
                placeholder="Display name"
                className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <input
                value={newModel.modelId}
                onChange={(e) => setNewModel((m) => ({ ...m, modelId: e.target.value }))}
                placeholder="Model ID from the runtime"
                className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <input
                value={newModel.endpoint}
                onChange={(e) => setNewModel((m) => ({ ...m, endpoint: e.target.value }))}
                placeholder="Local or approved compatible endpoint"
                className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <input
                value={newModel.apiKey}
                onChange={(e) => setNewModel((m) => ({ ...m, apiKey: e.target.value }))}
                placeholder="API key"
                type="password"
                className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
            {addError ? <div className="text-[10px] text-red-600 dark:text-red-400">{addError}</div> : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 gap-1 px-2.5 text-[11px]"
                onClick={async () => {
                  setAddError('')
                  try {
                    const res = await fetch('/api/custom-models', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(newModel),
                    })
                    const json = await res.json()
                    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to add model')
                    // The JSON file is what the chat picker resolves against;
                    // HubState mirrors it so the list and "API Models" metric
                    // here reflect the saved model immediately. A keyless
                    // entry for the same model is replaced instead of showing
                    // two rows once a key is added.
                    for (const cm of state.customModels) {
                      if (cm.endpoint === json.model.endpoint && cm.modelId === json.model.modelId) {
                        deleteCustomModel(cm.id)
                      }
                    }
                    addCustomModel({
                      id: json.model.id,
                      name: json.model.name,
                      endpoint: json.model.endpoint,
                      hasApiKey: json.model.hasApiKey,
                      modelId: json.model.modelId,
                      createdAt: json.model.createdAt,
                    })
                    setNewModel({ name: '', endpoint: '', apiKey: '', modelId: '' })
                    setShowAddCustom(false)
                    toast({ title: 'Model added', description: `${json.model.name} is now available in the model picker.` })
                  } catch (e) {
                    setAddError(e instanceof Error ? e.message : 'Failed to add model')
                  }
                }}
              >
                Save Model
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2.5 text-[11px]"
                onClick={() => {
                  setShowAddCustom(false)
                  setAddError('')
                  setNewModel({ name: '', endpoint: '', apiKey: '', modelId: '' })
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {keyedApiModels.length > 0 ? (
          <div className="space-y-2">
            {keyedApiModels.map((cm) => (
              <div key={cm.id} className="flex items-center gap-3 rounded-lg border bg-card p-3.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Plug className="size-4" />
                </div>
                <div className="min-w-40 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{cm.name}</span>
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">key ready</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">{cm.modelId}</span>
                    <span>{cm.endpoint}</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 gap-1 px-2.5 text-[11px]"
                    onClick={async () => {
                      try {
                        await fetch(`/api/custom-models?id=${encodeURIComponent(cm.id)}`, { method: 'DELETE' })
                        deleteCustomModel(cm.id)
                        toast({ title: 'Model removed', description: cm.name })
                      } catch {
                        toast({ title: 'Failed to remove model' })
                      }
                    }}
                  >
                    <Trash2 className="size-3" /> Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No API models available — a model only appears here once an API key is configured for it.
            {keylessCount > 0 ? ` (${keylessCount} saved model${keylessCount === 1 ? '' : 's'} hidden, no key set.)` : ''}
          </div>
        )}
      </div>
    </div>
  )
}
