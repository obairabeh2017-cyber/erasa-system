"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState | undefined, fd: FormData) => Promise<ActionState>;

/** نموذج يرسل إلى إجراء خادم ويعرض رسالة الخطأ أو النجاح بالعربية. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showSuccess = true,
  encType,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  encType?: "multipart/form-data";
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} encType={encType} noValidate={false}>
      {state?.error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}
      {state?.ok && showSuccess && state.message && (
        <div role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </div>
      )}
      {children}
    </form>
  );
}

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText = "جارٍ التنفيذ…",
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/**
 * زر بتأكيد: يفتح نافذة تأكيد قبل إرسال النموذج. إن طُلب سبب، يُرسل في الحقل reason.
 */
export function ConfirmButton({
  children,
  title,
  message,
  confirmText = "تأكيد",
  className = "btn btn-danger",
  requireReason = false,
  name,
  value,
}: {
  children: React.ReactNode;
  title: string;
  message: string;
  confirmText?: string;
  className?: string;
  requireReason?: boolean;
  name?: string;
  value?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const uid = useId();
  const { pending } = useFormStatus();

  function confirm() {
    const form = triggerRef.current?.form;
    if (!form) return;
    if (requireReason && !reason.trim()) return;
    dialogRef.current?.close();
    const submitter = document.createElement("button");
    submitter.type = "submit";
    submitter.hidden = true;
    if (name) {
      submitter.name = name;
      submitter.value = value ?? "";
    }
    form.appendChild(submitter);
    form.requestSubmit(submitter);
    submitter.remove();
  }

  return (
    <>
      <button type="button" ref={triggerRef} className={className} disabled={pending} onClick={() => dialogRef.current?.showModal()}>
        {pending ? "جارٍ التنفيذ…" : children}
      </button>
      <dialog ref={dialogRef} className="m-auto w-[92vw] max-w-md rounded-xl p-0 shadow-xl backdrop:bg-black/40" aria-labelledby={`${uid}-t`}>
        <div className="p-5">
          <h2 id={`${uid}-t`} className="mb-2 text-lg font-bold text-stone-900">{title}</h2>
          <p className="mb-4 text-sm leading-6 text-stone-600">{message}</p>
          {requireReason && (
            <div className="mb-4">
              <label className="label" htmlFor={`${uid}-r`}>السبب (إلزامي)</label>
              <input id={`${uid}-r`} name="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()}>إلغاء</button>
            <button type="button" className={className} onClick={confirm} disabled={requireReason && !reason.trim()}>{confirmText}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function PrintButton({ label = "طباعة / حفظ PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
      🖨️ {label}
    </button>
  );
}
