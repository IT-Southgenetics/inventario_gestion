"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/database";
import { isMultiCountryUserProfile } from "@/lib/multi-country-user";

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return {
      error: "Email y contraseña son requeridos",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      error: error.message,
    };
  }

  if (data.user) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }
}

export async function inviteUser(formData: FormData) {
  const email = formData.get("email") as string;
  const role = formData.get("role") as UserRole;
  const countryCode = formData.get("country_code") as string | null;

  if (!email || !role) {
    return {
      error: "Email y rol son requeridos",
    };
  }

  // Verificar que el usuario actual es ADMIN
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "No autenticado",
    };
  }

  // Obtener el perfil del usuario actual
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, organization_id, country_code, email")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return {
      error: "Error al obtener perfil de usuario",
    };
  }

  if (profile.role !== "ADMIN") {
    return {
      error: "Solo los administradores pueden invitar usuarios",
    };
  }

  // Determinar el country_code a usar
  // Admins (y nvila legacy) pueden elegir país al invitar; el resto hereda su país
  let finalCountryCode: string;
  const isMultiCountry = isMultiCountryUserProfile(profile);
  
  if (isMultiCountry && countryCode) {
    // Usuario multi-país puede especificar el país
    finalCountryCode = countryCode;
  } else if (isMultiCountry && !countryCode) {
    // Si es multi-país pero no especificó país, usar MX por defecto
    finalCountryCode = "MX";
  } else {
    // Usuario normal usa su propio país
    finalCountryCode = profile.country_code || "MX";
  }

  // Validar que el país sea válido
  if (!["MX", "UY", "AR"].includes(finalCountryCode)) {
    return {
      error: "País inválido. Solo se permiten MX, UY o AR",
    };
  }

  // Invitar usuario usando el cliente admin
  // Configurar la URL de redirect para el flujo de token_hash (OTP)
  // Supabase enviará el email con token_hash que será procesado por /auth/confirm
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/confirm?next=/update-password&type=invite`;
  
  const { data: invitedUser, error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        organization_id: profile.organization_id,
        role: role,
        country_code: finalCountryCode,
      },
      redirectTo: redirectTo,
    });

  if (inviteError) {
    return {
      error: inviteError.message,
    };
  }

  // Insertar perfil manualmente con la organización, rol y país correctos
  if (invitedUser.user) {
    const { error: insertError } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: invitedUser.user.id,
        email: email,
        organization_id: profile.organization_id,
        role: role,
        country_code: finalCountryCode,
      });

    if (insertError) {
      // Si el perfil ya existe (por el trigger), actualizarlo
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          organization_id: profile.organization_id,
          role: role,
          country_code: finalCountryCode,
        })
        .eq("id", invitedUser.user.id);

      if (updateError) {
        return {
          error: "Error al crear/actualizar perfil: " + updateError.message,
        };
      }
    }
  }

  revalidatePath("/dashboard/users");
  return {
    success: true,
    message: "Invitación enviada correctamente",
  };
}

export async function updatePassword(formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    return {
      error: "Ambas contraseñas son requeridas",
    };
  }

  if (password !== confirmPassword) {
    return {
      error: "Las contraseñas no coinciden",
    };
  }

  if (password.length < 6) {
    return {
      error: "La contraseña debe tener al menos 6 caracteres",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.updateUser({
    password: password,
  });

  if (error) {
    return {
      error: error.message,
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

// Alias para mantener compatibilidad
export const signOutAction = signOut;

