// خادم التشغيل على جهاز الشركة: يشغّل قاعدة البيانات المدمجة ثم Next.js،
// ويرفض أي اتصال من خارج الشبكة المحلية الخاصة (الجهاز نفسه + Wi-Fi + Tailscale).
// التشغيل: start.bat أو npm start (بعد npm run build)
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import os from "node:os";
import next from "next";
import { resolveDatabaseUrls } from "./src/lib/db-env.mjs";

if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

const host = process.env.HOST || "0.0.0.0";
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

/** روابط هذا الجهاز على الشبكة المحلية (لفتحها من الهاتف). */
export function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal && isPrivateAddress(i.address) && !i.address.startsWith("169.254.")) {
        out.push(`http://${i.address}:${port}`);
      }
    }
  }
  return out;
}

let stopDb = async () => {};

async function main() {
  // بدون رابط PostgreSQL خارجي (مثل Neon) تُستخدم قاعدة البيانات المدمجة في data/pglite،
  // داخل نفس العملية (يلتقطها src/lib/db.ts من globalThis)
  if (!resolveDatabaseUrls()) {
    const { openLocalDb, LOCAL_DB_DIR } = await import("./scripts/local-db.mjs");
    console.log(`  … فتح قاعدة البيانات المحلية (${LOCAL_DB_DIR})`);
    const pg = await openLocalDb();
    globalThis.__erasaPglite = pg;
    stopDb = async () => {
      try { await pg.close(); } catch {}
    };
  }

  const app = next({ dev: false, hostname: host, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  createServer((req, res) => {
    if (localOnly && !isPrivateAddress(req.socket.remoteAddress)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("الوصول مسموح من الشبكة المحلية فقط");
      return;
    }
    handle(req, res);
  }).listen(port, host, () => {
    console.log("\n  ✔ شركة ايراسا — النظام يعمل");
    console.log(`    على هذا الجهاز:  http://localhost:${port}`);
    if (host === "0.0.0.0") {
      const urls = lanUrls();
      if (urls.length) {
        console.log("    من الهاتف (نفس شبكة Wi-Fi):");
        for (const u of urls) console.log(`      ${u}`);
      }
      console.log("    (رمز QR لهذه الروابط داخل البرنامج: القائمة ← الوصول من الهاتف)");
    }
    console.log("\n  لا تغلق هذه النافذة أثناء استخدام البرنامج.\n");
  });
}

// إغلاق قاعدة البيانات بشكل سليم عند إغلاق النافذة أو الضغط على Ctrl+C
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, async () => {
    await stopDb();
    process.exit(0);
  });
}

main().catch(async (e) => {
  console.error("\n✖ تعذر تشغيل البرنامج:", e instanceof Error ? e.message : e);
  await stopDb();
  process.exit(1);
});
