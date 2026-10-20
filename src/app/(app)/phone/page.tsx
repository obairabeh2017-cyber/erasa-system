import os from "node:os";
import QRCode from "qrcode";
import { PageHeader, Section, Alert } from "@/components/ui";

export const metadata = { title: "الوصول من الهاتف" };

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const p = i.address.split(".").map(Number);
      const priv = p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
      if (priv) out.push(i.address);
    }
  }
  // عناوين Wi-Fi المنزلية (192.168) أولاً
  return out.sort((a, b) => Number(b.startsWith("192.168")) - Number(a.startsWith("192.168")));
}

export default async function PhonePage() {
  const port = Number(process.env.PORT || 3000);
  const listensOnLan = (process.env.HOST || "0.0.0.0") === "0.0.0.0";
  const urls = lanAddresses().map((ip) => `http://${ip}:${port}`);
  const codes = await Promise.all(urls.map((u) => QRCode.toString(u, { type: "svg", margin: 1, width: 220, color: { dark: "#0f2a57", light: "#ffffff" } })));

  return (
    <div className="space-y-5">
      <PageHeader title="الوصول من الهاتف" crumbs={[{ label: "الوصول من الهاتف" }]} subtitle="افتح البرنامج من هاتفك وهو متصل بنفس شبكة Wi-Fi التي يتصل بها هذا الحاسوب." />
      {!listensOnLan && (
        <Alert tone="warn">البرنامج يعمل حالياً لهذا الجهاز فقط. لتفعيل الهاتف: في ملف <code dir="ltr">.env</code> اجعل <code dir="ltr">HOST=&quot;0.0.0.0&quot;</code> ثم أعد تشغيل البرنامج.</Alert>
      )}
      {urls.length === 0 ? (
        <Alert tone="warn">لم يُعثر على اتصال Wi-Fi أو شبكة محلية على هذا الحاسوب. تأكد أنه متصل بالشبكة.</Alert>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {urls.map((u, i) => (
            <Section key={u} title={u.startsWith("http://100.") ? "عبر Tailscale — يعمل من أي مكان (Tailscale مثبت على الهاتف)" : i === 0 ? "امسح الرمز بكاميرا الهاتف (نفس شبكة Wi-Fi)" : "عنوان آخر لهذا الجهاز على الشبكة"}>
              <div className="flex flex-col items-center gap-3">
                {/* رمز QR مولّد على الخادم من رابط هذا الجهاز فقط */}
                <div className="rounded-lg border border-stone-200 bg-white p-2" aria-label={`رمز QR للرابط ${u}`} dangerouslySetInnerHTML={{ __html: codes[i] }} />
                <a href={u} className="font-mono text-lg font-bold text-brand-700" dir="ltr">{u}</a>
              </div>
            </Section>
          ))}
        </div>
      )}
      <Section title="إن لم يفتح الرابط من الهاتف">
        <ol className="list-decimal space-y-2 ps-5 text-sm leading-7 text-stone-700">
          <li>تأكد أن الهاتف متصل بنفس شبكة Wi-Fi (وليس ببيانات الجوال).</li>
          <li>على الحاسوب: انقر مرتين على الملف <b>allow-phone.bat</b> في مجلد البرنامج واضغط «نعم» للسماح. يفتح المنفذ {port} في جدار حماية ويندوز للشبكات الخاصة فقط.</li>
          <li>في ويندوز اجعل شبكة Wi-Fi «خاصة» (Private): الإعدادات ← الشبكة والإنترنت ← Wi-Fi ← خصائص الشبكة.</li>
          <li>الحاسوب يجب أن يبقى شغالاً والبرنامج مفتوحاً (النافذة السوداء) أثناء استخدام الهاتف.</li>
          <li>نصيحة: بعد فتح الرابط في الهاتف اختر «إضافة إلى الشاشة الرئيسية» ليظهر كأيقونة تطبيق.</li>
        </ol>
        <p className="mt-3 text-xs text-stone-500">للوصول من خارج الشبكة (مثلاً من البيت) بأمان: ثبّت تطبيق Tailscale المجاني على الحاسوب والهاتف، ثم افتح عنوان الحاسوب الذي يظهر في Tailscale مع :{port}. لا تفتح المنفذ في الراوتر للإنترنت العام.</p>
      </Section>
    </div>
  );
}
