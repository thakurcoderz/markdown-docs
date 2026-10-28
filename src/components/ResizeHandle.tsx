type Props = {
  /** Which panel this handle resizes: "left" sits on its right edge, "right" on its left edge. */
  side: "left" | "right"
  width: number
  min: number
  max: number
  onResize: (w: number) => void
  /** Drag finished (or double-click reset); persist the width here. */
  onDone: (w: number) => void
  defaultWidth: number
}

/** Invisible drag strip on a panel edge; highlights on hover. Double-click restores the default width. */
export function ResizeHandle({ side, width, min, max, onResize, onDone, defaultWidth }: Props) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget, x0 = e.clientX
    let w = width
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onResize((w = clamp(width + (side === "left" ? 1 : -1) * (ev.clientX - x0))))
    const up = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      onDone(w)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }
  return (
    <div className="relative z-20 w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={side === "left" ? "Resize sidebar" : "Resize panel"}
        title="Drag to resize · double-click to reset"
        onPointerDown={start}
        onDoubleClick={() => (onResize(defaultWidth), onDone(defaultWidth))}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize transition-colors hover:bg-ring/30 active:bg-ring/50"
      />
    </div>
  )
}
