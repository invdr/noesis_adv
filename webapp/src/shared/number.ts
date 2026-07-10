export interface OptionalNumberParse {
  value: number | null;
  error: string | null;
}

export function parseOptionalNumberInput(input: string): OptionalNumberParse {
  const trimmed = input.trim();
  if (trimmed === "") return { value: null, error: null };
  const normalized = trimmed.replace(/[\s\u00a0]+/g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { value: null, error: "Введите число без букв и лишних символов" };
  }
  return { value, error: null };
}
