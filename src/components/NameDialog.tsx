import { useState } from "react"
import { LayoutTemplate } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type NameRequest = {
  title: string
  action: string
  initial: string
  submit: (name: string, template: string | null) => Promise<void>
  /** Replaces the default hint about folders. */
  description?: React.ReactNode
  /** Templates to pick from (the first is preselected); none shows no picker. */
  templates?: string[]
  /** "end" puts the cursor after the prefilled text (e.g. "team/") instead of selecting it. */
  select?: "all" | "end"
}

/** Asks for a doc name. `team/standup` puts the doc in a "team" folder, created automatically. */
export function NameDialog({ req, onClose }: { req: NameRequest | null; onClose: () => void }) {
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{req && <Form key={req.title + req.initial} req={req} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function Form({ req, onClose }: { req: NameRequest; onClose: () => void }) {
  const [name, setName] = useState(req.initial)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [template, setTemplate] = useState(req.templates?.[0] ?? null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError("Enter a name")
    setBusy(true)
    try {
      await req.submit(name.trim(), template)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{req.title}</DialogTitle>
        <DialogDescription>{req.description ?? <>Use a slash to group docs, e.g. <code>team/standup</code>.</>}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Input
          autoFocus
          value={name}
          placeholder="meeting-notes"
          onChange={(e) => (setName(e.target.value), setError(""))}
          onFocus={(e) => (req.select === "end" ? e.target.setSelectionRange(name.length, name.length) : e.target.select())}
          aria-invalid={!!error}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {!!req.templates?.length && (
        <div className="grid gap-2">
          <p className="text-xs font-mono font-medium tracking-[0.12em] text-muted-foreground uppercase">Template</p>
          <div role="radiogroup" aria-label="Template" className="flex flex-wrap gap-1.5">
            {req.templates.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={template === t}
                onClick={() => setTemplate(t)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-muted",
                  template === t && "border-primary bg-primary/10 text-foreground hover:bg-primary/10",
                )}
              >
                <LayoutTemplate className="size-3.5 opacity-60" /> {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>{req.action}</Button>
      </DialogFooter>
    </form>
  )
}
