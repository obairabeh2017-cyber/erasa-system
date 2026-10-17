import { PAYMENT_METHOD } from "@/lib/labels";

/** حقول الدفع/القبض: الحساب، المبلغ، الطريقة، المرجع. */
export function PaymentFields({
  accounts,
  amountLabel = "المبلغ",
  amountName = "payAmount",
  defaultAmount = "",
  prefix = "pay",
  requireAmount = false,
  showAmount = true,
}: {
  accounts: { id: number; name: string }[];
  amountLabel?: string;
  amountName?: string;
  defaultAmount?: string;
  prefix?: string;
  requireAmount?: boolean;
  showAmount?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {showAmount && (
        <div>
          <label className="label" htmlFor={`${prefix}-amount`}>{amountLabel}</label>
          <input id={`${prefix}-amount`} name={amountName} className="input" inputMode="decimal" dir="ltr" defaultValue={defaultAmount} required={requireAmount} placeholder="0" />
        </div>
      )}
      <div>
        <label className="label" htmlFor={`${prefix}-account`}>الحساب (خزينة/مصرف)</label>
        <select id={`${prefix}-account`} name="accountId" className="input">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${prefix}-method`}>طريقة الدفع</label>
        <select id={`${prefix}-method`} name="method" className="input">
          {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${prefix}-ref`}>المرجع (رقم صك/حوالة)</label>
        <input id={`${prefix}-ref`} name="reference" className="input" />
      </div>
    </div>
  );
}
