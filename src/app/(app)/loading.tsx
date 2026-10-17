export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20 text-stone-500" role="status" aria-live="polite">
      <span className="me-2 inline-block size-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" aria-hidden />
      جارٍ التحميل…
    </div>
  );
}
