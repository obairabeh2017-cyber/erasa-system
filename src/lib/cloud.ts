/** هل يعمل البرنامج على استضافة سحابية (Render أو غيرها)؟ لا يوجد قرص دائم والاتصال HTTPS دائماً. */
export function onCloud(): boolean {
  return Boolean(process.env.RENDER || process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT || process.env.CLOUD_HOSTING === "true");
}
