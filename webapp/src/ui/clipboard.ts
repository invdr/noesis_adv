/**
 * Копирование в буфер с фолбэком: прод развёрнут по голому IP без TLS, а
 * `navigator.clipboard` доступен только в secure context (https/localhost) —
 * иначе кнопка молча ничего не делала бы.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Падаем в legacy-фолбэк ниже.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
