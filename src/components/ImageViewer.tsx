import { useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ChevronLeft, ChevronRight, Maximize, X, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { mod } from "@/lib/platform"
import { cn } from "@/lib/utils"

/** An image from the preview. Diagrams come as SVG data URLs and get a plain backdrop so their text stays readable. */
export type ViewerImage = { src: string; alt: string; diagram?: boolean }

const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]

type Props = {
  images: ViewerImage[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

/** Full-window viewer for the preview's images: fit or zoom, drag to pan, arrow keys to step through the doc's images. */
export function ImageViewer({ images, index, onIndex, onClose }: Props) {
  const img = images[index]
  const stage = useRef<HTMLDivElement | null>(null)
  // The portal mounts after this component, so the stage is measured once its element exists.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // null = fit to the window; otherwise 1 = actual size.
  const [scale, setScale] = useState<number | null>(null)

  useEffect(() => (setScale(null), setNatural(null)), [index])

  useEffect(() => {
    if (!stageEl) return
    const measure = () => setBox({ w: stageEl.clientWidth, h: stageEl.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stageEl)
    return () => ro.disconnect()
  }, [stageEl])

  const pad = 32
  // Photos fit without enlarging past actual size; diagrams are vector, so they grow to fill the window.
  const maxFit = img.diagram ? 4 : 1
  const fit = natural && box.w ? Math.max(0.02, Math.min(maxFit, (box.w - pad * 2) / natural.w, (box.h - pad * 2) / natural.h)) : 1
  const shown = scale ?? fit
  const canZoom = !!natural && box.w > 0

  /** Zooms to `next` (null = fit), keeping the point under (cx, cy) in the stage where it was. */
  const zoomTo = (next: number | null, cx = box.w / 2, cy = box.h / 2) => {
    const el = stage.current
    if (!el || !natural) return
    const from = shown, to = next ?? fit
    const x = (el.scrollLeft + cx) / from, y = (el.scrollTop + cy) / from
    setScale(next)
    requestAnimationFrame(() => {
      el.scrollLeft = x * to - cx
      el.scrollTop = y * to - cy
    })
  }
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? STEPS.find((s) => s > shown + 0.001) : [...STEPS].reverse().find((s) => s < shown - 0.001)
    if (next) zoomTo(next)
  }

  // Ctrl/⌘ + wheel zooms around the pointer; a plain wheel scrolls.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !natural) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const next = Math.min(8, Math.max(0.1, shown * Math.exp(-e.deltaY / 300)))
      zoomTo(next, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  })

  // Dragging pans a zoomed image; a click without dragging toggles between fit and a closer look.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = stage.current!
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    stage.current!.scrollLeft = d.left - dx
    stage.current!.scrollTop = d.top - dy
  }
  const onImageClick = (e: React.MouseEvent) => {
    if (drag.current?.moved || !canZoom) return
    const r = stage.current!.getBoundingClientRect()
    zoomTo(scale === null ? (fit < 1 ? 1 : fit * 2) : null, e.clientX - r.left, e.clientY - r.top)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1)
    else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1)
    else if (e.key === "+" || e.key === "=") step(1)
    else if (e.key === "-") step(-1)
    else if (e.key === "0") zoomTo(null)
    else return
    e.preventDefault()
  }

  const zoomed = scale !== null && natural && (natural.w * scale > box.w - pad * 2 || natural.h * scale > box.h - pad * 2)
  const many = images.length > 1

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm duration-100 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup
          aria-label={img.alt || "Image"}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none duration-100 data-open:animate-in data-open:fade-in-0"
        >
          <div className="flex shrink-0 items-center gap-1 bg-black/40 px-3 py-2">
            <DialogPrimitive.Title className="mr-auto min-w-0 truncate pl-1 text-sm text-white/80">
              {img.alt || (img.diagram ? "Diagram" : "Image")}
              {many && <span className="ml-2 text-white/50 tabular-nums">{index + 1} / {images.length}</span>}
            </DialogPrimitive.Title>
            <ViewerButton label={`Zoom out (−)`} onClick={() => step(-1)} disabled={!canZoom}><ZoomOut /></ViewerButton>
            <button
              onClick={() => zoomTo(scale === null ? 1 : null)}
              disabled={!canZoom}
              title={scale === null ? "Actual size" : "Fit to window (0)"}
              className="w-14 rounded-md py-1 text-center text-xs text-white/80 tabular-nums hover:bg-white/10 disabled:opacity-40"
            >
              {Math.round(shown * 100)}%
            </button>
            <ViewerButton label={`Zoom in (+, or ${mod}scroll)`} onClick={() => step(1)} disabled={!canZoom}><ZoomIn /></ViewerButton>
            <ViewerButton label="Fit to window (0)" onClick={() => zoomTo(null)} disabled={scale === null}><Maximize /></ViewerButton>
            <DialogPrimitive.Close render={<ViewerButton label="Close (Esc)" />}><X /></DialogPrimitive.Close>
          </div>
          <div
            ref={(el) => { stage.current = el; setStageEl(el) }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => setTimeout(() => (drag.current = null))}
            onClick={(e) => e.target === e.currentTarget && onClose()}
            className={cn("relative min-h-0 flex-1 overflow-auto", zoomed && "cursor-grab active:cursor-grabbing")}
          >
            <div className="flex min-h-full min-w-full items-center justify-center" style={{ padding: pad, width: "max-content", height: "max-content" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
              <img
                key={img.src}
                src={img.src}
                alt={img.alt}
                draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 800, h: e.currentTarget.naturalHeight || 600 })}
                onClick={onImageClick}
                style={natural && box.w ? { width: natural.w * shown, height: natural.h * shown } : { maxWidth: box.w - pad * 2, maxHeight: box.h - pad * 2 }}
                className={cn(
                  "max-w-none select-none",
                  img.diagram && "rounded-md bg-background p-4",
                  canZoom && !zoomed && "cursor-zoom-in",
                  scale !== null && !zoomed && "cursor-zoom-out",
                )}
              />
            </div>
          </div>
          {many && (
            <>
              <NavButton side="left" disabled={index === 0} onClick={() => onIndex(index - 1)} />
              <NavButton side="right" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)} />
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ViewerButton({ label, children, ...props }: { label: string; children?: React.ReactNode } & React.ComponentProps<"button">) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} className="text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40" {...props}>
      {children}
    </Button>
  )
}

function NavButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight
  return (
    <button
      aria-label={side === "left" ? "Previous image (←)" : "Next image (→)"}
      title={side === "left" ? "Previous image (←)" : "Next image (→)"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white/80 transition-colors hover:bg-black/70 hover:text-white disabled:hidden",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-5" />
    </button>
  )
}
