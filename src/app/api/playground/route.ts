import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { callLLM, describeTarget, detectLocalProviders, estimateUsage, resolveTarget, type LLMUsage } from '@/lib/agent-hub/llm'
import { readState } from '@/lib/agent-hub/state-file'
import { readCustomModels } from '@/lib/agent-hub/custom-models'
import { deleteSession, listSessions, renameSession, saveSession } from '@/lib/agent-hub/playground-store'
import { buildAnalysisMessages, PlaygroundPromptError } from '@/lib/agent-hub/playground-prompts'
import type { PlaygroundMode, PlaygroundModelOption, PracticeLevel } from '@/lib/agent-hub/playground-types'
import { playgroundAction } from '@/lib/agent-hub/playground-languages'
import {
  listRoadmaps,
  resolveRoadmap,
  roadmapChoiceTarget,
  roadmapNodeForReply,
  roadmapStartingNode,
  nextRoadmapNode,
  roadmapTopicNeighborhood,
  roadmapLessonChoices,
  roadmapLessonContext,
  suggestedRoadmapSlug,
} from '@/lib/agent-hub/roadmap-library'
import type { RoadmapNode } from '@/lib/agent-hub/roadmap-library'

// ─── Playground API ──────────────────────────────────────────────────────────
// Practice sessions (save / load / rename / delete) plus one-shot analysis
// requests against the SAME local provider stack the rest of AgentHub uses.
// The analysis path calls `callLLM` with plain chat messages — no tools, no
// filesystem access, no execution of any kind — and never falls back to a
// cloud provider that the user did not configure.
//
//   GET  ?resource=sessions → { ok, sessions, warning? }
//   GET  ?resource=models   → { ok, models: PlaygroundModelOption[] }
//   POST { action: 'save' | 'delete' | 'rename' | 'analyze', ... }
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs'



function asStr(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

const MODES: PlaygroundMode[] = ['code', 'sql', 'markup', 'excel']
const LEVELS: PracticeLevel[] = ['beginner', 'intermediate', 'advanced']

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  const resource = req.nextUrl.searchParams.get('resource') ?? 'sessions'

  if (resource === 'roadmaps') {
    return NextResponse.json({ ok: true, roadmaps: await listRoadmaps() })
  }

  if (resource === 'roadmap') {
    if (req.nextUrl.searchParams.get('enabled') !== 'true') {
      return NextResponse.json({ ok: false, error: 'Turn Roadmap on before loading its visual map.' }, { status: 409 })
    }
    const slug = req.nextUrl.searchParams.get('slug') ?? ''
    const resolved = await resolveRoadmap(slug)
    if (!resolved) return NextResponse.json({ ok: false, error: 'That roadmap is not available in the local roadmap library.' }, { status: 404 })
    const visualRoadmap = {
      ...resolved.roadmap,
      nodes: resolved.roadmap.nodes.map((node) => ({ ...node, href: '' })),
    }
    return NextResponse.json({ ok: true, roadmap: visualRoadmap })
  }

  if (resource === 'models') {
    const local = await detectLocalProviders()
    const models: PlaygroundModelOption[] = []
    for (const provider of local) {
      for (const m of provider.detailedModels) {
        if (models.some((x) => x.id === m.id)) continue
        models.push({
          id: m.id,
          label: `${m.providerName} · ${m.id}`,
          provider: m.providerName,
          loaded: m.loaded,
          chatCompatible: m.isChatCompatible,
          kind: 'local',
        })
      }
    }
    const custom = await readCustomModels()
    for (const cm of custom) {
      if (models.some((x) => x.id === cm.id)) continue
      models.push({
        id: cm.id,
        label: `${cm.name} · ${cm.modelId}`,
        provider: cm.name,
        loaded: true,
        chatCompatible: true,
        kind: 'custom',
      })
    }
    return NextResponse.json({ ok: true, models })
  }

  const { sessions, warning } = await listSessions()
  return NextResponse.json(warning ? { ok: true, sessions, warning } : { ok: true, sessions })
}

/** Provider errors must stay friendly but must never fabricate an answer. */
function friendlyProviderError(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ENETUNREACH|socket|network|timeout|timed out/i.test(message)) {
    return 'The local model provider could not be reached. Your work is preserved — start the provider and try again.'
  }
  return message || 'The analysis request failed. Nothing was generated.'
}

/** Ensure model omissions never hide the graph's real branch choices. */
function includeRoadmapChoices(text: string, choices: string[]): string {
  const clean = text.trim()
  if (!choices.length) return clean
  const lower = clean.toLowerCase()
  const alreadyOffered = /\b(next topic choices|choose (?:from|one|your next)|choose what to learn next)\b/i.test(clean) &&
    choices.every((choice) => lower.includes(choice.toLowerCase()))
  if (alreadyOffered) return clean

  const choiceLine = `**Choose the next topic:** ${choices.join(' · ')}. Reply with your choice to continue.`
  const lines = clean.split(/\r?\n/)
  let questionLine = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes('?')) {
      questionLine = index
      break
    }
  }
  if (questionLine >= 0) lines.splice(questionLine, 0, choiceLine)
  else lines.push(choiceLine)
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const action = asStr(body.action, 20)

  switch (action) {
    case 'save': {
      const result = await saveSession(body.session)
      return result.ok ? NextResponse.json(result) : NextResponse.json(result, { status: 400 })
    }

    case 'delete': {
      const id = asStr(body.id, 64)
      if (!id) return NextResponse.json({ ok: false, error: 'A session id is required.' }, { status: 400 })
      return NextResponse.json(await deleteSession(id))
    }

    case 'rename': {
      const id = asStr(body.id, 64)
      if (!id) return NextResponse.json({ ok: false, error: 'A session id is required.' }, { status: 400 })
      const result = await renameSession(id, asStr(body.name, 80))
      return result.ok ? NextResponse.json(result) : NextResponse.json(result, { status: 404 })
    }

    case 'analyze': {
      const mode = asStr(body.mode, 20) as PlaygroundMode
      if (!MODES.includes(mode)) {
        return NextResponse.json({ ok: false, error: 'Unknown practice mode.' }, { status: 400 })
      }
      const level = asStr(body.level, 20) as PracticeLevel
      const actionId = asStr(body.actionId, 40)
      const spec = playgroundAction(actionId)
      if (!spec) return NextResponse.json({ ok: false, error: 'Unknown analysis action.' }, { status: 400 })
      if (!spec.modes.includes(mode)) {
        return NextResponse.json(
          { ok: false, error: `The action "${spec.label}" does not apply to this practice mode.` },
          { status: 400 },
        )
      }

      if (actionId === 'roadmap' && body.roadmapEnabled !== true) {
        return NextResponse.json({ ok: false, error: 'Turn Roadmap on before starting or continuing a roadmap lesson.' }, { status: 409 })
      }

      let roadmapContext = ''
      let activeRoadmapSlug = ''
      let roadmapCurrentTopicId = ''
      let roadmapCurrentTopicLabel = ''
      let roadmapPrerequisites: string[] = []
      let roadmapNextTopics: string[] = []
      let roadmapHistory: Array<{ role: 'assistant' | 'user'; content: string }> = []
      const roadmapReply = asStr(body.roadmapReply, 2000)
      if (actionId === 'roadmap') {
        const selectedSlug = asStr(body.roadmapSlug, 100)
        activeRoadmapSlug = selectedSlug || suggestedRoadmapSlug(asStr(body.languageId, 40), mode)
        roadmapHistory = Array.isArray(body.roadmapHistory)
          ? body.roadmapHistory.slice(-16).flatMap((turn) => {
              if (!turn || typeof turn !== 'object') return []
              const item = turn as Record<string, unknown>
              return (item.role === 'assistant' || item.role === 'user') && typeof item.content === 'string'
                ? [{ role: item.role, content: item.content.slice(0, 3000) }]
                : []
            })
          : []
        const previousSlug = activeRoadmapSlug
        if (roadmapHistory.length && roadmapReply) activeRoadmapSlug = (await roadmapChoiceTarget(activeRoadmapSlug, roadmapReply)) ?? activeRoadmapSlug
        const selectedRoadmap = await resolveRoadmap(activeRoadmapSlug)
        if (selectedRoadmap) {
          const requestedTopicId = asStr(body.roadmapCurrentTopicId, 120)
          const currentTopic = selectedRoadmap.roadmap.nodes.find((node) => node.id === requestedTopicId && node.label.trim())
          let nextTopic: RoadmapNode | null = null
          if (!roadmapHistory.length || activeRoadmapSlug !== previousSlug) {
            nextTopic = roadmapStartingNode(selectedRoadmap.roadmap)
          } else if (roadmapReply) {
            nextTopic = roadmapNodeForReply(selectedRoadmap.roadmap, roadmapReply)
            if (!nextTopic && /\b(next|continue|move on|finished|completed|done|understood)\b/i.test(roadmapReply) && currentTopic) {
              nextTopic = nextRoadmapNode(selectedRoadmap.roadmap, currentTopic.id)
            }
            if (!nextTopic) nextTopic = currentTopic ?? roadmapStartingNode(selectedRoadmap.roadmap)
          } else {
            nextTopic = currentTopic ?? roadmapStartingNode(selectedRoadmap.roadmap)
          }
          roadmapCurrentTopicId = nextTopic?.id ?? ''
          roadmapCurrentTopicLabel = nextTopic?.label ?? ''
          if (roadmapCurrentTopicId) {
            const neighborhood = roadmapTopicNeighborhood(selectedRoadmap.roadmap, roadmapCurrentTopicId)
            roadmapPrerequisites = neighborhood.prerequisites.map((node) => node.label)
            roadmapNextTopics = roadmapLessonChoices(selectedRoadmap.roadmap, roadmapCurrentTopicId)
            roadmapContext = roadmapLessonContext(selectedRoadmap.roadmap, roadmapCurrentTopicId, roadmapNextTopics)
          }
        }
        else return NextResponse.json({ ok: false, error: 'The local roadmap library is missing this diagram. Refresh it with npm run roadmaps:sync.' }, { status: 503 })
      }

      let messages: { system: string; user: string }
      try {
        messages = buildAnalysisMessages({
          mode,
          languageId: asStr(body.languageId, 40),
          actionId,
          level: LEVELS.includes(level) ? level : 'beginner',
          problemStatement: asStr(body.problemStatement, 4000),
          code: asStr(body.code, 200_000),
          sqlDialect: asStr(body.sqlDialect, 20),
          schemaText: asStr(body.schemaText, 20_000),
          sheetDump: asStr(body.sheetDump, 40_000),
          selectionAddress: asStr(body.selectionAddress, 10),
          selectionValue: asStr(body.selectionValue, 2000),
          roadmapContext,
          roadmapHistory,
          roadmapReply,
          roadmapCurrentTopic: roadmapCurrentTopicLabel,
          roadmapPrerequisites,
          roadmapNextTopics,
        })
      } catch (err) {
        const message = err instanceof PlaygroundPromptError ? err.message : 'The analysis request is invalid.'
        return NextResponse.json({ ok: false, error: message }, { status: 400 })
      }

      const model = asStr(body.model, 160)
      try {
        const customModels = await readCustomModels()
        const target = await resolveTarget(model, customModels)
        let usage: LLMUsage | null = null
        const context = [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ]
        const text = await callLLM(target, context, {
          signal: req.signal,
          maxTokens: actionId === 'roadmap' ? 2800 : actionId === 'predict-output' ? 1000 : actionId === 'find-bugs' ? 3000 : 1500,
          onUsage: (u) => {
            usage = u
          },
        })
        if (!text) {
          return NextResponse.json(
            { ok: false, error: 'The model returned an empty response. Nothing was generated — try again.' },
            { status: 502 },
          )
        }
        const responseText = actionId === 'roadmap'
          ? includeRoadmapChoices(text, roadmapNextTopics)
          : text
        const finalUsage = usage ?? estimateUsage(`${messages.system}\n${messages.user}`, text)
        const usageEstimated = usage === null
        const tokenUsage = (await readState()).tokenUsage
        return NextResponse.json({
          ok: true,
          text: responseText,
          ...(actionId === 'roadmap' ? {
            roadmapSlug: activeRoadmapSlug,
            roadmapTopicId: roadmapCurrentTopicId,
            roadmapTopicLabel: roadmapCurrentTopicLabel,
          } : {}),
          model: describeTarget(target),
          estimated: Boolean(spec.estimated),
          usage: finalUsage,
          usageEstimated,
          tokenUsage,
        })
      } catch (err) {
        // No silent fallback and no fabricated answer: the client shows this
        // error next to the user's untouched work.
        return NextResponse.json({ ok: false, error: friendlyProviderError(err) }, { status: 502 })
      }
    }

    default:
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
  }
}
