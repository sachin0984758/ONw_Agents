import { McpStdioClient, formatMcpResult, type McpToolInfo } from '../mcp/client.ts'
import { validateMcpArguments } from '../mcp/schema.ts'
import { requireString, optionalString } from './validate.ts'
import type { AgentTool, ToolContext, ToolResult } from './types.ts'

const MAX_LIST_CHARS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function findServer(ctx: ToolContext, id: string) {
  return ctx.config.mcpServers.find((server) => server.id === id)
}

function readOnly(tool: McpToolInfo): boolean {
  return tool.annotations?.readOnlyHint === true
}

function formatToolList(server: string, tools: McpToolInfo[]): string {
  const lines = [`MCP server ${server}: ${tools.length} tool(s)`]
  for (const tool of tools) {
    lines.push(`- ${tool.name}${readOnly(tool) ? ' [read-only hint]' : ''}`)
    if (tool.description) lines.push(`  ${tool.description.slice(0, 300)}`)
    const schema = JSON.stringify(tool.inputSchema)
    lines.push(`  schema: ${schema.length > 2000 ? `${schema.slice(0, 2000)}…` : schema}`)
  }
  return lines.join('\n')
}

export const listMcpTools: AgentTool = {
  name: 'mcp_list',
  description:
    'List tools exposed by explicitly configured MCP stdio servers. This starts the configured server but does not call its tools. MCP tools are external and are not covered by workspace path policy.',
  parameters: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'Optional MCP server id. Omit to list every configured server.' },
    },
    required: [],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const requested = optionalString(input, 'server', { max: 80 })
    if (ctx.config.mcpServers.length === 0) {
      return {
        ok: false,
        content: '',
        error: 'No MCP servers are configured. Add "mcpServers" to the user config (workspace config is ignored for safety).',
      }
    }
    const servers = requested
      ? ctx.config.mcpServers.filter((server) => server.id === requested)
      : ctx.config.mcpServers
    if (servers.length === 0) {
      return { ok: false, content: '', error: `No MCP server named "${requested}".` }
    }
    const output: string[] = []
    const failures: string[] = []
    let failed = 0
    for (const server of servers) {
      ctx.events({ type: 'tool_progress', id: `mcp_list_${server.id}`, name: 'mcp_list', message: `connecting to ${server.id}` })
      let client: McpStdioClient | null = null
      try {
        client = await McpStdioClient.connect(server, ctx.signal)
        const tools = await client.listTools()
        output.push(formatToolList(server.id, tools))
      } catch (err) {
        failed++
        const message = err instanceof Error ? err.message : String(err)
        failures.push(`${server.id}: ${message}`)
        output.push(`MCP server ${server.id}: ERROR ${message}`)
      } finally {
        client?.close()
      }
    }
    const text = output.join('\n\n')
    return {
      ok: failed < servers.length,
      content: text.slice(0, MAX_LIST_CHARS),
      ...(failed > 0 ? { error: `${failed} MCP server(s) failed to list tools: ${failures.join('; ').slice(0, 1200)}` } : {}),
    }
  },
}

export const callMcpTool: AgentTool = {
  name: 'mcp_call',
  description:
    'Call one tool on an explicitly configured MCP stdio server. Arguments are validated against the server-published JSON Schema first, then the central permission policy must approve the call. Connection and protocol failures are returned as tool errors; they are never simulated.',
  parameters: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'Configured MCP server id.' },
      tool: { type: 'string', description: 'Tool name from mcp_list.' },
      arguments: { type: 'object', description: 'Arguments matching the tool input schema.' },
    },
    required: ['server', 'tool'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const serverId = requireString(input, 'server', { max: 80 })
    const toolName = requireString(input, 'tool', { max: 200 })
    const args = input.arguments === undefined ? {} : input.arguments
    if (!isRecord(args)) {
      return { ok: false, content: '', error: '"arguments" must be a JSON object.' }
    }
    const server = findServer(ctx, serverId)
    if (!server) {
      const available = ctx.config.mcpServers.map((item) => item.id)
      return {
        ok: false,
        content: '',
        error: `No MCP server named "${serverId}". ${available.length ? `Configured: ${available.join(', ')}` : 'No MCP servers are configured.'}`,
      }
    }

    let client: McpStdioClient | null = null
    try {
      ctx.events({ type: 'tool_progress', id: `mcp_${serverId}`, name: 'mcp_call', message: `connecting to ${serverId}` })
      client = await McpStdioClient.connect(server, ctx.signal)
      const tools = await client.listTools()
      const tool = tools.find((item) => item.name === toolName)
      if (!tool) {
        return {
          ok: false,
          content: '',
          error: `MCP server "${serverId}" has no tool named "${toolName}". Use mcp_list to discover tools.`,
        }
      }
      const validation = validateMcpArguments(tool.inputSchema, args)
      if (!validation.ok) {
        return {
          ok: false,
          content: '',
          error: `MCP arguments rejected before execution:\n- ${validation.errors.join('\n- ')}`,
        }
      }

      const auth = await ctx.authorize(
        { kind: 'mcp.call', server: serverId, tool: toolName, readOnly: readOnly(tool) },
        'mcp_call',
        `MCP server: ${serverId}\nTool: ${toolName}\nArguments: ${JSON.stringify(args).slice(0, 2000)}\n\nMCP tools run outside the workspace with your OS user permissions; the central policy is the only restriction.`,
      )
      if (!auth.ok) return { ok: false, content: '', error: auth.reason }

      ctx.events({ type: 'tool_progress', id: `mcp_${serverId}`, name: 'mcp_call', message: `calling ${toolName}` })
      const result = await client.callTool(toolName, args)
      const content = formatMcpResult(result)
      if (result.isError) {
        return { ok: false, content, error: `MCP tool "${serverId}/${toolName}" returned an error.` }
      }
      return { ok: true, content: content || '(MCP tool returned no text)' }
    } catch (err) {
      return {
        ok: false,
        content: '',
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      client?.close()
    }
  },
}

export const mcpTools: AgentTool[] = [listMcpTools, callMcpTool]
