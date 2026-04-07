import { getCountry } from "@/lib/countries";

interface CountryFlagProps {
  countryCode: string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}

const SIZE_MAP = {
  sm: { width: 16, height: 12 },
  md: { width: 20, height: 15 },
  lg: { width: 24, height: 18 },
};

export function CountryFlag({
  countryCode,
  size = "md",
  showName = false,
  className = "",
}: CountryFlagProps) {
  const country = getCountry(countryCode);
  const { width, height } = SIZE_MAP[size];

  if (!country) {
    return <span className={className}>{countryCode}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <img
        src={country.flagUrl}
        alt={`Bandera de ${country.name}`}
        width={width}
        height={height}
        className="rounded-sm object-cover flex-shrink-0"
        style={{ width, height }}
      />
      {showName && <span>{country.name}</span>}
    </span>
  );
}
