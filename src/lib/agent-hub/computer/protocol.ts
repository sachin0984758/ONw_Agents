import { z } from 'zod'
import type { ToolSpec } from '../session/types'

export type AutoProfile = 'fast' | 'balanced' | 'careful'
export type AutoApprovalMode = 'always-ask' | 'when-needed' | 'full'
export type AutoPhase = 'idle' | 'planned' | 'observing' | 'planning' | 'validating' | 'acting' | 'verifying' | 'recovery' | 'paused' | 'waiting' | 'completed' | 'partial' | 'failed' | 'cancelled'
export interface ComputerScope { approvalMode?: AutoApprovalMode; applications: string[]; domains: string[]; readonly: boolean; workspaceId?: string; workspaceAccess?: 'none' | 'read' | 'write'; internet?: boolean; pointerProfile?: 'fast' | 'normal' | 'demonstration'; screenshots?: boolean }
export interface AutoEvent { id: string; action: string; phase: AutoPhase; startedAt: string; finishedAt?: string; durationMs?: number; ok?: boolean; verified?: boolean; target?: string; output: string }
export interface AutoTask { id: string; title: string; request: string; phase: AutoPhase; profile: AutoProfile; model: string; modelLabel?: string; visionModel: string; currentApplication?: string; scope: ComputerScope; events: AutoEvent[]; plan: string[]; result: string; createdAt: string; updatedAt: string; modelCalls: number; modelMs: number; permissionRequired?: boolean; approval?: { id: string; name: string; args: Record<string, unknown>; canRemember?: boolean }; screenshot?: string }

const handle = z.number().int().positive()
const target = { snapshot_id: z.string().min(1).max(100), element_id: z.string().max(150).optional() }
const coordinates = { x: z.number().int().min(-32000).max(32000).optional(), y: z.number().int().min(-32000).max(32000).optional() }
const postcondition = { expected_text: z.string().max(500).optional() }
const movement = { duration_ms: z.number().int().min(0).max(2000).optional() }
const button = z.enum(['left', 'right', 'middle']).default('left')
const page = { page_id: z.string().min(1).max(100) }
const locator = { ...page, role: z.enum(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'heading', 'option', 'tab', 'menuitem']), name: z.string().max(300) }
export const COMPUTER_SCHEMAS: Record<string, z.ZodType> = {
  'desktop.get_windows': z.object({}).strict(),
  'desktop.get_active_window': z.object({}).strict(),
  'desktop.get_mouse_position': z.object({}).strict(),
  'desktop.inspect_window': z.object({ handle }).strict(),
  'desktop.focus_window': z.object({ handle }).strict(),
  'desktop.minimize_window': z.object({ handle }).strict(),
  'desktop.maximize_window': z.object({ handle }).strict(),
  'desktop.restore_window': z.object({ handle }).strict(),
  'desktop.close_window': z.object({ handle }).strict(),
  'desktop.capture_screen': z.object({ handle }).strict(),
  'desktop.click': z.object({ ...target, ...coordinates, ...postcondition, ...movement }).strict(),
  'desktop.double_click': z.object({ ...target, ...coordinates, ...postcondition, ...movement }).strict(),
  'desktop.right_click': z.object({ ...target, ...coordinates, ...postcondition, ...movement }).strict(),
  'desktop.move_mouse': z.object({ ...target, ...coordinates, ...movement }).strict(),
  'desktop.hover': z.object({ ...target, ...coordinates, ...movement }).strict(),
  'desktop.mouse_down': z.object({ ...target, ...coordinates, button, ...movement }).strict(),
  'desktop.mouse_up': z.object({ ...target, button }).strict(),
  'desktop.drag': z.object({ ...target, from_x: z.number().int(), from_y: z.number().int(), to_x: z.number().int(), to_y: z.number().int(), ...movement, ...postcondition }).strict(),
  'desktop.scroll': z.object({ ...target, ...coordinates, clicks: z.number().int().min(-20).max(20), ...postcondition, ...movement }).strict(),
  'desktop.type_text': z.object({ ...target, element_id: z.string().min(1), text: z.string().max(8000), replace: z.boolean().optional() }).strict(),
  'desktop.press_key': z.object({ ...target, key: z.string().max(24), ...postcondition }).strict(),
  'desktop.hotkey': z.object({ ...target, keys: z.array(z.string().max(24)).min(1).max(4), ...postcondition }).strict(),
  'desktop.key_down': z.object({ ...target, key: z.string().min(1).max(24) }).strict(),
  'desktop.key_up': z.object({ ...target, key: z.string().min(1).max(24) }).strict(),
  'desktop.wait_for_element': z.object({ handle, control_type: z.string().max(100), name: z.string().max(300), timeout_ms: z.number().int().min(100).max(10000).optional() }).strict(),
  'desktop.open_application': z.object({ application: z.enum(['notepad', 'explorer', 'vscode', 'calculator']) }).strict(),
  'desktop.read_element': z.object({ ...target, element_id: z.string().min(1) }).strict(),
  'desktop.stop': z.object({}).strict(),
  'browser.open': z.object({ url: z.string().url().max(2048) }).strict(),
  'browser.tabs': z.object({}).strict(),
  'browser.inspect': z.object(page).strict(),
  'browser.navigate': z.object({ ...page, url: z.string().url().max(2048) }).strict(),
  'browser.switch_tab': z.object(page).strict(),
  'browser.click': z.object({ ...locator, ...postcondition }).strict(),
  'browser.fill': z.object({ ...locator, text: z.string().max(8000) }).strict(),
  'browser.select': z.object({ ...locator, value: z.string().max(500) }).strict(),
  'browser.read': z.object(locator).strict(),
  'browser.scroll': z.object({ ...page, pixels: z.number().int().min(-2000).max(2000) }).strict(),
  'visual_ground': z.object({ handle, instruction: z.string().min(1).max(1200) }).strict(),
}

export const COMPUTER_READS = new Set(['desktop.get_windows', 'desktop.get_active_window', 'desktop.get_mouse_position', 'desktop.inspect_window', 'desktop.capture_screen', 'desktop.wait_for_element', 'desktop.read_element', 'desktop.stop', 'browser.tabs', 'browser.inspect', 'browser.read', 'visual_ground'])
export const COMPUTER_TOOL_METADATA = Object.fromEntries(Object.entries(COMPUTER_SCHEMAS).map(([name, input]) => [name, { input: z.toJSONSchema(input), output: { type: 'object', properties: { verified: { type: 'boolean' }, observation: { type: 'object' }, error: { type: 'string' } } }, timeoutMs: name === 'visual_ground' ? 120000 : 30000, permission: COMPUTER_READS.has(name) ? 'observe' : 'approval', verification: 'An observable postcondition is required. Successful input dispatch alone is unverified.' }]))
const DESCRIPTIONS: Record<string, string> = {
  'desktop.get_windows': 'Discover real Windows applications and monitor bounds. Only permitted applications expose their titles.',
  'desktop.get_mouse_position': 'Read the actual Windows cursor coordinates with GetCursorPos.',
  'desktop.click': 'Move the real Windows pointer to a fresh observed element or coordinates, revalidate, then left-click with SendInput. Supply a new expected_text postcondition when available; dispatch alone does not prove task success.',
  'desktop.hover': 'Move the real pointer to the observed target without clicking. Position is verified with GetCursorPos.',
  'desktop.mouse_down': 'Hold an injected mouse button at the observed target. Release it with mouse_up. Stop and pause release all automation-owned held input.',
  'desktop.key_down': 'Hold an approved key in the foreground target. Release with key_up; all effective key combinations remain subject to policy.',
  'desktop.inspect_window': 'Read UI Automation controls in a permitted window. Returns a fresh snapshot_id and element ids; prefer these to coordinates.',
  'desktop.open_application': 'Open or locate a permitted application. Notepad can restore existing tabs: inspect it and create an empty document before typing unless the user explicitly requested editing existing contents.',
  'desktop.type_text': 'Type Unicode text in an observed, focused Edit/Document control. Set replace:true only to replace existing contents when requested.',
  'desktop.capture_screen': 'Capture only the selected permitted window, including in the background when Windows can render it safely. Screenshot pixels stay local; no image is sent to a text-only model.',
  visual_ground: 'Ask an available, already-loaded local vision model to locate a visual target in a permitted window. Returns proposed coordinates, never executes input. Unavailable without compatible vision.',
}
export const COMPUTER_TOOLS: ToolSpec[] = Object.entries(COMPUTER_SCHEMAS).map(([name, schema]) => {
  const parameters = z.toJSONSchema(schema)
  delete parameters.$schema // The provider already knows the tools use JSON Schema.
  return { name: name.replaceAll('.', '_'), description: DESCRIPTIONS[name] ?? `${name.replaceAll('.', ' ').replaceAll('_', ' ')} using the fresh observed target.`, parameters: parameters as ToolSpec['parameters'] }
})
export function computerToolsForMode(readonly: boolean): ToolSpec[] { return COMPUTER_TOOLS.filter((tool) => !readonly || COMPUTER_READS.has(nativeToolName(tool.name))) }
export function nativeToolName(name: string): string { return name.startsWith('desktop_') ? name.replace('desktop_', 'desktop.') : name.startsWith('browser_') ? name.replace('browser_', 'browser.') : name }
export function validateComputerAction(name: string, args: unknown): Record<string, unknown> {
  const schema = COMPUTER_SCHEMAS[name]
  if (!schema) throw new Error('Unknown computer-control tool.')
  const result = schema.safeParse(args)
  if (!result.success) throw new Error(`Invalid ${name} arguments: ${result.error.issues.map((issue) => issue.message).join('; ')}`)
  const value = result.data as Record<string, unknown>
  if (['desktop.click', 'desktop.double_click', 'desktop.right_click', 'desktop.move_mouse', 'desktop.hover', 'desktop.mouse_down', 'desktop.scroll'].includes(name) && !value.element_id && (value.x === undefined || value.y === undefined)) throw new Error('Choose an observed element or both coordinates.')
  return value
}
