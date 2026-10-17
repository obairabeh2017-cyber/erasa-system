import type { Report } from "@/lib/services/reports";
import { Money, Qty, Section, Alert, Badge } from "@/components/ui";
import { formatDate } from "@/lib/dates";

function Row({ label, value, strong, note }: { label: string; value: number; strong?: boolean; note?: string }) {
  return (
    <tr className={strong ? "bg-stone-50 font-bold" : ""}>
      <td>{label}{note && <div className="text-xs font-normal text-stone-500">{note}</div>}</td>
      <td className="text-end"><Money value={value} /></td>
    </tr>
  );
}

/** عرض التقرير — يفصل بوضوح بين المبيعات والمقبوضات، والمشتريات والمصروفات، وقيمة المخزون وتكلفة المواد المستهلكة. */
export function ReportView({ r, title }: { r: Report; title: string }) {
  const end = new Date(new Date(r.period.end).getTime() - 1);
  return (
    <div className="space-y-5">
      <div className="hidden text-center print:block">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="text-sm">من {formatDate(new Date(r.period.start))} إلى {formatDate(end)}</div>
      </div>
      <Alert tone="warn">
        «إجمالي الربح التقديري» يُحسب من تكلفة المواد الخام فقط، ولا يشمل العمالة المباشرة أو التكاليف غير المباشرة؛ وهو ليس صافي ربح مدققاً.
        {(r.sales.excludedDrafts > 0 || r.sales.excludedVoided > 0 || r.purchases.excludedDrafts > 0 || r.purchases.excludedVoided > 0 || r.expenses.excludedVoided > 0) && (
          <> مستبعد من الإجماليات: مبيعات (مسودة {r.sales.excludedDrafts}، ملغاة {r.sales.excludedVoided})، مشتريات (مسودة {r.purchases.excludedDrafts}، ملغاة {r.purchases.excludedVoided})، مصروفات ملغاة {r.expenses.excludedVoided}.</>
        )}
      </Alert>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="المبيعات والربح التقديري">
          <table className="table"><tbody>
            <Row label="إجمالي المبيعات قبل الخصم" value={r.sales.grossSales} />
            <Row label="خصومات المبيعات" value={r.sales.discounts} />
            <Row label="المبيعات المُرحّلة" value={r.sales.total} note={`${r.sales.count} فاتورة`} />
            <Row label="مرتجعات المبيعات" value={r.sales.returns} />
            <Row label="صافي المبيعات" value={r.sales.net} strong />
            <Row label="تكلفة المواد للمبيعات (لقطة وقت البيع)" value={r.cogs} />
            <Row label="إجمالي الربح التقديري" value={r.grossProfit} strong />
            <Row label="إيرادات أخرى" value={r.otherIncome} />
            <Row label="المصروفات التشغيلية" value={r.expenses.operating} />
            <Row label="مصروف الرواتب (مستحقات + مكافآت − خصومات)" value={r.expenses.salaries} />
            <Row label="النتيجة التشغيلية التقديرية" value={r.estimatedOperatingResult} strong note="غير مدققة — لا تشمل الإهلاك أو تكاليف أخرى غير مسجلة" />
          </tbody></table>
        </Section>
        <Section title="النقدية الفعلية (المقبوضات والمدفوعات)">
          <table className="table"><tbody>
            <Row label="مقبوضات من الزبائن" value={r.receipts.fromCustomers} />
            <Row label="مقبوضات إيرادات أخرى" value={r.receipts.otherIncome} />
            <Row label="مقبوضات من الموظفين (سداد سلف)" value={r.receipts.employees} />
            <Row label="إجمالي المقبوضات" value={r.receipts.total} strong />
            <Row label="مدفوعات للموردين" value={r.disbursements.suppliers} />
            <Row label="سداد مصروفات" value={r.disbursements.expenses} />
            <Row label="مدفوعات للموظفين (رواتب، سلف، تعويضات)" value={r.disbursements.employees} />
            <Row label="مبالغ مردودة للزبائن" value={r.disbursements.refunds} />
            <Row label="إجمالي المدفوعات" value={r.disbursements.total} strong />
            <Row label="صافي التدفق النقدي" value={r.receipts.total - r.disbursements.total} strong />
          </tbody></table>
          <p className="mt-2 text-xs text-stone-500">التحويلات بين الحسابات مستبعدة. المبيعات الآجلة لا تظهر هنا حتى تُحصّل.</p>
        </Section>
        <Section title="المشتريات والإنتاج">
          <table className="table"><tbody>
            <Row label="مشتريات المواد المُرحّلة" value={r.purchases.total} note={`${r.purchases.count} فاتورة — المشتريات تزيد المخزون وليست مصروفاً`} />
            <Row label="خصومات المشتريات" value={r.purchases.discounts} />
            <Row label="تكلفة المواد المستهلكة في الإنتاج" value={r.materialConsumptionCost} strong />
          </tbody></table>
          {r.production.length > 0 && (
            <div className="table-wrap mt-3">
              <table className="table">
                <thead><tr><th>المنتج</th><th>عدد الأوامر</th><th>الكمية المنتجة</th><th>تكلفة المواد</th></tr></thead>
                <tbody>{r.production.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.orders}</td><td><Qty value={p.qty} unit={p.unit} /></td><td><Money value={p.cost} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Section>
        <Section title="الأرصدة في نهاية الفترة">
          <table className="table"><tbody>
            <Row label="ديون الزبائن القائمة" value={r.debts.customer} />
            <Row label="ديون الموردين القائمة" value={r.debts.supplier} />
            <Row label="مصروفات غير مسددة" value={r.debts.unpaidExpenses} />
            {r.cash.map((c) => <Row key={c.id} label={`رصيد: ${c.name}`} value={c.balance} />)}
            <Row label="إجمالي النقدية" value={r.cashTotal} strong />
            <Row label="قيمة مخزون المواد الخام (بالتكلفة)" value={r.stock.rawValue} />
            <Row label="قيمة مخزون المنتجات التامة (بتكلفة المواد)" value={r.stock.finishedValue} />
          </tbody></table>
        </Section>
      </div>

      {r.expenses.byCategory.length > 0 && (
        <Section title="المصروفات حسب الفئة">
          <table className="table"><tbody>{r.expenses.byCategory.map((c) => <Row key={c.name} label={c.name} value={c.amount} />)}</tbody></table>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="مخزون المواد الخام">
          <StockTable rows={r.stock.raw} />
        </Section>
        <Section title="مخزون المنتجات التامة">
          <StockTable rows={r.stock.finished} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="الديون المتأخرة">
          {r.debts.overdue.length === 0 ? <p className="text-sm text-stone-500">لا توجد.</p> : (
            <table className="table"><thead><tr><th>المستند</th><th>الطرف</th><th>المتبقي</th><th>التأخير</th></tr></thead>
              <tbody>{r.debts.overdue.map((d) => <tr key={d.docNumber}><td dir="ltr" className="text-end font-mono">{d.docNumber}</td><td>{d.partyName}</td><td><Money value={d.remaining} /></td><td><Badge tone="red">{d.overdueDays} يوم</Badge></td></tr>)}</tbody>
            </table>
          )}
        </Section>
        <Section title="أصناف منخفضة المخزون (حالياً)">
          {r.lowStock.length === 0 ? <p className="text-sm text-stone-500">لا توجد.</p> : (
            <table className="table"><thead><tr><th>الصنف</th><th>الرصيد</th><th>الحد الأدنى</th></tr></thead>
              <tbody>{r.lowStock.map((i) => <tr key={i.id}><td>{i.name}</td><td><Qty value={i.qty} unit={i.unit} /></td><td><Qty value={i.minStock} /></td></tr>)}</tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

function StockTable({ rows }: { rows: Report["stock"]["raw"] }) {
  if (rows.length === 0) return <p className="text-sm text-stone-500">لا توجد أصناف.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>القيمة</th></tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id}><td>{s.name}</td><td><Qty value={s.qty} unit={s.unit} /></td><td><Money value={s.value} /></td></tr>)}</tbody>
      </table>
    </div>
  );
}
