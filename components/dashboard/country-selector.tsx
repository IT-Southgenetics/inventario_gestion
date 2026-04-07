"use client";

import { useState, useEffect } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { isMultiCountryUserProfile } from "@/lib/multi-country-user";
import { useRouter } from "next/navigation";

const COUNTRIES = [
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "UY", name: "Uruguay", flag: "🇺🇾" },
];

export function CountrySelector() {
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [isMultiCountry, setIsMultiCountry] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function checkUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("email, country_code, role")
          .eq("id", user.id)
          .single();

        if (profile && isMultiCountryUserProfile(profile)) {
          setIsMultiCountry(true);
          // Obtener país seleccionado del localStorage o usar el país del perfil
          const savedCountry =
            localStorage.getItem("selected_country") || profile.country_code || "MX";
          setSelectedCountry(savedCountry);
        } else {
          setIsMultiCountry(false);
          setSelectedCountry(profile?.country_code || "MX");
        }
      }
    }

    checkUser();
  }, []);

  const handleCountryChange = async (countryCode: string) => {
    setSelectedCountry(countryCode);
    localStorage.setItem("selected_country", countryCode);

    // Actualizar el country_code en el perfil
    // Esto permite que las políticas RLS usen el país correcto para INSERT/UPDATE
    // Las políticas SELECT siguen permitiendo ver todos los países para este usuario
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ country_code: countryCode })
        .eq("id", user.id);

      if (error) {
        console.error("Error al actualizar país:", error);
        return;
      }

      // Recargar la página para aplicar los nuevos filtros
      router.refresh();
    }
  };

  if (!isMultiCountry) {
    return null; // No mostrar selector si no es usuario multi-país
  }

  const currentCountry = COUNTRIES.find((c) => c.code === selectedCountry);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 text-sm"
        >
          <Globe className="h-4 w-4" />
          <span className="flex-1 text-left">
            {currentCountry ? (
              <>
                <span className="mr-2">{currentCountry.flag}</span>
                {currentCountry.name}
              </>
            ) : (
              "Seleccionar país"
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {COUNTRIES.map((country) => (
          <DropdownMenuItem
            key={country.code}
            onClick={() => handleCountryChange(country.code)}
            className={selectedCountry === country.code ? "bg-teal-50" : ""}
          >
            <span className="mr-2">{country.flag}</span>
            {country.name}
            {selectedCountry === country.code && (
              <span className="ml-auto text-teal-600">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
