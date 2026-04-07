"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { UserPlus, Mail, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { inviteUser } from "@/actions/auth";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import type { Profile } from "@/types/database";
import { isMultiCountryUserProfile } from "@/lib/multi-country-user";

export default function UsersPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<Profile[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [userRole, setUserRole] = useState<string>("VIEWER");
  const [isMultiCountry, setIsMultiCountry] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("No autenticado");
      setIsLoadingUsers(false);
      return;
    }

    // Obtener el organization_id, rol, email y country_code del usuario actual
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, role, email, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Error al obtener perfil:", profileError);
      toast.error("Error al obtener información del usuario");
      setIsLoadingUsers(false);
      return;
    }

    // Guardar el rol del usuario
    setUserRole(profile.role || "VIEWER");
    
    setIsMultiCountry(isMultiCountryUserProfile(profile));

    // Obtener usuarios de la misma organización y país
    // Si es usuario multi-país, mostrar solo usuarios del país seleccionado
    const countryCode = profile.country_code || "MX";
    const { data: orgUsers, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error al cargar usuarios:", error);
      toast.error("Error al cargar usuarios: " + error.message);
      setIsLoadingUsers(false);
      return;
    }

    // Asegurarse de que se muestren todos los usuarios encontrados
    console.log(`Usuarios encontrados en la organización: ${orgUsers?.length || 0}`);
    setUsers(orgUsers || []);
    setIsLoadingUsers(false);
  }

  async function handleInvite(formData: FormData) {
    setIsLoading(true);
    const result = await inviteUser(formData);

    if (result?.error) {
      toast.error(result.error);
    } else if (result?.success) {
      toast.success(result.message || "Invitación enviada correctamente");
      // Reset form
      const form = document.getElementById("invite-form") as HTMLFormElement;
      form?.reset();
      // Recargar usuarios
      await loadUsers();
    }

    setIsLoading(false);
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "ADMIN":
        return "destructive";
      case "MANAGER":
        return "default";
      default:
        return "secondary";
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold mb-2">Gestión de Usuarios</h1>
        <p className="text-muted-foreground">
          {userRole === "ADMIN" 
            ? "Invita usuarios a tu organización y gestiona sus roles"
            : "Visualiza los usuarios de tu organización"}
        </p>
      </motion.div>

      {/* Formulario de Invitación - Solo visible para ADMIN */}
      {userRole === "ADMIN" && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="shadow-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <CardTitle>Invitar Usuario</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <form id="invite-form" action={handleInvite} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email del Empleado</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="empleado@email.com"
                      required
                      className="pl-10"
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select name="role" required disabled={isLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar rol" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                      <SelectItem value="MANAGER">Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {isMultiCountry && (
                <div className="space-y-2">
                  <Label htmlFor="country_code">País</Label>
                  <Select name="country_code" required disabled={isLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar país" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MX">🇲🇽 México</SelectItem>
                      <SelectItem value="UY">🇺🇾 Uruguay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                type="submit"
                className="w-full md:w-auto"
                disabled={isLoading}
              >
                {isLoading ? "Enviando..." : "Enviar Invitación"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
      )}

      {/* Lista de Usuarios */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Usuarios de la Organización</CardTitle>
              {users.length > 0 && (
                <Badge variant="secondary" className="text-sm">
                  {users.length} {users.length === 1 ? "usuario" : "usuarios"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingUsers ? (
              <div className="text-center py-8 text-muted-foreground">
                Cargando usuarios...
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay usuarios en tu organización
              </div>
            ) : (
              <div className="space-y-3">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Shield className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold">{user.email}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(user.created_at).toLocaleDateString("es-ES", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </p>
                        {user.country_code && (
                          <p className="text-xs text-muted-foreground mt-1">
                            País: {user.country_code === "MX" ? "🇲🇽 México" : user.country_code === "UY" ? "🇺🇾 Uruguay" : user.country_code}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user.country_code && (
                        <Badge variant="outline" className="text-xs">
                          {user.country_code === "MX" ? "🇲🇽" : user.country_code === "UY" ? "🇺🇾" : user.country_code}
                        </Badge>
                      )}
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {user.role}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

