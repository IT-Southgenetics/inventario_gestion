import { createClient } from "@/lib/supabase/server";
import { isMultiCountryUserProfile } from "@/lib/multi-country-user";

/**
 * Obtiene el country_code del usuario actual
 * Para el usuario multi-país, retorna el country_code seleccionado en su perfil
 */
export async function getUserCountryCode(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, country_code")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return null;
  }

  // Retornar el country_code del perfil (incluso para usuario multi-país)
  return profile.country_code || "MX";
}

/**
 * Verifica si el usuario actual es multi-país
 */
export async function isMultiCountryUser(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, role")
    .eq("id", user.id)
    .single();

  return profile ? isMultiCountryUserProfile(profile) : false;
}

/**
 * Obtiene el country_code del usuario actual para usar en queries
 * Ahora siempre retorna el country_code del perfil (incluso para usuario multi-país)
 */
export async function getCountryCodeForQuery(): Promise<string | null> {
  return await getUserCountryCode();
}
