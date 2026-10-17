// تمثيل المال والكميات بأعداد صحيحة فقط.
//   المال: درهم (1 دينار ليبي = 1000 درهم)
//   الكمية: جزء من الألف من الوحدة
// لا تُستخدم الأعداد العشرية العائمة في أي عملية حسابية مالية.

export const SCALE = 1000;
export const CURRENCY_LABEL = "د.ل";

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** يحوّل نصاً عشرياً (مثل "1,234.5" أو "١٢٫٥") إلى عدد صحيح مضروب في 10^scaleDigits. يعيد null إذا كان غير صالح. */
export function parseDecimal(input: unknown, scaleDigits = 3): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (s === "") return null;
  s = s.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
  s = s.replace(/٫/g, ".").replace(/[,،٬\s]/g, "");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const [, neg, intPart = "", fracPart = ""] = m;
  if (intPart === "" && fracPart === "") return null;
  if (fracPart.length > scaleDigits) return null;
  const digits = (intPart || "0") + fracPart.padEnd(scaleDigits, "0");
  const value = Number(digits.replace(/^0+(?=\d)/, ""));
  if (!Number.isSafeInteger(value)) return null;
  return neg ? -value : value;
}

/** (a × b) ÷ c بتقريب نصف لأعلى (بعيداً عن الصفر) دون فقدان الدقة. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new Error("division by zero");
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const neg = (num < BigInt(0)) !== (den < BigInt(0));
  const an = num < BigInt(0) ? -num : num;
  const ad = den < BigInt(0) ? -den : den;
  const q = (an * BigInt(2) + ad) / (ad * BigInt(2));
  const r = Number(q);
  return neg ? -r : r;
}

/** قيمة سطر = الكمية (×1000) × سعر الوحدة (درهم) ÷ 1000 */
export function lineAmount(qty: number, unitPrice: number): number {
  return mulDiv(qty, unitPrice, SCALE);
}

/** سعر/تكلفة الوحدة من قيمة إجمالية وكمية. */
export function unitCostOf(value: number, qty: number): number {
  if (qty === 0) return 0;
  return mulDiv(value, SCALE, qty);
}

function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatScaled(value: number, minFrac: number, maxFrac = 3): string {
  const neg = value < 0;
  const abs = Math.abs(Math.trunc(value));
  const intPart = Math.floor(abs / SCALE);
  let frac = String(abs % SCALE).padStart(3, "0").slice(0, maxFrac);
  while (frac.length > minFrac && frac.endsWith("0")) frac = frac.slice(0, -1);
  const out = groupThousands(String(intPart)) + (frac ? "." + frac : "");
  return neg ? "-" + out : out;
}

/** تنسيق مبلغ بالدرهم: 1234500 → "1,234.50" */
export function formatMoney(dirhams: number | null | undefined, withCurrency = true): string {
  const v = formatScaled(dirhams ?? 0, 2);
  return withCurrency ? `${v} ${CURRENCY_LABEL}` : v;
}

/** تنسيق كمية: 2500 → "2.5" */
export function formatQty(milli: number | null | undefined): string {
  return formatScaled(milli ?? 0, 0);
}

/** قيمة لحقل إدخال (بدون فواصل الآلاف). */
export function toInputDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return formatScaled(value, 0).replace(/,/g, "");
}

export function formatPercentBp(bp: number): string {
  return formatScaled(bp * 10, 0) + "%";
}

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/** يوزّع مبلغاً على أوزان بنسبها، ويضمن أن يساوي المجموع المبلغ تماماً. */
export function distribute(total: number, weights: number[]): number[] {
  const wsum = sum(weights);
  if (weights.length === 0) return [];
  if (wsum === 0) {
    const out = weights.map(() => 0);
    out[out.length - 1] = total;
    return out;
  }
  const out: number[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) out.push(total - used);
    else {
      const part = mulDiv(total, w, wsum);
      out.push(part);
      used += part;
    }
  });
  return out;
}
