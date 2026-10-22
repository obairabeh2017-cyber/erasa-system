import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // قاعدة البيانات المدمجة (PGlite) تحمّل ملفات WASM وقت التشغيل؛ تُترك خارج الحزمة
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
  experimental: {
    // يسمح برفع ملف النسخة الاحتياطية (يحتوي الإيصالات) عند الاستعادة؛ الإيصال الواحد محدود بـ 4 ميغابايت
    serverActions: { bodySizeLimit: "50mb" },
    // الطلبات تمر عبر middleware (التحقق من الجلسة)؛ يُسمح لها بنفس الحجم حتى لا يُقطع ملف الاستعادة
    middlewareClientMaxBodySize: "50mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

