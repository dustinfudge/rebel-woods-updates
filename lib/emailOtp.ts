export function normalizeEmailAddress(emailAddress: string): string {
  return emailAddress.trim().toLowerCase();
}

export function normalizeEmailOneTimeCode(code: string): string {
  return code.replace(/\D/g, "").slice(0, 8);
}

export function isValidEmailOneTimeCode(code: string): boolean {
  return /^\d{6,8}$/.test(code);
}
