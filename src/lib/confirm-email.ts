/** Set for a minute after an account is deleted, so the sign-in page can say so. */
export const DELETED_COOKIE = "jf-account-deleted";

/** The typed confirmation matches the account's email (case and surrounding spaces aside). */
export function confirmsEmail(typed: string, email: string | null | undefined): boolean {
  const want = email?.trim().toLowerCase();
  return Boolean(want) && typed.trim().toLowerCase() === want;
}
