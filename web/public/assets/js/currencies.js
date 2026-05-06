// Lista estática de monedas soportadas (ISO 4217).
// Podemos ampliar libremente; el display usa Intl.NumberFormat que conoce todas las ISO válidas.

export const CURRENCIES = [
  { code: "EUR", label: "Euro (€)",               locale: "es-ES" },
  { code: "USD", label: "US Dollar ($)",           locale: "en-US" },
  { code: "COP", label: "Peso colombiano ($)",     locale: "es-CO" },
  { code: "GBP", label: "Libra esterlina (£)",     locale: "en-GB" },
  { code: "MXN", label: "Peso mexicano ($)",       locale: "es-MX" },
  { code: "ARS", label: "Peso argentino ($)",      locale: "es-AR" },
  { code: "CLP", label: "Peso chileno ($)",        locale: "es-CL" },
  { code: "PEN", label: "Sol peruano (S/)",        locale: "es-PE" },
  { code: "BRL", label: "Real brasileño (R$)",     locale: "pt-BR" },
  { code: "CHF", label: "Franco suizo (CHF)",      locale: "de-CH" },
  { code: "JPY", label: "Yen japonés (¥)",         locale: "ja-JP" },
  { code: "CNY", label: "Yuan chino (¥)",          locale: "zh-CN" },
  { code: "CAD", label: "Dólar canadiense (C$)",   locale: "en-CA" },
  { code: "AUD", label: "Dólar australiano (A$)",  locale: "en-AU" },
];

export const DEFAULT_CURRENCY = "EUR";

const byCode = Object.fromEntries(CURRENCIES.map(c => [c.code, c]));

export function localeFor(code) {
  return byCode[code]?.locale || "es-ES";
}

// Formato largo (ej. 1.234,56 €)
export function formatCurrency(amount, code = DEFAULT_CURRENCY, options = {}) {
  const locale = localeFor(code);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: options.maxFraction ?? 2,
  }).format(amount);
}

// Formato corto (sin decimales)
export function formatCurrencyShort(amount, code = DEFAULT_CURRENCY) {
  return formatCurrency(amount, code, { maxFraction: 0 });
}
