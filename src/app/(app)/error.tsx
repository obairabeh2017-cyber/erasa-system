"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center" role="alert">
      <div className="text-3xl" aria-hidden>⚠️</div>
      <h1 className="mt-2 text-lg font-bold">حدث خطأ أثناء تحميل الصفحة</h1>
      <p className="mt-2 text-sm text-stone-600">لم يتم تغيير أي بيانات. حاول مرة أخرى، وإن تكرر الخطأ راجع نافذة البرنامج السوداء (السجل).</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-stone-400" dir="ltr">{error.digest}</p>}
      <button className="btn btn-primary mt-4" onClick={reset}>إعادة المحاولة</button>
    </div>
  );
}
