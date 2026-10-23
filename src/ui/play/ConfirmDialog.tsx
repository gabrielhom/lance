import { useEffect, useId, useRef } from 'react'

type Props = { open: boolean; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void; onClose: () => void }

/** A native modal dialog: it traps focus, closes on Escape and hands focus back to the button that opened it. */
export function ConfirmDialog({ open, title, body, confirm, danger = false, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="p-6 flex flex-col gap-2">
        <h2 id={id} className="font-serif font-semibold text-xl">{title}</h2>
        <p className="text-ink-2">{body}</p>
        <div className="flex items-center justify-end gap-6 mt-4">
          <button type="button" className="tl tl-quiet" onClick={onClose} autoFocus>Cancelar</button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : ''}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </dialog>
  )
}
