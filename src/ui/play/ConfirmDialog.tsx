import { useEffect, useId, useRef } from 'react'

/** A native modal dialog: it traps focus, closes on Escape and hands focus back to the button that opened it. */
export function ConfirmDialog({ open, title, body, confirm, onConfirm, onClose }: { open: boolean; title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
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
      <div className="p-5 flex flex-col gap-3">
        <h2 id={id} className="text-[17px] font-semibold">{title}</h2>
        <p className="text-[14px] text-ink-2">{body}</p>
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" className="btn" onClick={onClose} autoFocus>Cancelar</button>
          <button
            type="button"
            className="btn btn-danger"
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
