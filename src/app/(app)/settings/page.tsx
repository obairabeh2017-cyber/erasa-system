import { onCloud } from "@/lib/cloud";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Alert } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { listBackups, backupDir } from "@/lib/services/backup";
import { formatDateTime } from "@/lib/dates";
import {
  addCategoryAction, addUnitAction, backupNowAction, changePasswordAction, integrityAction, restoreUploadAction,
  logoutEverywhereAction, renameCategoryAction, saveSettingsAction,
} from "./actions";

export const metadata = { title: "الإعدادات" };

const EXPORTS: [string, string][] = [
  ["items", "الأصناف والأرصدة"], ["movements", "حركات المخزون"], ["sales", "فواتير البيع"], ["sale-lines", "أسطر المبيعات"],
  ["purchases", "فواتير الشراء"], ["purchase-lines", "أسطر المشتريات"], ["production", "أوامر الإنتاج"], ["payments", "المدفوعات"],
  ["expenses", "المصروفات"], ["other-income", "الإيرادات الأخرى"], ["customers", "الزبائن"], ["suppliers", "الموردون"],
  ["employees", "الموظفون"], ["employee-transactions", "حركات الموظفين"], ["debts", "الديون"], ["accounts", "الحسابات النقدية"],
];
const KIND_LABEL = { ITEM: "فئات الأصناف", EXPENSE: "فئات المصروفات", INCOME: "فئات الإيرادات الأخرى" } as const;

export default async function SettingsPage() {
  const [s, categories, units, logs] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    prisma.category.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.unit.findMany({ orderBy: { name: "asc" } }),
    prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 50 }),
  ]);
  const isCloud = onCloud();
  const backups = isCloud ? [] : listBackups().slice(0, 30);

  return (
    <div className="space-y-5">
      <PageHeader title="الإعدادات والنسخ الاحتياطي" crumbs={[{ label: "الإعدادات" }]} />

      <Section title="بيانات الشركة والتذكيرات">
        <ActionForm action={saveSettingsAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="label" htmlFor="companyName">اسم الشركة</label><input id="companyName" name="companyName" className="input" defaultValue={s.companyName} required /></div>
          <div><label className="label" htmlFor="companyPhone">الهاتف</label><input id="companyPhone" name="companyPhone" className="input" dir="ltr" defaultValue={s.companyPhone ?? ""} /></div>
          <div><label className="label" htmlFor="companyAddress">العنوان</label><input id="companyAddress" name="companyAddress" className="input" defaultValue={s.companyAddress ?? ""} /></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="label" htmlFor="invoiceFooter">تذييل الفاتورة المطبوعة</label><input id="invoiceFooter" name="invoiceFooter" className="input" defaultValue={s.invoiceFooter ?? ""} placeholder="شكراً لتعاملكم معنا" /></div>
          <div><label className="label" htmlFor="debtReminderDaysAhead">التذكير بالديون قبل الاستحقاق (أيام)</label><input id="debtReminderDaysAhead" name="debtReminderDaysAhead" type="number" min={0} max={60} className="input" defaultValue={s.debtReminderDaysAhead} /></div>
          <div><label className="label" htmlFor="salaryDayOfMonth">يوم صرف الرواتب من الشهر</label><input id="salaryDayOfMonth" name="salaryDayOfMonth" type="number" min={1} max={31} className="input" defaultValue={s.salaryDayOfMonth} /></div>
          <div><label className="label" htmlFor="salaryReminderDays">التذكير بالرواتب قبل (أيام)</label><input id="salaryReminderDays" name="salaryReminderDays" type="number" min={0} max={31} className="input" defaultValue={s.salaryReminderDays} /></div>
          <div><label className="label" htmlFor="backupIntervalHours">النسخ الاحتياطي التلقائي كل (ساعة)</label><input id="backupIntervalHours" name="backupIntervalHours" type="number" min={1} max={720} className="input" defaultValue={s.backupIntervalHours} /></div>
          <div><label className="label" htmlFor="backupKeep">عدد النسخ المحفوظة</label><input id="backupKeep" name="backupKeep" type="number" min={1} max={365} className="input" defaultValue={s.backupKeep} /></div>
          <div className="flex items-end"><SubmitButton>حفظ الإعدادات</SubmitButton></div>
        </ActionForm>
      </Section>

      <Section title="النسخ الاحتياطي">
        <div className="mb-3 space-y-2 text-sm text-stone-600">
          <p>النسخة الاحتياطية ملف JSON كامل يضم كل البيانات والإيصالات. نزّلها بانتظام (أسبوعياً على الأقل) واحفظها على جهازك أو ذاكرة USB.</p>
          <Alert tone="info">على الاستضافة السحابية (Neon) تتوفر أيضاً نقاط استعادة زمنية من لوحة تحكم Neon. للاستعادة من ملف: <code dir="ltr">npm run db:restore -- &lt;الملف&gt; --replace</code> (التفاصيل في README).</Alert>
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <a href={"/api/backup"} download className="btn btn-primary">⬇ تنزيل نسخة احتياطية كاملة</a>
          {!isCloud && (
            <ActionForm action={backupNowAction} showSuccess>
              <SubmitButton className="btn btn-secondary">حفظ نسخة على هذا الجهاز الآن</SubmitButton>
            </ActionForm>
          )}
        </div>
        {!isCloud && (
          <>
            <p className="mb-2 text-sm text-stone-600">مجلد النسخ المحلية: <code dir="ltr" className="rounded bg-stone-100 px-1">{backupDir()}</code> — آخر نسخة تلقائية: {formatDateTime(s.lastAutoBackupAt)}</p>
            {backups.length === 0 ? <p className="text-sm text-stone-500">لا توجد نسخ محلية بعد.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الملف</th><th>الحجم</th><th>التاريخ</th></tr></thead>
                  <tbody>{backups.map((b) => <tr key={b.name}><td dir="ltr" className="text-end font-mono text-xs">{b.name}</td><td className="num">{Math.round(b.size / 1024)} KB</td><td>{formatDateTime(b.createdAt)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="استعادة من ملف نسخة احتياطية">
        <Alert tone="danger">تستبدل الاستعادة <b>كل</b> البيانات الحالية في هذا البرنامج ببيانات الملف (تتم في عملية واحدة: إن فشلت لا يتغير شيء). بعدها يصبح اسم المستخدم وكلمة المرور كما كانا في النسخة، وستحتاج لتسجيل الدخول من جديد.</Alert>
        <ActionForm action={restoreUploadAction} encType="multipart/form-data" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="backup">ملف النسخة الاحتياطية (erasa-backup-….json)</label><input id="backup" name="backup" type="file" accept="application/json,.json" className="input" required /></div>
          <div><label className="label" htmlFor="confirm-restore">للتأكيد اكتب: استبدال</label><input id="confirm-restore" name="confirm" className="input" autoComplete="off" required /></div>
          <div className="sm:col-span-2">
            <ConfirmButton title="استعادة النسخة الاحتياطية" message="سيتم حذف كل البيانات الحالية واستبدالها ببيانات الملف. هل أنت متأكد؟" confirmText="نعم، استبدل البيانات">استعادة البيانات من الملف</ConfirmButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="تصدير البيانات (CSV متوافق مع Excel)">
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map(([k, v]) => <a key={k} href={`/api/export/${k}`} className="btn btn-secondary btn-sm">⬇ {v}</a>)}
        </div>
      </Section>

      <Section title="فحص سلامة البيانات">
        <ActionForm action={integrityAction}>
          <p className="mb-2 text-sm text-stone-600">يفحص ملف قاعدة البيانات (PRAGMA integrity_check) ويطابق رصيد كل صنف مع مجموع حركات المخزون.</p>
          <SubmitButton className="btn btn-secondary">تشغيل الفحص</SubmitButton>
        </ActionForm>
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="الفئات">
          {(["ITEM", "EXPENSE", "INCOME"] as const).map((kind) => (
            <div key={kind} className="mb-4">
              <h3 className="mb-1 text-sm font-semibold">{KIND_LABEL[kind]}</h3>
              <ul className="space-y-1">
                {categories.filter((c) => c.kind === kind).map((c) => (
                  <li key={c.id}>
                    <ActionForm action={renameCategoryAction} showSuccess={false} className="flex gap-1">
                      <input type="hidden" name="id" value={c.id} />
                      <input name="name" defaultValue={c.name} className="input py-1 text-sm" aria-label="اسم الفئة" />
                      <SubmitButton className="btn btn-secondary btn-sm">حفظ</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
              <ActionForm action={addCategoryAction} className="mt-2 flex gap-1" resetOnSuccess>
                <input type="hidden" name="kind" value={kind} />
                <input name="name" className="input py-1 text-sm" placeholder="فئة جديدة" aria-label={`فئة جديدة — ${KIND_LABEL[kind]}`} required />
                <SubmitButton className="btn btn-primary btn-sm">إضافة</SubmitButton>
              </ActionForm>
            </div>
          ))}
        </Section>
        <div className="space-y-5">
          <Section title="وحدات القياس">
            <p className="mb-2 text-sm text-stone-600">{units.map((u) => u.name).join("، ")}</p>
            <ActionForm action={addUnitAction} className="flex gap-1" resetOnSuccess>
              <input name="name" className="input" placeholder="وحدة جديدة" aria-label="وحدة جديدة" required />
              <SubmitButton className="btn btn-primary btn-sm">إضافة</SubmitButton>
            </ActionForm>
          </Section>
          <Section title="كلمة المرور والجلسات">
            <ActionForm action={changePasswordAction} className="space-y-3" resetOnSuccess>
              <div><label className="label" htmlFor="current">كلمة المرور الحالية</label><input id="current" name="current" type="password" className="input" autoComplete="current-password" required dir="ltr" /></div>
              <div><label className="label" htmlFor="next">كلمة المرور الجديدة (8 أحرف على الأقل، أرقام وحروف)</label><input id="next" name="next" type="password" className="input" autoComplete="new-password" required dir="ltr" /></div>
              <div><label className="label" htmlFor="confirm">تأكيد كلمة المرور الجديدة</label><input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" required dir="ltr" /></div>
              <SubmitButton>تغيير كلمة المرور</SubmitButton>
            </ActionForm>
            <ActionForm action={logoutEverywhereAction} className="mt-4">
              <ConfirmButton className="btn btn-secondary" title="الخروج من كل الأجهزة" message="سيتم إنهاء كل الجلسات المفتوحة (الهاتف والحاسوب) وستحتاج لتسجيل الدخول من جديد." confirmText="خروج">تسجيل الخروج من كل الأجهزة</ConfirmButton>
            </ActionForm>
          </Section>
        </div>
      </div>

      <Section title="سجل التدقيق (آخر 50 عملية)">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الوقت</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{formatDateTime(l.createdAt)}</td>
                  <td className="font-mono text-xs" dir="ltr">{l.action}</td>
                  <td className="text-xs" dir="ltr">{l.entityType}{l.entityId ? ` #${l.entityId}` : ""}</td>
                  <td className="max-w-md truncate font-mono text-xs" dir="ltr" title={l.details ?? ""}>{l.details ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
