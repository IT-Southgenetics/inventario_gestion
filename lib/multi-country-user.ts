import type { UserRole } from "@/types/database";

/**
 * Usuarios que pueden cambiar de contexto MX/UY (sidebar, invitaciones, etc.).
 * Antes solo nvila@southgenetics.com; ahora cualquier ADMIN.
 */
export function isMultiCountryUserProfile(profile: {
  email?: string | null;
  role?: UserRole | string | null;
}): boolean {
  return (
    profile.role === "ADMIN" ||
    profile.email === "nvila@southgenetics.com"
  );
}
