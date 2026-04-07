"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Building2,
  Mail,
  Phone,
  Edit,
  Trash2,
  MoreHorizontal,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupplier } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import { getTaxIdLabel, getTaxIdPlaceholder, formatCUIT } from "@/lib/countries";
import toast from "react-hot-toast";
import type { Supplier } from "@/types/database";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countryCode, setCountryCode] = useState<string>("MX");
  const [taxIdValue, setTaxIdValue] = useState("");

  useEffect(() => {
    loadSuppliers();
  }, []);

  async function loadSuppliers() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("No autenticado");
      setIsLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (!profile) {
      setIsLoading(false);
      return;
    }

    const currentCountry = profile.country_code || "MX";
    setCountryCode(currentCountry);

    const { data: suppliersData, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", currentCountry)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error al cargar proveedores:", error);
      toast.error("Error al cargar proveedores: " + error.message);
      setIsLoading(false);
      return;
    }

    setSuppliers(suppliersData || []);
    setIsLoading(false);
  }

  async function handleCreateSupplier(formData: FormData) {
    setIsSubmitting(true);
    const result = await createSupplier(formData);

    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || "Proveedor creado correctamente");
      setIsDialogOpen(false);
      setIsSubmitting(false);
      setTaxIdValue("");
      await loadSuppliers();
    }
  }

  // Formatear tax_id según el país al escribir
  function handleTaxIdChange(value: string) {
    if (countryCode === "AR") {
      setTaxIdValue(formatCUIT(value));
    } else {
      setTaxIdValue(value);
    }
  }

  const taxIdLabel = getTaxIdLabel(countryCode);
  const taxIdPlaceholder = getTaxIdPlaceholder(countryCode);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Proveedores</h1>
          <p className="text-slate-600 mt-1">
            Gestiona tus proveedores y laboratorios
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setTaxIdValue("");
        }}>
          <DialogTrigger asChild>
            <Button className="bg-teal-600 hover:bg-teal-700">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Proveedor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar Proveedor</DialogTitle>
              <DialogDescription>
                Ingresa la información del nuevo proveedor o laboratorio.
              </DialogDescription>
            </DialogHeader>
            <form action={handleCreateSupplier}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nombre *</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Ej: Laboratorio XYZ"
                    required
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contact_email">Email de Contacto</Label>
                  <Input
                    id="contact_email"
                    name="contact_email"
                    type="email"
                    placeholder="contacto@proveedor.com"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="+1 234 567 8900"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tax_id">{taxIdLabel}</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="tax_id"
                      name="tax_id"
                      placeholder={taxIdPlaceholder}
                      disabled={isSubmitting}
                      className="pl-9"
                      value={taxIdValue}
                      onChange={(e) => handleTaxIdChange(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="bg-teal-600 hover:bg-teal-700"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Guardando..." : "Guardar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Tabla de Proveedores */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Lista de Proveedores</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">
                Cargando proveedores...
              </div>
            ) : suppliers.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-700 mb-2">
                  No hay proveedores
                </h3>
                <p className="text-slate-500 mb-6">
                  Comienza agregando tu primer proveedor
                </p>
                <Button
                  onClick={() => setIsDialogOpen(true)}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Proveedor
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Teléfono</TableHead>
                      <TableHead>{taxIdLabel}</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suppliers.map((supplier) => (
                      <TableRow key={supplier.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-teal-600" />
                            <span className="font-medium">{supplier.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {supplier.contact_email ? (
                            <div className="flex items-center gap-2 text-slate-600">
                              <Mail className="h-4 w-4" />
                              {supplier.contact_email}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {supplier.phone ? (
                            <div className="flex items-center gap-2 text-slate-600">
                              <Phone className="h-4 w-4" />
                              {supplier.phone}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {supplier.tax_id ? (
                            <div className="flex items-center gap-2 text-slate-600">
                              <Hash className="h-4 w-4" />
                              {supplier.tax_id}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Abrir menú</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem>
                                <Edit className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-red-600">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
