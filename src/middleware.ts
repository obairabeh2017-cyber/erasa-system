import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login"];

/**
 * حماية كل المسارات: بدون جلسة مالك صالحة تُحوّل الصفحات إلى /login،
 * وتُرفض طلبات API وإجراءات الخادم (POST) برمز 401.
 * (التحقق النهائي من نسخة الجلسة يتم أيضاً على الخادم في requireOwner.)
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  const isAction = req.method !== "GET" && req.method !== "HEAD";
  if (pathname.startsWith("/api/") || isAction) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
