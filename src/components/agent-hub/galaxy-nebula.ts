import { projectUniversePoint, spiralGalaxyPoint, type AgentNetworkNode } from '@/lib/agent-hub/agent-network'

/** Decorative dust only; real notes and links are rendered and counted separately. */
export const GALAXY_DUST = Array.from({ length: 2100 }, (_, index) => {
  const point = spiralGalaxyPoint(`dust:${index}`, index, 2100)
  return { ...point, x: point.x * .7 + 380, y: point.y * .7, z: point.z * .7, id: 'vault-dust', notePath: 'decorative', galaxy: true, label: '', kind: 'note' as const, color: '', radius: 0, detail: '' }
})
let cloudSprites: HTMLCanvasElement[] | undefined
function nebulaSprites() {
  return cloudSprites ??= ['#608aff', '#d67df5', '#a99aff'].map((color) => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) return canvas
    const haze = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    haze.addColorStop(0, color + '35'); haze.addColorStop(.4, color + '12'); haze.addColorStop(1, color + '00')
    context.fillStyle = haze; context.fillRect(0, 0, 64, 64)
    return canvas
  })
}
export function drawGalaxyNebula(ctx: CanvasRenderingContext2D, root: AgentNetworkNode, yaw: number, pitch: number, fit: number, width: number, height: number) {
  const center = projectUniversePoint(root, yaw, pitch, fit, width, height)
  ctx.save(); ctx.globalCompositeOperation = 'lighter'
  ctx.translate(center.x, center.y); ctx.rotate(-.4)
  ctx.save(); ctx.scale(1, Math.max(.2, Math.cos(1.04 + pitch * .5)))
  const cloud = ctx.createRadialGradient(0, 0, 4 * fit, 0, 0, 275 * fit)
  cloud.addColorStop(0, '#fce7ffb0'); cloud.addColorStop(.1, '#e9b9ff65'); cloud.addColorStop(.35, '#bd69e733'); cloud.addColorStop(.65, '#3878ff24'); cloud.addColorStop(1, '#08080e00')
  ctx.fillStyle = cloud; ctx.fillRect(-280 * fit, -280 * fit, 560 * fit, 560 * fit)
  ctx.restore()
  const jet = ctx.createLinearGradient(0, -180 * fit, 0, 180 * fit)
  jet.addColorStop(0, '#8baaff00'); jet.addColorStop(.43, '#b6c8ff10'); jet.addColorStop(.5, '#f4ebffb0'); jet.addColorStop(.57, '#bdcfff10'); jet.addColorStop(1, '#8baaff00')
  ctx.fillStyle = jet; ctx.beginPath(); ctx.moveTo(0, -180 * fit); ctx.lineTo(10 * fit, 0); ctx.lineTo(0, 180 * fit); ctx.lineTo(-10 * fit, 0); ctx.closePath(); ctx.fill()
  ctx.restore()
  ctx.save(); ctx.globalCompositeOperation = 'lighter'
  const sprites = nebulaSprites()
  for (let index = 0; index < GALAXY_DUST.length; index++) {
    const point = projectUniversePoint(GALAXY_DUST[index], yaw, pitch, fit, width, height)
    if (index % 16 === 0) {
      const cloudSize = 40 * fit
      ctx.drawImage(sprites[index % sprites.length], point.x - cloudSize / 2, point.y - cloudSize / 2, cloudSize, cloudSize)
    }
    ctx.fillStyle = index % 4 === 0 ? '#f5baff60' : index % 3 === 0 ? '#beb4ff55' : '#559aff44'
    const size = Math.max(.55, fit * (index % 7 === 0 ? 2.5 : 1.4))
    ctx.fillRect(point.x, point.y, size, size)
  }
  const core = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 30 * fit)
  core.addColorStop(0, '#fffaff'); core.addColorStop(.15, '#fff2ffdd'); core.addColorStop(.35, '#f0b8ff77'); core.addColorStop(1, '#bca0ff00')
  ctx.fillStyle = core; ctx.fillRect(center.x - 30 * fit, center.y - 30 * fit, 60 * fit, 60 * fit)
  ctx.restore()
}
