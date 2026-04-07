// Constantes y utilidades compartidas de países

export interface Country {
  code: string;
  name: string;
  flagUrl: string;
  currency: string;
  currencySymbol: string;
  taxIdLabel: string;
  taxIdPlaceholder: string;
}

export const COUNTRIES: Country[] = [
  {
    code: "MX",
    name: "México",
    flagUrl: "https://flagcdn.com/w20/mx.png",
    currency: "MXN",
    currencySymbol: "$",
    taxIdLabel: "RFC",
    taxIdPlaceholder: "Ej: XAXX010101000",
  },
  {
    code: "UY",
    name: "Uruguay",
    flagUrl: "https://flagcdn.com/w20/uy.png",
    currency: "UYU",
    currencySymbol: "$",
    taxIdLabel: "RUT",
    taxIdPlaceholder: "Ej: 211234560015",
  },
  {
    code: "AR",
    name: "Argentina",
    flagUrl: "https://flagcdn.com/w20/ar.png",
    currency: "ARS",
    currencySymbol: "$",
    taxIdLabel: "CUIT",
    taxIdPlaceholder: "Ej: 20-12345678-9",
  },
];

export const VALID_COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export function getCountry(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function getTaxIdLabel(countryCode: string): string {
  return getCountry(countryCode)?.taxIdLabel ?? "ID Fiscal";
}

export function getTaxIdPlaceholder(countryCode: string): string {
  return getCountry(countryCode)?.taxIdPlaceholder ?? "";
}

export function getCurrencySymbol(countryCode: string): string {
  return getCountry(countryCode)?.currencySymbol ?? "$";
}

export function getCurrency(countryCode: string): string {
  return getCountry(countryCode)?.currency ?? "USD";
}

// Formateador de moneda ARS con separadores argentinos
export function formatARS(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount);
}

// Cálculo de impuestos para Argentina
export const AR_TAXES = {
  impuestoPAIS: 0.30,         // 30%
  percepcionGanancias: 0.03,  // 3%
};

export function calcularImpuestoPAIS(base: number): number {
  return base * AR_TAXES.impuestoPAIS;
}

export function calcularPercepcionGanancias(base: number): number {
  return base * AR_TAXES.percepcionGanancias;
}

// Formateador de CUIT: convierte "20123456789" → "20-12345678-9"
export function formatCUIT(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10, 11)}`;
}
