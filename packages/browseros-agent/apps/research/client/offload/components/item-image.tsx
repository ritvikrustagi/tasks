import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { getImage } from '../lib/storage'
import type { Item } from '../../../src/offload/types'
export function ItemImage({
  item,
  original = false,
  className = '',
}: {
  item: Item
  original?: boolean
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false,
      objectUrl: string | undefined
    setUrl(null)
    void (async () => {
      const blob =
        (await getImage(
          original ? item.sourceImageKey : item.listingImageKey,
        )) ?? (await getImage(item.sourceImageKey))
      if (!blob || cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })().catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.listingImageKey, item.sourceImageKey, original])
  return url ? (
    <img
      src={url}
      alt={`${original ? 'Original source for' : 'Listing image for'} ${item.title}`}
      className={className}
    />
  ) : (
    <div className={`image-missing ${className}`}>
      <ImageOff size={24} />
      <span>Photo unavailable</span>
    </div>
  )
}
