import { normalizeRuPhone } from "@gsk-tower/contracts";

export const PHONE_PLACEHOLDER = "+7 (___) ___-__-__";
export const PHONE_INCOMPLETE_MESSAGE = "Введите номер полностью: +7 или 8 и 10 цифр";
export const PHONE_REQUIRED_MESSAGE = "Укажите телефон";

export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  let normalized = digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
  if (!normalized.startsWith("7")) normalized = `7${normalized}`;
  normalized = normalized.slice(0, 11);

  const p = normalized.slice(1);
  let out = "+7";
  if (p.length > 0) out += ` (${p.slice(0, 3)}`;
  if (p.length >= 3) out += ")";
  if (p.length > 3) out += ` ${p.slice(3, 6)}`;
  if (p.length > 6) out += `-${p.slice(6, 8)}`;
  if (p.length > 8) out += `-${p.slice(8, 10)}`;
  return out;
}

export function phoneInputError(value: string, required = false): string {
  const trimmed = value.trim();
  if (!trimmed) return required ? PHONE_REQUIRED_MESSAGE : "";
  if (!required && !looksLikeRuPhoneDraft(trimmed)) {
    return looksLikeGenericPhone(trimmed) ? "" : PHONE_INCOMPLETE_MESSAGE;
  }
  return normalizeRuPhone(trimmed) ? "" : PHONE_INCOMPLETE_MESSAGE;
}

function looksLikeRuPhoneDraft(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return value.startsWith("+7") || digits.startsWith("7") || digits.startsWith("8");
}

function looksLikeGenericPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^[+\d\s().-]+$/.test(value) && digits.length >= 6;
}
