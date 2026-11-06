// Regression checks for in-page background chat ownership. The real client run
// store is exercised against a controlled mock SSE transport; no model or live
// database is used, and unsubscribing represents leaving/remounting a view.
import assert from 'node:assert/strict'
import {
  acknowledgeChatMessages, discardChatRun, getChatRun, getServerChatRun,
  mergeChatMessages, removeQueuedMessage, startChatRun, stopChatRun, subscribeChatRun,
  type LocalChatMessage,
} from '../src/lib/agent-hub/chat-runs'
import { MASCOT_ACTIVITY_EVENT } from '../src/lib/agent-hub/mascot-activity'
import { setUsageSyncListener } from '../src/lib/agent-hub/usage-sync'
import type { TokenUsageLedger } from '../src/lib/agent-hub/types'

type MockRequest = {
  body: Record<string, unknown>
  signal: AbortSignal
  send(text: string): void
  close(): void
  cancelled: boolean
  aborted: boolean
}
type Activity = { source: string; state: string; display?: { task?: string; phase?: string } }
const encoder = new TextEncoder()
const requests: MockRequest[] = []
const activities: Activity[] = []
const chatIds = new Set<string>()
let passed = 0
const check = (name: string, condition: unknown) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`) }
const spin = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Mock transport did not reach the expected state.')
}
const frame = (event: object, separator = '\n\n') => `data: ${JSON.stringify(event)}${separator}`
function user(id: string, content = `Request ${id}`): LocalChatMessage {
  return { id: `user-${id}`, role: 'user', content, time: '2026-10-27T00:00:00.000Z', kind: 'chat' }
}
function begin(id: string, options: { thinking?: boolean; prepareBody?: () => Promise<Record<string, unknown>>; text?: string } = {}) {
  chatIds.add(id)
  return startChatRun({ chatId: id, user: user(id, options.text), assistantId: `assistant-${id}`, thinking: options.thinking ?? false, prepareBody: options.prepareBody ?? (async () => ({ chatId: id, message: `Request ${id}` })) })
}
async function requestFor(id: string): Promise<MockRequest> {
  await spin(() => requests.some((request) => request.body.chatId === id))
  return requests.find((request) => request.body.chatId === id)!
}

async function main() {
  const originalFetch = globalThis.fetch
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
  events.addEventListener(MASCOT_ACTIVITY_EVENT, (event) => activities.push((event as CustomEvent<Activity>).detail))
  const syncedLedgers: TokenUsageLedger[] = []
  let usageCalls = 0
  setUsageSyncListener((ledger) => { syncedLedgers.push(ledger); usageCalls++ })
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const signal = init?.signal as AbortSignal
    if (body.message === 'HTTP failure') return Response.json({ error: 'Mock provider refused this request.' }, { status: 502 })
    let controller: ReadableStreamDefaultController<Uint8Array>
    let ended = false
    const request: MockRequest = {
      body, signal, cancelled: false, aborted: false,
      send(text) { if (!ended) controller.enqueue(encoder.encode(text)) },
      close() { if (!ended) { ended = true; controller.close() } },
    }
    const stream = new ReadableStream<Uint8Array>({
      start(current) { controller = current },
      cancel() { request.cancelled = true; ended = true },
    })
    signal.addEventListener('abort', () => {
      request.aborted = true
      if (!ended) { ended = true; controller.error(new DOMException('Mock request aborted.', 'AbortError')) }
    }, { once: true })
    requests.push(request)
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
  try {
    check('empty client snapshot has a stable identity', getChatRun('never-started') === getChatRun('never-started'))
    check('server snapshot is stable and never reports browser work', getServerChatRun() === getServerChatRun() && !getServerChatRun().pending)
    let updatesA = 0
    const unsubscribeA = subscribeChatRun('A', () => updatesA++)
    const completeA = begin('A', { thinking: true })
    const a = await requestFor('A')
    check('optimistic user text and pending state exist immediately', getChatRun('A').pending && getChatRun('A').messages[0].content === 'Request A')
    const startedSnapshot = getChatRun('A')
    check('snapshot identity stays stable until an update', getChatRun('A') === startedSnapshot)
    assert.throws(() => discardChatRun('A'), /Stop this chat/)
    check('clear/delete cannot discard an active background request', getChatRun('A').pending)
    unsubscribeA()
    const detachedUpdates = updatesA
    a.send(frame({ type: 'thinking', text: 'model activity' }))
    a.send(frame({ type: 'delta', text: 'Answer A' }))
    await spin(() => getChatRun('A').text === 'Answer A')
    check('leaving a view keeps its stream and request alive', !a.signal.aborted && getChatRun('A').pending)
    check('unsubscribed views receive no state callbacks', updatesA === detachedUpdates)
    check('detached stream progress remains available on return', getChatRun('A').text === 'Answer A' && !getChatRun('A').thinking)
    check('stream updates create a new immutable snapshot', getChatRun('A') !== startedSnapshot && startedSnapshot.text === '')

    let updatesB = 0
    const unsubscribeB = subscribeChatRun('B', () => updatesB++)
    const completeB = begin('B')
    const b = await requestFor('B')
    const bBeforeA = updatesB
    const ledger: TokenUsageLedger = { records: [], days: [], updatedAt: '2026-10-27T00:01:00.000Z' }
    a.send(frame({ type: 'done', reply: 'Answer A', model: 'Mock local model', tokenUsage: ledger, thinking: { mode: 'native', effort: 'medium' }, visionWarning: 'Fixture warning', time: '2026-10-27T00:01:00.000Z' }))
    await completeA
    check('background completion retains both user and final answer', !getChatRun('A').pending && getChatRun('A').messages.map((message) => message.content).join('|') === 'Request A|Answer A')
    check('finishing A does not alter B pending state or notify B', getChatRun('B').pending && updatesB === bBeforeA && getChatRun('B').messages[0].content === 'Request B')
    check('background completion applies usage without a mounted view', usageCalls === 1 && syncedLedgers[0]?.updatedAt === ledger.updatedAt)
    check('background completion retains provider and thinking metadata', getChatRun('A').model === 'Mock local model' && getChatRun('A').thinkingInfo?.mode === 'native' && getChatRun('A').visionWarning === 'Fixture warning')
    check('completed streams release their transport body', a.cancelled)
    check('mascot activity has independent per-chat sources', activities.some((event) => event.source === 'chat:A' && event.state === 'done') && activities.some((event) => event.source === 'chat:B' && event.state === 'working') && !activities.some((event) => event.source === 'chat'))

    let remountUpdates = 0
    const unsubscribeRemount = subscribeChatRun('A', () => remountUpdates++)
    check('remount reads the retained completed answer immediately', getChatRun('A').messages.at(-1)?.content === 'Answer A')
    const localA = getChatRun('A').messages
    const sameTextDifferentId = { ...user('different-id'), content: 'Request A' }
    acknowledgeChatMessages('A', [sameTextDifferentId])
    check('matching text with a different ID never acknowledges the optimistic turn', getChatRun('A').messages.length === 2)
    const oldHistory = [sameTextDifferentId]
    check('stale history polls cannot remove local completed messages', mergeChatMessages(oldHistory, getChatRun('A').messages).length === 3)
    const persistedUser = { ...localA[0], content: 'Canonical persisted request A' }
    check('history merge deduplicates by ID and prefers server representation', mergeChatMessages([persistedUser], localA).length === 2 && mergeChatMessages([persistedUser], localA)[0].content === persistedUser.content)
    acknowledgeChatMessages('A', [persistedUser])
    check('partial server acknowledgement removes only its matching ID', getChatRun('A').messages.length === 1 && getChatRun('A').messages[0].id === 'assistant-A')
    acknowledgeChatMessages('A', localA)
    check('acknowledging both persisted IDs clears only local overlays', getChatRun('A').messages.length === 0 && remountUpdates === 2)
    unsubscribeRemount()

    b.send(frame({ type: 'delta', text: 'Partial B' }))
    await spin(() => getChatRun('B').text === 'Partial B')
    stopChatRun('B')
    await completeB
    check('Stop aborts only the selected chat fetch', b.aborted && b.signal.aborted && !a.signal.aborted)
    check('Stop retains the user and latest partial answer', getChatRun('B').messages.map((message) => message.content).join('|') === 'Request B|Partial B')
    check('Stop clears pending/thinking and offers a retry', !getChatRun('B').pending && !getChatRun('B').thinking && getChatRun('B').retryText === 'Request B' && getChatRun('B').error?.includes('stopped'))
    check('Stop publishes a terminal mascot state', activities.at(-1)?.source === 'chat:B' && activities.at(-1)?.state === 'idle' && activities.at(-1)?.display?.phase === 'Stopped')
    unsubscribeB()

    let releasePrepared!: (body: Record<string, unknown>) => void
    const prepared = new Promise<Record<string, unknown>>((resolve) => { releasePrepared = resolve })
    let prepareCalls = 0
    const firstDuplicate = begin('duplicate', { prepareBody: () => { prepareCalls++; return prepared } })
    const secondDuplicate = begin('duplicate', { prepareBody: async () => { prepareCalls++; return { chatId: 'duplicate' } } })
    check('duplicate Enter shares one in-flight run before attachment reads finish', firstDuplicate === secondDuplicate && prepareCalls === 1 && getChatRun('duplicate').messages.length === 1)
    releasePrepared({ chatId: 'duplicate' })
    const duplicate = await requestFor('duplicate')
    duplicate.send(frame({ type: 'done', reply: 'One answer' }))
    await firstDuplicate
    check('duplicate sends issue exactly one HTTP request', requests.filter((request) => request.body.chatId === 'duplicate').length === 1)

    let releaseAborted!: (body: Record<string, unknown>) => void
    const abortedPrepare = begin('prepare-stop', { prepareBody: () => new Promise((resolve) => { releaseAborted = resolve }) })
    stopChatRun('prepare-stop')
    releaseAborted({ chatId: 'prepare-stop' })
    await abortedPrepare
    check('stopping while files load prevents a later fetch', !requests.some((request) => request.body.chatId === 'prepare-stop') && !getChatRun('prepare-stop').pending && getChatRun('prepare-stop').messages.length === 1)

    const eofRun = begin('premature-eof')
    const eof = await requestFor('premature-eof')
    eof.send(frame({ type: 'delta', text: 'Incomplete result' })); eof.close()
    await eofRun
    check('premature EOF is an error rather than a completed answer', getChatRun('premature-eof').error?.includes('before it finished') && !getChatRun('premature-eof').pending)
    check('premature EOF retains request and partial result', getChatRun('premature-eof').messages.length === 2 && getChatRun('premature-eof').messages.at(-1)?.content === 'Incomplete result')
    check('premature EOF publishes mascot attention instead of endless thinking', activities.at(-1)?.source === 'chat:premature-eof' && activities.at(-1)?.state === 'error')

    const streamErrorRun = begin('stream-error')
    const streamError = await requestFor('stream-error')
    streamError.send(frame({ type: 'error', error: 'Mock model failed.' }))
    await streamErrorRun
    check('SSE provider errors retain the request and clear pending', getChatRun('stream-error').messages.length === 1 && getChatRun('stream-error').error === 'Mock model failed.' && !getChatRun('stream-error').pending)
    const httpErrorRun = begin('http-error', { prepareBody: async () => ({ chatId: 'http-error', message: 'HTTP failure' }) })
    await httpErrorRun
    check('HTTP provider errors retain the request with actionable error', getChatRun('http-error').messages.length === 1 && getChatRun('http-error').error === 'Mock provider refused this request.')

    const trailingRun = begin('crlf-trailing')
    const trailing = await requestFor('crlf-trailing')
    const frames = frame({ type: 'delta', text: 'CRLF ' }, '\r\n\r\n') + frame({ type: 'done', reply: 'CRLF done' }, '')
    trailing.send(frames.slice(0, 17)); trailing.send(frames.slice(17)); trailing.close()
    await trailingRun
    check('CRLF frames split between chunks and trailing EOF done are consumed', !getChatRun('crlf-trailing').error && getChatRun('crlf-trailing').messages.at(-1)?.content === 'CRLF done')
    const correctedRun = begin('quiz-correction')
    const corrected = await requestFor('quiz-correction')
    corrected.send(frame({ type: 'delta', text: 'Incomplete draft' }))
    await spin(() => getChatRun('quiz-correction').text === 'Incomplete draft')
    corrected.send(frame({ type: 'replace', text: 'Corrected interactive quiz' }))
    await spin(() => getChatRun('quiz-correction').text === 'Corrected interactive quiz')
    check('a repaired stream replaces the invalid draft instead of concatenating it', getChatRun('quiz-correction').text === 'Corrected interactive quiz')
    corrected.send(frame({ type: 'done', reply: 'Corrected interactive quiz' }))
    await correctedRun
    check('the corrected stream completes with the repaired answer', getChatRun('quiz-correction').messages.at(-1)?.content === 'Corrected interactive quiz')
    const emptyRun = begin('empty-done')
    const empty = await requestFor('empty-done')
    empty.send(frame({ type: 'done', reply: '   ' }))
    await emptyRun
    check('empty done cannot create a blank success bubble', getChatRun('empty-done').error?.includes('no visible answer') && getChatRun('empty-done').messages.length === 1)

    discardChatRun('B')
    const first = begin('queued')
    const firstRequest = await requestFor('queued')
    const option = (id: string) => ({ chatId: 'queued', user: user(id), assistantId: `reply-${id}`, thinking: false, queueIfBusy: true, prepareBody: async () => ({ chatId: 'queued', message: id }) })
    await startChatRun(option('next'))
    await startChatRun(option('removed'))
    removeQueuedMessage('queued', user('removed').id)
    check('queued messages can be removed while the current reply streams', getChatRun('queued').queued.length === 1)
    firstRequest.send(frame({ type: 'done', reply: 'First answer' }))
    await first
    await spin(() => requests.some((request) => request.body.message === 'next'))
    const nextRequest = requests.find((request) => request.body.message === 'next')!
    check('queued message starts only after the prior response completes', getChatRun('queued').pending && getChatRun('queued').queued.length === 0)
    await startChatRun(option('cancelled'))
    stopChatRun('queued')
    await spin(() => !getChatRun('queued').pending)
    check('Stop cancels the active request and clears the pending queue', nextRequest.aborted && getChatRun('queued').queued.length === 0 && !requests.some((request) => request.body.message === 'cancelled'))
    check('settled chat overlays may be discarded without reviving work', getChatRun('B') === getServerChatRun())
    console.log(`\n${passed} background chat checks passed (mock SSE transport; no live model).`)
  } finally {
    for (const id of chatIds) stopChatRun(id)
    setUsageSyncListener(null)
    globalThis.fetch = originalFetch
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
