export async function register() {
  // الشرط يجب أن يكون بهذه الصيغة حتى يُستبعد الاستيراد من حزمة Edge عند البناء
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // على Vercel لا توجد عملية دائمة؛ على Render وفي التشغيل المحلي يعمل المجدول داخل العملية
    if (process.env.DISABLE_SCHEDULER !== "true" && !process.env.VERCEL) {
      const { startScheduler } = await import("./lib/scheduler");
      startScheduler();
    }
  }
}
