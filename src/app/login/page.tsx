import { redirect } from "next/navigation";
import { getOwner } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getOwner()) redirect("/");
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const hasOwner = (await prisma.ownerSettings.count()) > 0 || !!process.env.OWNER_PASSWORD;
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-900 px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 text-center">
          <div className="text-4xl" aria-hidden>🛋️</div>
          <h1 className="mt-2 text-xl font-bold text-stone-900">{settings?.companyName ?? "شركة ايراسا"}</h1>
          <p className="text-sm text-stone-500">تسجيل دخول المالك</p>
        </div>
        {!hasOwner && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            لم يُنشأ حساب المالك بعد. على الاستضافة: أضف المتغير <code dir="ltr" className="font-mono">OWNER_PASSWORD</code> ثم أعد النشر. على الحاسوب: اكتبه في ملف <code dir="ltr" className="font-mono">.env</code> أو شغّل <code dir="ltr" className="font-mono">npm run owner:set</code>
          </div>
        )}
        <ActionForm action={loginAction} className="flex flex-col gap-4" showSuccess={false}>
          <div>
            <label htmlFor="username" className="label">اسم المستخدم</label>
            <input id="username" name="username" className="input" autoComplete="username" required autoFocus dir="ltr" />
          </div>
          <div>
            <label htmlFor="password" className="label">كلمة المرور</label>
            <input id="password" name="password" type="password" className="input" autoComplete="current-password" required dir="ltr" />
          </div>
          <SubmitButton className="btn btn-primary w-full" pendingText="جارٍ التحقق…">دخول</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
