"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { attemptLogin, clearSession } from "@/lib/auth/owner";
import type { ActionState } from "@/lib/actions";

// إجراء الدخول هو الإجراء الوحيد المتاح بدون جلسة (بطبيعته).
export async function loginAction(_prev: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const username = String(fd.get("username") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!username || !password) return { error: "أدخل اسم المستخدم وكلمة المرور" };
  const h = await headers();
  const key = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const err = await attemptLogin(username, password, key);
  if (err) return { error: err };
  redirect("/");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
