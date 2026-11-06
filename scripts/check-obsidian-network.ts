import assert from 'node:assert/strict'
import { buildVaultNetwork, combineNetworkUniverses, projectPoint, projectUniversePoint, LARGE_GALAXY_THRESHOLD } from '../src/lib/agent-hub/agent-network'
import type { VaultGraph } from '../src/lib/agent-hub/obsidian/types'
const graph: VaultGraph = { connectionId: 'test', name: 'Real fixture', notes: ['A.md', 'B.md', 'Folder/C.md'].map((path) => ({ path, title: path, bytes: 10, modifiedAt: '' })), links: [{ from: 'A.md', to: 'B.md' }, { from: 'A.md', to: 'missing.md' }], limited: false, scanned: 3 }
const network = buildVaultNetwork(graph)
assert.equal(network.nodes.length, 4)
assert.equal(network.edges.length, 1)
assert.deepEqual(network.edges[0], { from: 'note:A.md', to: 'note:B.md' })
assert.equal(network.nodes[1].notePath, 'A.md')
assert.equal(network.nodes[1].kind, 'note')
assert.ok(network.nodes.every((node) => [node.x, node.y, node.z].every(Number.isFinite)))
assert.equal(buildVaultNetwork({ ...graph, notes: [], links: [] }).nodes.length, 1)
assert.ok(Number.isFinite(projectPoint(network.nodes[1], 1, .5, 1, 1000, 800).x))
const workspace = { nodes: [{ ...network.nodes[0], id: 'project', label: 'Large Project' }, { ...network.nodes[1], id: 'agent:real', kind: 'agent' as const, agentId: 'real', notePath: undefined }], edges: [{ from: 'project', to: 'agent:real' }], totalCodeNodes: 10 }
const before = JSON.stringify({ workspace, network })
const combined = combineNetworkUniverses(workspace, network)
assert.equal(combined.nodes.length, workspace.nodes.length + network.nodes.length)
assert.equal(combined.edges.length, workspace.edges.length + network.edges.length)
assert.equal(combined.nodes.find((node) => node.id === 'project')!.x, -380)
assert.equal(combined.nodes.find((node) => node.id === 'vault')!.x, 380)
assert.equal(combined.nodes.find((node) => node.id === 'vault')!.label, 'Obsidian')
assert.equal(combined.nodes.find((node) => node.id === 'agent:real')!.agentId, 'real')
assert.equal(combined.nodes.find((node) => node.id === 'note:A.md')!.notePath, 'A.md')
assert.equal(JSON.stringify({ workspace, network }), before)
assert.equal(combined.totalCodeNodes, 10)
const left = combined.nodes.find((node) => node.id === 'project')!, right = combined.nodes.find((node) => node.id === 'vault')!
for (const yaw of [0, Math.PI / 2, Math.PI]) assert.ok(projectUniversePoint(left, yaw, .1, 1, 1200, 800).x < projectUniversePoint(right, yaw, .1, 1, 1200, 800).x)
const large = buildVaultNetwork({ ...graph, notes: Array.from({ length: LARGE_GALAXY_THRESHOLD }, (_, index) => ({ path: `notes/${index}.md`, title: String(index), bytes: 1, modifiedAt: '' })), links: [] })
assert.ok(large.nodes.every((node) => node.galaxy))
assert.ok(network.nodes.every((node) => !node.galaxy))
assert.equal(large.nodes.filter((node) => node.notePath).length, LARGE_GALAXY_THRESHOLD)
assert.ok(large.nodes.every((node) => [node.x, node.y, node.z].every(Number.isFinite) && Math.abs(node.z) < 25))
const spiral = combineNetworkUniverses(workspace, large)
const star = spiral.nodes.find((node) => node.notePath)!
const phaseA = projectUniversePoint(star, 0, -.15, 1, 1200, 800), phaseB = projectUniversePoint(star, .1, -.15, 1, 1200, 800)
assert.ok(Math.hypot(phaseA.x - phaseB.x, phaseA.y - phaseB.y) > 0, 'real stars move along the disk')
const spiralCore = spiral.nodes.find((node) => node.id === 'vault')!
assert.equal(projectUniversePoint(spiralCore, 0, -.15, 1, 1200, 800).x, projectUniversePoint(spiralCore, 1, -.15, 1, 1200, 800).x)
console.log('26/26 Obsidian network, universe and galaxy checks passed.')
