"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Search,
  ArrowDownCircle,
  ArrowUpCircle,
  Package,
  Truck,
  User,
  Calendar,
  X,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { updateMovement, deleteMovement } from "@/actions/inventory";
import toast from "react-hot-toast";
import Link from "next/link";
import type { Movement, Product, Profile, Warehouse, Supplier } from "@/types/database";

type MovementWithDetails = Movement & {
  products: Product | null;
  profiles: Profile | null;
  suppliers: { name: string } | null;
  warehouseName: string | null;
};

export function HistoryContent() {
  const searchParams = useSearchParams();
  const productIdParam = searchParams.get("product_id");
  
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "Entrada" | "Salida">("all");
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; sku: string } | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editMovement, setEditMovement] = useState<MovementWithDetails | null>(null);
  const [movementToDelete, setMovementToDelete] = useState<MovementWithDetails | null>(null);
  const [isSavingMovement, setIsSavingMovement] = useState(false);
  const [isDeletingMovement, setIsDeletingMovement] = useState(false);
  const [editForm, setEditForm] = useState({
    product_id: "",
    type: "Entrada" as "Entrada" | "Salida",
    quantity: "",
    movement_date: "",
    lot_number: "",
    expiration_date: "",
    supplier_id: "__none__",
    recipient: "",
    notes: "",
    warehouse_id: "__none__",
  });

  useEffect(() => {
    loadMovements();
  }, [productIdParam]);

  async function loadMovements() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("No autenticado");
      setIsLoading(false);
      return;
    }

    // Obtener organization_id y country_code
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Error al obtener perfil:", profileError);
      toast.error("Error al obtener información del usuario");
      setIsLoading(false);
      return;
    }

    const countryCode = profile.country_code || "MX";

    // Cargar movimientos (filtrado por producto si se especifica)
    let movementsQuery = supabase
      .from("movements")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("created_at", { ascending: false })
      .limit(50);

    // Si hay un product_id en los parámetros, filtrar por ese producto
    if (productIdParam) {
      movementsQuery = movementsQuery.eq("product_id", productIdParam);
    }

    const { data: movementsData, error: movementsError } = await movementsQuery;

    if (movementsError) {
      console.error("Error al cargar movimientos:", movementsError);
      toast.error("Error al cargar movimientos: " + movementsError.message);
      setIsLoading(false);
      return;
    }

    if (!movementsData || movementsData.length === 0) {
      setMovements([]);
      setIsLoading(false);
      return;
    }

    // Obtener IDs únicos para mapear detalles de los movimientos
    const movementProductIds = [...new Set(movementsData.map((m) => m.product_id))];
    const userIds = [...new Set(movementsData.map((m) => m.created_by).filter(Boolean))];
    // Cargar catálogo completo para edición
    const { data: productsData } = await supabase
      .from("products")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    // Si hay un producto específico, guardarlo para mostrar en el header
    if (productIdParam) {
      const product = productsData?.find((p) => p.id === productIdParam);
      setSelectedProduct(product || null);
    }

    // Cargar perfiles de usuarios
    const { data: profilesData } = userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds)
      : { data: [] };

    // Cargar proveedores
    const { data: suppliersData } = await supabase
      .from("suppliers")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    const { data: warehousesData } = await supabase
      .from("warehouses")
      .select("id, name, description, organization_id, country_code, created_at, updated_at")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    // Mapear datos
    const movementsWithDetails = movementsData.map((movement) => ({
      ...movement,
      products:
        productsData?.find(
          (p) => p.id === movement.product_id && movementProductIds.includes(p.id)
        ) || null,
      profiles: profilesData?.find((p) => p.id === movement.created_by) || null,
      suppliers: suppliersData?.find((s) => s.id === movement.supplier_id) || null,
      warehouseName: movement.warehouse_id
        ? warehousesData?.find((w) => w.id === movement.warehouse_id)?.name || null
        : null,
    }));

    setProducts(productsData || []);
    setSuppliers(suppliersData || []);
    setWarehouses(warehousesData || []);
    setMovements(movementsWithDetails);
    setIsLoading(false);
  }

  // Filtrar movimientos
  const filteredMovements = movements.filter((movement) => {
    const matchesSearch =
      !searchQuery ||
      movement.products?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      movement.products?.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      movement.lot_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      movement.recipient?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType =
      typeFilter === "all" || movement.type === typeFilter;

    return matchesSearch && matchesType;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatMovementDate = (dateString: string) => {
    const date = new Date(dateString + "T00:00:00");
    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const openEditMovementDialog = (movement: MovementWithDetails) => {
    setEditMovement(movement);
    setEditForm({
      product_id: movement.product_id,
      type: movement.type,
      quantity: movement.quantity.toString(),
      movement_date: movement.movement_date || new Date().toISOString().split("T")[0],
      lot_number: movement.lot_number || "",
      expiration_date: movement.expiration_date || "",
      supplier_id: movement.supplier_id || "__none__",
      recipient: movement.recipient || "",
      notes: movement.notes || "",
      warehouse_id: movement.warehouse_id || "__none__",
    });
  };

  const handleSaveMovement = async () => {
    if (!editMovement) return;
    setIsSavingMovement(true);

    const formData = new FormData();
    formData.append("product_id", editForm.product_id);
    formData.append("type", editForm.type);
    formData.append("quantity", editForm.quantity);
    formData.append("movement_date", editForm.movement_date);
    if (editForm.lot_number) formData.append("lot_number", editForm.lot_number);
    if (editForm.expiration_date) formData.append("expiration_date", editForm.expiration_date);
    if (editForm.supplier_id !== "__none__") formData.append("supplier_id", editForm.supplier_id);
    if (editForm.recipient) formData.append("recipient", editForm.recipient);
    if (editForm.notes) formData.append("notes", editForm.notes);
    if (editForm.warehouse_id !== "__none__") formData.append("warehouse_id", editForm.warehouse_id);

    const result = await updateMovement(editMovement.id, formData);

    if (result?.error) {
      toast.error(result.error);
      setIsSavingMovement(false);
      return;
    }

    toast.success(result?.message || "Movimiento actualizado");
    setEditMovement(null);
    setIsSavingMovement(false);
    await loadMovements();
  };

  const handleDeleteMovement = async () => {
    if (!editMovement) return;
    setIsDeletingMovement(true);

    const result = await deleteMovement(editMovement.id);

    if (result?.error) {
      toast.error(result.error);
      setIsDeletingMovement(false);
      return;
    }

    toast.success(result?.message || "Movimiento eliminado");
    setEditMovement(null);
    setIsDeletingMovement(false);
    await loadMovements();
  };

  const handleConfirmDeleteFromRow = async () => {
    if (!movementToDelete) return;
    setIsDeletingMovement(true);

    const result = await deleteMovement(movementToDelete.id);

    if (result?.error) {
      toast.error(result.error);
      setIsDeletingMovement(false);
      return;
    }

    toast.success(result?.message || "Movimiento eliminado");
    setMovementToDelete(null);
    setIsDeletingMovement(false);
    await loadMovements();
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              {selectedProduct ? "Historial del Producto" : "Historial de Movimientos"}
            </h1>
            <p className="text-slate-600 mt-1">
              {selectedProduct
                ? `Audita todas las entradas y salidas de ${selectedProduct.name}`
                : "Audita todas las entradas y salidas del inventario"}
            </p>
            {selectedProduct && (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="text-sm">
                  SKU: {selectedProduct.sku}
                </Badge>
                <Link href="/dashboard/history">
                  <Button variant="ghost" size="sm" className="h-7 text-xs">
                    <X className="h-3 w-3 mr-1" />
                    Ver todos los movimientos
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-col md:flex-row gap-4">
          {/* Búsqueda */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              placeholder="Buscar por producto, SKU, lote o destinatario..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12"
            />
          </div>

          {/* Filtro de Tipo */}
          <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
            <SelectTrigger className="w-full md:w-[200px] h-12">
              <SelectValue placeholder="Tipo de movimiento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="Entrada">Entradas</SelectItem>
              <SelectItem value="Salida">Salidas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      {/* Tabla Desktop */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">
          Cargando movimientos...
        </div>
      ) : filteredMovements.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12"
        >
          <Package className="h-16 w-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-700 mb-2">
            No hay movimientos
          </h3>
          <p className="text-slate-500">
            {searchQuery || typeFilter !== "all"
              ? "No se encontraron movimientos con los filtros aplicados"
              : selectedProduct
              ? `Aún no se han registrado movimientos para ${selectedProduct.name}`
              : "Aún no se han registrado movimientos en el inventario"}
          </p>
        </motion.div>
      ) : (
        <>
          {/* Tabla Desktop */}
          <div className="hidden md:block">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha Mov.</TableHead>
                        {!selectedProduct && <TableHead>Producto</TableHead>}
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead>Almacén</TableHead>
                        <TableHead>Detalle/Traza</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Registrado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMovements.map((movement) => {
                        const isEntrada = movement.type === "Entrada";
                        return (
                          <TableRow key={movement.id}>
                            <TableCell className="text-slate-600">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-slate-400" />
                                {movement.movement_date
                                  ? formatMovementDate(movement.movement_date)
                                  : formatDate(movement.created_at)}
                              </div>
                            </TableCell>
                            {!selectedProduct && (
                              <TableCell>
                                <div>
                                  <p className="font-semibold text-slate-900">
                                    {movement.products?.name || "Producto eliminado"}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    SKU: {movement.products?.sku || "N/A"}
                                  </p>
                                </div>
                              </TableCell>
                            )}
                            <TableCell>
                              <Badge
                                className={
                                  isEntrada
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                    : "bg-rose-100 text-rose-700 border-rose-200"
                                }
                              >
                                {isEntrada ? "Entrada" : "Salida"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <span
                                className={`font-bold text-lg ${
                                  isEntrada ? "text-emerald-600" : "text-rose-600"
                                }`}
                              >
                                {isEntrada ? "+" : "-"}
                                {movement.quantity}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {movement.warehouseName || "—"}
                            </TableCell>
                            <TableCell>
                              {isEntrada ? (
                                <div className="space-y-1">
                                  {movement.suppliers?.name && (
                                    <div className="flex items-center gap-2 text-sm">
                                      <Truck className="h-4 w-4 text-slate-400" />
                                      <span className="text-slate-600">
                                        {movement.suppliers.name}
                                      </span>
                                    </div>
                                  )}
                                  {movement.lot_number && (
                                    <div className="flex items-center gap-2 text-sm">
                                      <Package className="h-4 w-4 text-slate-400" />
                                      <span className="text-slate-600 font-mono text-xs">
                                        Lote: {movement.lot_number}
                                      </span>
                                    </div>
                                  )}
                                  {movement.expiration_date && (
                                    <div className="text-xs text-slate-500">
                                      Vence: {new Date(movement.expiration_date).toLocaleDateString("es-ES")}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                movement.recipient && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <User className="h-4 w-4 text-slate-400" />
                                    <span className="text-slate-600">{movement.recipient}</span>
                                  </div>
                                )
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-slate-600">
                                {movement.profiles?.email?.split("@")[0] || "Sistema"}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-slate-400">
                              {formatDate(movement.created_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditMovementDialog(movement)}
                                >
                                  <Pencil className="h-3.5 w-3.5 mr-1" />
                                  Editar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                                  onClick={() => setMovementToDelete(movement)}
                                  aria-label="Borrar movimiento"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                                  Borrar
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Cards Móvil */}
          <div className="md:hidden space-y-3">
            {filteredMovements.map((movement, index) => {
              const isEntrada = movement.type === "Entrada";
              return (
                <motion.div
                  key={movement.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    className={`border-l-4 ${
                      isEntrada
                        ? "border-l-emerald-500 bg-emerald-50/30"
                        : "border-l-rose-500 bg-rose-50/30"
                    } border-slate-200 shadow-sm`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {isEntrada ? (
                              <ArrowDownCircle className="h-5 w-5 text-emerald-600" />
                            ) : (
                              <ArrowUpCircle className="h-5 w-5 text-rose-600" />
                            )}
                            <Badge
                              className={
                                isEntrada
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-rose-100 text-rose-700"
                              }
                            >
                              {isEntrada ? "Entrada" : "Salida"}
                            </Badge>
                          </div>
                          {!selectedProduct && (
                            <>
                              <h3 className="font-semibold text-slate-900">
                                {movement.products?.name || "Producto eliminado"}
                              </h3>
                              <p className="text-xs text-slate-500">
                                SKU: {movement.products?.sku || "N/A"}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="text-right">
                          <span
                            className={`font-bold text-xl ${
                              isEntrada ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {isEntrada ? "+" : "-"}
                            {movement.quantity}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                          <Calendar className="h-4 w-4 text-slate-400" />
                          {movement.movement_date
                            ? formatMovementDate(movement.movement_date)
                            : formatDate(movement.created_at)}
                        </div>
                        {movement.warehouseName && (
                          <div className="text-slate-600">
                            Almacén: {movement.warehouseName}
                          </div>
                        )}

                        {isEntrada ? (
                          <>
                            {movement.suppliers?.name && (
                              <div className="flex items-center gap-2 text-slate-600">
                                <Truck className="h-4 w-4 text-slate-400" />
                                {movement.suppliers.name}
                              </div>
                            )}
                            {movement.lot_number && (
                              <div className="flex items-center gap-2 text-slate-600">
                                <Package className="h-4 w-4 text-slate-400" />
                                <span className="font-mono text-xs">
                                  Lote: {movement.lot_number}
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          movement.recipient && (
                            <div className="flex items-center gap-2 text-slate-600">
                              <User className="h-4 w-4 text-slate-400" />
                              {movement.recipient}
                            </div>
                          )
                        )}

                        <div className="text-xs text-slate-500 pt-2 border-t border-slate-200">
                          Por: {movement.profiles?.email?.split("@")[0] || "Sistema"}
                        </div>
                        <div className="pt-1 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditMovementDialog(movement)}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setMovementToDelete(movement)}
                            aria-label="Borrar movimiento"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Borrar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      <Dialog
        open={Boolean(movementToDelete)}
        onOpenChange={(open) => {
          if (!open && !isDeletingMovement) setMovementToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar movimiento</DialogTitle>
            <DialogDescription>
              ¿Seguro que querés eliminar este movimiento? El stock global y por almacén se
              actualizarán. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {movementToDelete && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-medium">
                {movementToDelete.products?.name || "Producto"} ·{" "}
                {movementToDelete.type === "Entrada" ? "Entrada" : "Salida"}{" "}
                {movementToDelete.type === "Entrada" ? "+" : "-"}
                {movementToDelete.quantity}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {movementToDelete.movement_date
                  ? formatMovementDate(movementToDelete.movement_date)
                  : formatDate(movementToDelete.created_at)}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setMovementToDelete(null)}
              disabled={isDeletingMovement}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDeleteFromRow}
              disabled={isDeletingMovement}
            >
              {isDeletingMovement ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editMovement)}
        onOpenChange={(open) => {
          if (!open) setEditMovement(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar movimiento</DialogTitle>
            <DialogDescription>
              Puedes modificar todos los datos del movimiento o eliminarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Producto</label>
              <Select
                value={editForm.product_id}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, product_id: value }))}
                disabled={isSavingMovement || isDeletingMovement}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Tipo</label>
              <Select
                value={editForm.type}
                onValueChange={(value: "Entrada" | "Salida") =>
                  setEditForm((prev) => ({ ...prev, type: value }))
                }
                disabled={isSavingMovement || isDeletingMovement}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Entrada">Entrada</SelectItem>
                  <SelectItem value="Salida">Salida</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Cantidad</label>
              <Input
                type="number"
                min="1"
                value={editForm.quantity}
                onChange={(e) => setEditForm((prev) => ({ ...prev, quantity: e.target.value }))}
                disabled={isSavingMovement || isDeletingMovement}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Fecha del movimiento</label>
              <Input
                type="date"
                value={editForm.movement_date}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, movement_date: e.target.value }))
                }
                disabled={isSavingMovement || isDeletingMovement}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Almacén</label>
              <Select
                value={editForm.warehouse_id}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, warehouse_id: value }))
                }
                disabled={isSavingMovement || isDeletingMovement}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar almacén" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin almacén (solo global)</SelectItem>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editForm.type === "Entrada" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Proveedor</label>
                  <Select
                    value={editForm.supplier_id}
                    onValueChange={(value) =>
                      setEditForm((prev) => ({ ...prev, supplier_id: value }))
                    }
                    disabled={isSavingMovement || isDeletingMovement}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin proveedor</SelectItem>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Lote</label>
                  <Input
                    value={editForm.lot_number}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, lot_number: e.target.value }))
                    }
                    disabled={isSavingMovement || isDeletingMovement}
                    placeholder="Ej: LOT-2026-001"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Vencimiento</label>
                  <Input
                    type="date"
                    value={editForm.expiration_date}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, expiration_date: e.target.value }))
                    }
                    disabled={isSavingMovement || isDeletingMovement}
                  />
                </div>
              </>
            )}

            {editForm.type === "Salida" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Destinatario / Razón
                </label>
                <Input
                  value={editForm.recipient}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, recipient: e.target.value }))
                  }
                  disabled={isSavingMovement || isDeletingMovement}
                  placeholder="Ej: Clínica XYZ, Dr. Pérez"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Notas</label>
              <Input
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                disabled={isSavingMovement || isDeletingMovement}
                placeholder="Observaciones"
              />
            </div>
          </div>

          <DialogFooter className="justify-between gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteMovement}
              disabled={isSavingMovement || isDeletingMovement}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {isDeletingMovement ? "Eliminando..." : "Eliminar"}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditMovement(null)}
                disabled={isSavingMovement || isDeletingMovement}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSaveMovement}
                disabled={
                  isSavingMovement ||
                  isDeletingMovement ||
                  !editForm.product_id ||
                  !editForm.quantity ||
                  !editForm.movement_date
                }
              >
                {isSavingMovement ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </DialogFooter>
          <p className="text-xs text-slate-500">
            Eliminar o editar un movimiento recalcula el stock global y por almacén.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}



