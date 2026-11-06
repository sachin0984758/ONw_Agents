/** Translate object-fit:contain pixels into the captured Windows coordinates.
 * Letterbox margins must never become desktop clicks. */
export function previewPoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, image: { width: number; height: number }, bounds: number[]): { x: number; y: number } | null {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0 || bounds.length !== 4 || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) return null
  const scale = Math.min(box.width / image.width, box.height / image.height)
  const width = image.width * scale; const height = image.height * scale
  const x = clientX - box.left - (box.width - width) / 2
  const y = clientY - box.top - (box.height - height) / 2
  if (x < 0 || y < 0 || x >= width || y >= height) return null
  return { x: Math.min(bounds[2] - 1, Math.round(bounds[0] + x / width * (bounds[2] - bounds[0]))), y: Math.min(bounds[3] - 1, Math.round(bounds[1] + y / height * (bounds[3] - bounds[1]))) }
}
