// خادم الإنتاج المحلي: يشغّل Next.js ويرفض أي اتصال من خارج الشبكة المحلية الخاصة.
// التشغيل: npm start   (بعد npm run build)
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import next from "next";

if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

// تحويل مسار قاعدة البيانات النسبي إلى مسار مطلق (نسبةً إلى مجلد prisma كما يفسّره Prisma)
// حتى لا يعتمد فتح الملف على مكان تثبيت الحزم.
const dbUrl = process.env.DATABASE_URL || "";
if (dbUrl.startsWith("file:") && !path.isAbsolute(dbUrl.slice(5).split("?")[0])) {
  process.env.DATABASE_URL = "file:" + path.resolve(process.cwd(), "prisma", dbUrl.slice(5));
}

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const localOnly = process.env.LOCAL_NETWORK_ONLY !== "false";

/** عناوين الشبكات الخاصة فقط: الجهاز نفسه، شبكة Wi-Fi المنزلية/المكتبية، وشبكة Tailscale (100.64.0.0/10). */
export function isPrivateAddress(addr) {
  if (!addr) return false;
  let a = addr;
  if (a.startsWith("::ffff:")) a = a.slice(7);
  if (a === "::1") return true;
  if (a.includes(":")) {
    const first = parseInt(a.split(":")[0] || "0", 16);
    return (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00; // link-local أو ULA
  }
  const p = a.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  return (
    p[0] === 127 ||
    p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}

const app = next({ dev: false, hostname: host, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    if (localOnly && !isPrivateAddress(req.socket.remoteAddress)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("الوصول مسموح من الشبكة المحلية فقط");
      return;
    }
    handle(req, res);
  }).listen(port, host, () => {
    console.log(`\n  ✔ شركة ايراسا — النظام يعمل على: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    if (host === "0.0.0.0") console.log("  ✔ متاح أيضاً من الهاتف على نفس شبكة Wi-Fi عبر عنوان IP لهذا الجهاز");
    console.log("  لا تغلق هذه النافذة أثناء استخدام البرنامج.\n");
  });
});
