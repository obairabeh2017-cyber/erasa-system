/** خطأ في قواعد العمل — رسالته عربية وتُعرض للمستخدم كما هي. */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BusinessError(message);
}
