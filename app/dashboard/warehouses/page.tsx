"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Warehouse as WarehouseIcon, Edit, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createWarehouse, updateWarehouse, deleteWarehouse } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import type { Warehouse } from "@/types/database";

type WarehouseRow = Warehouse & { productsWithStock: number };

export default function WarehousesPage() {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadWarehouses = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("No autenticado");
      setIsLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      toast.error("Error al obtener información del usuario");
      setIsLoading(false);
      return;
    }

    const countryCode = profile.country_code || "MX";

    const { data: warehousesData, error } = await supabase
      .from("warehouses")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error al cargar almacenes:", error);
      toast.error("Error al cargar almacenes: " + error.message);
      setIsLoading(false);
      return;
    }

    const list = warehousesData || [];
    const ids = list.map((w) => w.id);

    let counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: stockRows } = await supabase
        .from("warehouse_stock")
        .select("warehouse_id, current_stock")
        .in("warehouse_id", ids)
        .gt("current_stock", 0);

      for (const r of stockRows || []) {
        counts[r.warehouse_id] = (counts[r.warehouse_id] || 0) + 1;
      }
    }

    setRows(
      list.map((w) => ({
        ...w,
        productsWithStock: counts[w.id] || 0,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadWarehouses();
  }, [loadWarehouses]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const result = await createWarehouse(formData);
    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }
    toast.success(result?.message || "Almacén creado");
    setCreateOpen(false);
    setIsSubmitting(false);
    (e.target as HTMLFormElement).reset();
    loadWarehouses();
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const result = await updateWarehouse(formData);
    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }
    toast.success(result?.message || "Almacén actualizado");
    setEditOpen(false);
    setEditing(null);
    setIsSubmitting(false);
    loadWarehouses();
  }

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    const result = await deleteWarehouse(deleting.id);
    if (result?.error) {
      toast.error(result.error);
      setIsDeleting(false);
      return;
    }
    toast.success(result?.message || "Almacén eliminado");
    setDeleteOpen(false);
    setDeleting(null);
    setIsDeleting(false);
    loadWarehouses();
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Almacenes</h1>
          <p className="text-slate-600 mt-1">
            Ubicaciones de inventario para tu organización y país actual
          </p>
        </div>
        <Button
          className="bg-teal-600 hover:bg-teal-700"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nuevo almacén
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Lista de almacenes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-500">Cargando...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12">
                <WarehouseIcon className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-700 mb-2">
                  No hay almacenes
                </h3>
                <p className="text-slate-500 mb-6">
                  Crea un almacén para asignar movimientos y ver stock por ubicación
                </p>
                <Button
                  className="bg-teal-600 hover:bg-teal-700"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Crear almacén
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Productos con stock</TableHead>
                      <TableHead className="text-right w-[140px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <WarehouseIcon className="h-4 w-4 text-teal-600 shrink-0" />
                            <span className="font-medium">{w.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 max-w-md truncate">
                          {w.description || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1 text-sm text-slate-700">
                            <Package className="h-4 w-4 text-slate-400" />
                            {w.productsWithStock}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditing(w);
                                setEditOpen(true);
                              }}
                              title="Editar"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                setDeleting(w);
                                setDeleteOpen(true);
                              }}
                              title="Eliminar"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo almacén</DialogTitle>
            <DialogDescription>
              El almacén quedará asociado a tu organización y al país seleccionado en el perfil.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Nombre *</Label>
              <Input
                id="create-name"
                name="name"
                required
                disabled={isSubmitting}
                placeholder="Ej: Depósito central"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-desc">Descripción</Label>
              <Textarea
                id="create-desc"
                name="description"
                disabled={isSubmitting}
                rows={3}
                placeholder="Opcional"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
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

      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar almacén</DialogTitle>
            <DialogDescription>Actualiza nombre o descripción.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleUpdate} className="space-y-4" key={editing.id}>
              <input type="hidden" name="warehouse_id" value={editing.id} />
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nombre *</Label>
                <Input
                  id="edit-name"
                  name="name"
                  required
                  disabled={isSubmitting}
                  defaultValue={editing.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Descripción</Label>
                <Textarea
                  id="edit-desc"
                  name="description"
                  disabled={isSubmitting}
                  rows={3}
                  defaultValue={editing.description || ""}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
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
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar almacén</DialogTitle>
            <DialogDescription>
              {deleting
                ? `¿Seguro que deseas eliminar «${deleting.name}»? Se eliminará el desglose de stock por almacén asociado. Los movimientos históricos conservarán el registro pero sin enlace al almacén.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
