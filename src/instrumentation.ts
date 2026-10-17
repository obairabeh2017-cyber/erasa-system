export async function register() {
  // الشرط يجب أن يكون بهذه الصيغة حتى يُستبعد الاستيراد من حزمة Edge عند البناء
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.DISABLE_SCHEDULER !== "true") {
      const { startScheduler } = await import("./lib/scheduler");
      startScheduler();
    }
  }
}
