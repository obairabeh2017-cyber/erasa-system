// تسميات عربية لقيم الحالة والأنواع
export const ITEM_TYPE: Record<string, string> = { RAW: "مادة خام", FINISHED: "منتج تام" };

export const DOC_STATUS: Record<string, string> = {
  DRAFT: "مسودة",
  POSTED: "مُرحّل",
  VOIDED: "ملغى",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغى",
  REVERSED: "معكوس",
};

export const MOVEMENT_TYPE: Record<string, string> = {
  OPENING: "رصيد افتتاحي",
  PURCHASE: "مشتريات",
  PURCHASE_VOID: "إلغاء مشتريات",
  PRODUCTION_CONSUME: "استهلاك إنتاج",
  PRODUCTION_OUTPUT: "إنتاج تام",
  PRODUCTION_CONSUME_REVERSAL: "عكس استهلاك إنتاج",
  PRODUCTION_OUTPUT_REVERSAL: "عكس إنتاج تام",
  SALE: "مبيعات",
  SALE_VOID: "إلغاء مبيعات",
  SALE_RETURN: "مرتجع مبيعات",
  ADJUSTMENT: "تسوية",
};

export const PAYMENT_KIND: Record<string, string> = {
  SALE_RECEIPT: "تحصيل فاتورة بيع",
  CUSTOMER_PAYMENT: "دفعة من زبون",
  PURCHASE_PAYMENT: "سداد فاتورة شراء",
  SUPPLIER_PAYMENT: "دفعة لمورّد",
  EXPENSE_PAYMENT: "سداد مصروف",
  OTHER_INCOME: "إيراد آخر",
  EMPLOYEE: "حركة موظف",
  SALE_REFUND: "رد مبلغ لزبون",
  TRANSFER: "تحويل بين الحسابات",
};

export const PAYMENT_METHOD: Record<string, string> = {
  CASH: "نقداً",
  BANK_TRANSFER: "تحويل مصرفي",
  CHEQUE: "صك",
  CARD: "بطاقة",
  OTHER: "أخرى",
};

export const DIRECTION: Record<string, string> = { IN: "قبض", OUT: "صرف" };

export const ACCOUNT_TYPE: Record<string, string> = { CASH: "خزينة نقدية", BANK: "حساب مصرفي" };

export const EMP_TXN: Record<string, string> = {
  SALARY_DUE: "راتب مستحق",
  BONUS: "مكافأة",
  DEDUCTION: "خصم",
  ADVANCE: "سلفة",
  ADVANCE_REPAYMENT: "سداد سلفة",
  SALARY_PAYMENT: "صرف راتب",
  EXPENSE_ON_BEHALF: "مصروف دفعه الموظف عن الشركة",
  REIMBURSEMENT: "تعويض مصروف للموظف",
};

export const REMINDER_TYPE: Record<string, string> = {
  CUSTOM: "مخصص",
  DEBT_DUE_SOON: "دين يقترب موعده",
  DEBT_OVERDUE: "دين متأخر",
  SALARY: "رواتب",
  RECURRING_EXPENSE: "مصروف دوري",
  LOW_STOCK: "مخزون منخفض",
  MONTHLY_REPORT: "تقرير شهري",
};

export const RECURRENCE: Record<string, string> = {
  NONE: "مرة واحدة",
  WEEKLY: "أسبوعي",
  MONTHLY: "شهري",
  YEARLY: "سنوي",
};

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key;
}
