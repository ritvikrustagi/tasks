import type { Frame } from '../../../src/offload/pipeline-contract'
function waitEvent(target: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        done(
          new Error('Video decoding timed out. Try uploading photos instead.'),
        ),
      15_000,
    )
    const success = () => done(),
      fail = () =>
        done(
          new Error(
            'This video format could not be decoded. Try photos instead.',
          ),
        )
    function done(error?: Error) {
      clearTimeout(timer)
      target.removeEventListener(event, success)
      target.removeEventListener('error', fail)
      error ? reject(error) : resolve()
    }
    target.addEventListener(event, success, { once: true })
    target.addEventListener('error', fail, { once: true })
  })
}
function canvasFrame(
  source: CanvasImageSource,
  width: number,
  height: number,
  id: string,
): Frame {
  const scale = Math.min(1, 768 / Math.max(width, height)),
    canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not prepare the photo.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return { id, dataUrl: canvas.toDataURL('image/jpeg', 0.72) }
}
export async function extractFrames(
  files: File[],
  onProgress: (message: string) => void,
): Promise<Frame[]> {
  if (!files.length) throw new Error('Choose a photo or video first.')
  const videoFile = files.find((f) => f.type.startsWith('video/'))
  if (videoFile) {
    if (files.length !== 1)
      throw new Error('Upload one video at a time, or choose up to six photos.')
    if (videoFile.size > 50 * 1024 * 1024)
      throw new Error('Videos must be 50 MB or smaller.')
    const video = document.createElement('video'),
      url = URL.createObjectURL(videoFile)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    try {
      const metadata = waitEvent(video, 'loadedmetadata')
      video.src = url
      await metadata
      if (
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        video.duration > 30
      )
        throw new Error('Use a video up to 30 seconds long.')
      if (video.readyState < 2) await waitEvent(video, 'loadeddata')
      const frames: Frame[] = []
      for (let i = 0; i < 6; i++) {
        onProgress(`Preparing photo ${i + 1} of 6 from your video…`)
        const time = (video.duration * (i + 0.5)) / 6
        if (Math.abs(video.currentTime - time) > 0.001) {
          const seeking = waitEvent(video, 'seeked')
          video.currentTime = time
          await seeking
        }
        frames.push(
          canvasFrame(video, video.videoWidth, video.videoHeight, `f${i}`),
        )
      }
      return frames
    } finally {
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }
  if (files.length > 6) throw new Error('Choose up to six photos.')
  const frames: Frame[] = []
  for (const [index, file] of files.entries()) {
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024)
      throw new Error('Use image files up to 20 MB each.')
    onProgress(`Preparing photo ${index + 1} of ${files.length}…`)
    const url = URL.createObjectURL(file),
      img = new Image()
    try {
      img.src = url
      await img.decode()
      frames.push(
        canvasFrame(img, img.naturalWidth, img.naturalHeight, `f${index}`),
      )
    } catch {
      throw new Error(
        'This photo format could not be decoded. Try JPEG, PNG, or WebP.',
      )
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return frames
}
