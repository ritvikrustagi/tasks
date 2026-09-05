import type { BBox } from '../../../src/offload/types'
export async function cropImage(dataUrl: string, bbox: BBox): Promise<string> {
  if (
    ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite) ||
    bbox.width <= 0 ||
    bbox.height <= 0
  )
    return dataUrl
  try {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const x = Math.max(0, bbox.x),
      y = Math.max(0, bbox.y),
      w = Math.min(1, bbox.x + bbox.width) - x,
      h = Math.min(1, bbox.y + bbox.height) - y
    if (w <= 0 || h <= 0) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * image.naturalWidth))
    canvas.height = Math.max(1, Math.round(h * image.naturalHeight))
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(
      image,
      x * image.naturalWidth,
      y * image.naturalHeight,
      w * image.naturalWidth,
      h * image.naturalHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return dataUrl
  }
}
