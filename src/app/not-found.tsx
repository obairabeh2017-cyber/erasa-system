import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-lg font-bold">الصفحة أو السجل غير موجود</h1>
        <p className="mt-2 text-sm text-stone-600">ربما حُذفت المسودة أو الرابط غير صحيح.</p>
        <Link href="/" className="btn btn-primary mt-4">العودة للوحة التحكم</Link>
      </div>
    </main>
  );
}
