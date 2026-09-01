'use client'

import { useCallback, useRef, useState, useEffect } from 'react'

interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

interface ImageCropModalProps {
  imageSrc: string
  onCrop: (croppedDataUrl: string, file: File) => void
  onClose: () => void
  /** aspect ratio width/height, e.g. 1 for square. Omit for free crop */
  aspect?: number
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

const HANDLE_SIZE = 10

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max)
}

/**
 * Decodes a data: URL into a Blob without going through the network stack.
 *
 * This used to be `await fetch(dataUrl)`, which is the idiomatic one-liner —
 * and which the app's Content-Security-Policy blocks. fetch() of a data: URL
 * is governed by `connect-src` (next.config.ts), and that directive lists
 * only 'self', api.cloudinary.com and the telemetry hosts. Every product
 * image path runs through this modal, so both "Apply Crop" and "Use Original"
 * failed with "Failed to fetch" and the upload never started.
 *
 * Decoding it here is also strictly cheaper: no request, no extra copy of the
 * base64 payload handed to the fetch stack.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma === -1) {
    throw new Error('Not a data URL')
  }
  const header = dataUrl.slice(5, comma)
  const isBase64 = header.endsWith(';base64')
  const type = (isBase64 ? header.slice(0, -';base64'.length) : header) || 'image/jpeg'
  const payload = dataUrl.slice(comma + 1)

  if (!isBase64) return new Blob([decodeURIComponent(payload)], { type })

  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** Promise wrapper for canvas.toBlob, falling back to a data-URL decode. */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      try {
        resolve(dataUrlToBlob(canvas.toDataURL(type, quality)))
      } catch (err) {
        reject(err)
      }
      return
    }
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not read the cropped image'))),
      type,
      quality,
    )
  })
}

/**
 * Loads `src` into an <img> we are allowed to draw onto a canvas.
 *
 * crossOrigin is set first so a remote (Cloudinary) source arrives with CORS
 * headers and doesn't taint the canvas; a data: URL doesn't need it, and the
 * no-crossOrigin retry covers a host that doesn't answer with them. Image
 * loads are governed by `img-src`, which does allow data:, blob: and
 * res.cloudinary.com — this is why the drawing path works where fetch() does
 * not.
 */
function loadDrawableImage(imageSrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const fresh = new window.Image()
    fresh.crossOrigin = 'anonymous'
    fresh.onload = () => resolve(fresh)
    fresh.onerror = () => {
      const fallback = new window.Image()
      fallback.onload = () => resolve(fallback)
      fallback.onerror = () => reject(new Error('Could not load the image'))
      fallback.src = imageSrc
    }
    // Cache-buster only for remote URLs, so the browser re-fetches with CORS
    // headers instead of serving a non-CORS cached response.
    fresh.src = imageSrc.startsWith('data:')
      ? imageSrc
      : imageSrc + (imageSrc.includes('?') ? '&' : '?') + '_cb=' + Date.now()
  })
}

export default function ImageCropModal({ imageSrc, onCrop, onClose, aspect = 1 }: ImageCropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<CropBox>({ x: 0, y: 0, width: 0, height: 0 })
  const [imgLoaded, setImgLoaded] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)

  // Drag / resize interaction
  const [dragging, setDragging] = useState(false)
  const [resizingCorner, setResizingCorner] = useState<Corner | null>(null)
  const startRef = useRef<{ mx: number; my: number; box: CropBox } | null>(null)

  const initCrop = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    const W = img.offsetWidth
    const H = img.offsetHeight
    const size = Math.min(W, H) * 0.8
    const w = size
    const h = aspect ? w / aspect : size
    setCrop({
      x: (W - w) / 2,
      y: (H - h) / 2,
      width: w,
      height: h,
    })
  }, [aspect])

  useEffect(() => {
    if (imgLoaded) initCrop()
  }, [imgLoaded, initCrop])

  const onImgLoad = () => setImgLoaded(true)

  /* ---- mouse handlers on the overlay container ---- */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!startRef.current) return
      const img = imgRef.current
      if (!img) return
      const W = img.offsetWidth
      const H = img.offsetHeight
      const dx = e.clientX - startRef.current.mx
      const dy = e.clientY - startRef.current.my
      const b = startRef.current.box

      if (dragging) {
        setCrop(prev => ({
          ...prev,
          x: clamp(b.x + dx, 0, W - prev.width),
          y: clamp(b.y + dy, 0, H - prev.height),
        }))
      } else if (resizingCorner) {
        let { x, y, width: w, height: h } = b

        switch (resizingCorner) {
          case 'se': {
            w = clamp(w + dx, 30, W - x)
            h = aspect ? w / aspect : clamp(h + dy, 30, H - y)
            break
          }
          case 'sw': {
            const nw = clamp(w - dx, 30, w + x)
            x = b.x + (w - nw)
            w = nw
            h = aspect ? w / aspect : clamp(h + dy, 30, H - y)
            break
          }
          case 'ne': {
            w = clamp(w + dx, 30, W - x)
            const nh = aspect ? w / aspect : clamp(h - dy, 30, h + y)
            y = b.y + (h - nh)
            h = nh
            break
          }
          case 'nw': {
            const nw2 = clamp(w - dx, 30, w + x)
            x = b.x + (w - nw2)
            w = nw2
            const nh2 = aspect ? w / aspect : clamp(h - dy, 30, h + y)
            y = b.y + (h - nh2)
            h = nh2
            break
          }
        }

        x = clamp(x, 0, W - w)
        y = clamp(y, 0, H - h)
        setCrop({ x, y, width: w, height: h })
      }
    },
    [dragging, resizingCorner, aspect]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(false)
    setResizingCorner(null)
    startRef.current = null
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startRef.current = { mx: e.clientX, my: e.clientY, box: { ...crop } }
  }

  const startResize = (corner: Corner) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingCorner(corner)
    startRef.current = { mx: e.clientX, my: e.clientY, box: { ...crop } }
  }

  /* ---- apply crop ---- */
  const handleApplyCrop = async () => {
    const img = imgRef.current
    if (!img || !imgLoaded) return
    setProcessing(true)
    setCropError(null)
    try {
      const scaleX = img.naturalWidth / img.offsetWidth
      const scaleY = img.naturalHeight / img.offsetHeight
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(crop.width * scaleX)
      canvas.height = Math.round(crop.height * scaleY)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas is not supported in this browser.')

      // A fresh copy loaded with crossOrigin, so a remote (Cloudinary) source
      // doesn't taint the canvas and block reading the pixels back out.
      const drawSource = await loadDrawableImage(imageSrc)

      ctx.drawImage(
        drawSource,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      )
      // toBlob for the bytes we upload, toDataURL for the on-screen preview.
      // The preview stays a data: URL because `img-src` allows those; only
      // fetch()ing one is blocked.
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const file = new File([blob], 'cropped.jpg', { type: 'image/jpeg' })
      onCrop(dataUrl, file)
    } catch (err) {
      console.error('[ImageCropModal] crop failed:', err)
      setCropError("Couldn't crop this image. Please try again, or use \"Use Original\" instead.")
      setProcessing(false)
    }
  }

  // Cropping is optional — the user can save the image exactly as selected,
  // no crop step required.
  const handleUseOriginal = async () => {
    setProcessing(true)
    setCropError(null)
    try {
      // A freshly picked file arrives here as a data: URL from FileReader, so
      // its exact bytes and format are decoded straight out of the string —
      // no re-encode, and nothing for `connect-src` to block. A remote source
      // (re-cropping an already-saved product image) has no local bytes to
      // recover, so it goes through the canvas instead.
      const blob = imageSrc.startsWith('data:')
        ? dataUrlToBlob(imageSrc)
        : await (async () => {
            const source = await loadDrawableImage(imageSrc)
            const canvas = document.createElement('canvas')
            canvas.width = source.naturalWidth
            canvas.height = source.naturalHeight
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('Canvas is not supported in this browser.')
            ctx.drawImage(source, 0, 0)
            return canvasToBlob(canvas, 'image/jpeg', 0.92)
          })()

      const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0]
      const file = new File([blob], `original.${ext}`, { type: blob.type || 'image/jpeg' })
      onCrop(imageSrc, file)
    } catch (err) {
      console.error('[ImageCropModal] use-original failed:', err)
      setCropError("Couldn't load this image. Please try again.")
      setProcessing(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)',
      }}
    >
      <div
        style={{
          background: '#fff', padding: 24, width: '92%', maxWidth: 660,
          display: 'flex', flexDirection: 'column', maxHeight: '92vh',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Crop Image</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          Drag the crop box to reposition · Drag corner handles to resize
        </div>

        {/* Image + crop overlay */}
        <div
          style={{ flex: 1, overflow: 'auto', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 260 }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt="crop source"
              onLoad={onImgLoad}
              draggable={false}
              style={{ display: 'block', maxWidth: '100%', maxHeight: '58vh', userSelect: 'none', pointerEvents: 'none' }}
            />

            {imgLoaded && (
              <>
                {/* Semi-transparent overlay outside crop */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {/* top */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: crop.y, background: 'rgba(0,0,0,0.52)' }} />
                  {/* bottom */}
                  <div style={{ position: 'absolute', left: 0, right: 0, top: crop.y + crop.height, bottom: 0, background: 'rgba(0,0,0,0.52)' }} />
                  {/* left */}
                  <div style={{ position: 'absolute', top: crop.y, left: 0, width: crop.x, height: crop.height, background: 'rgba(0,0,0,0.52)' }} />
                  {/* right */}
                  <div style={{ position: 'absolute', top: crop.y, left: crop.x + crop.width, right: 0, height: crop.height, background: 'rgba(0,0,0,0.52)' }} />
                </div>

                {/* Crop box */}
                <div
                  onMouseDown={startDrag}
                  style={{
                    position: 'absolute',
                    left: crop.x, top: crop.y,
                    width: crop.width, height: crop.height,
                    border: '2px solid #fff',
                    boxSizing: 'border-box',
                    cursor: dragging ? 'grabbing' : 'grab',
                  }}
                >
                  {/* Rule-of-thirds guides */}
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)' }} />
                    <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)' }} />
                    <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)' }} />
                    <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)' }} />
                  </div>

                  {/* Corner handles */}
                  {(['nw', 'ne', 'sw', 'se'] as Corner[]).map(corner => (
                    <div
                      key={corner}
                      onMouseDown={startResize(corner)}
                      style={{
                        position: 'absolute',
                        width: HANDLE_SIZE, height: HANDLE_SIZE,
                        background: '#fff',
                        border: '1.5px solid #333',
                        boxSizing: 'border-box',
                        ...(corner.includes('n') ? { top: -(HANDLE_SIZE / 2) } : { bottom: -(HANDLE_SIZE / 2) }),
                        ...(corner.includes('w') ? { left: -(HANDLE_SIZE / 2) } : { right: -(HANDLE_SIZE / 2) }),
                        cursor: `${corner}-resize`,
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        {cropError && (
          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 12 }}>⚠ {cropError}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{ padding: '5px 16px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleUseOriginal}
            disabled={!imgLoaded || processing}
            title="Save the image exactly as selected, without cropping"
            style={{ padding: '5px 16px', fontSize: 12, border: '1px solid var(--border)', background: '#fff', color: 'var(--fg)', cursor: imgLoaded && !processing ? 'pointer' : 'default', opacity: imgLoaded && !processing ? 1 : 0.5 }}
          >
            Use Original
          </button>
          <button
            onClick={handleApplyCrop}
            disabled={!imgLoaded || processing}
            style={{ padding: '5px 16px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', cursor: imgLoaded && !processing ? 'pointer' : 'default', opacity: imgLoaded && !processing ? 1 : 0.5 }}
          >
            {processing ? 'Processing…' : 'Apply Crop'}
          </button>
        </div>
      </div>
    </div>
  )
}
