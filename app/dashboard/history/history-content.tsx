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
import toast from "react-hot-toast";
import Link from "next/link";
import type { Movement, Product, Profile } from "@/types/database";

type MovementWithDetails = Movement & {
  products: Product | null;
  profiles: Profile | null;
  suppliers: { name: string } | null;
};

export function HistoryContent() {
  const searchParams = useSearchParams();
  const productIdParam = searchParams.get("product_id");
  
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "Entrada" | "Salida">("all");
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; sku: string } | null>(null);

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

    // Obtener IDs únicos para hacer queries eficientes
    const productIds = [...new Set(movementsData.map((m) => m.product_id))];
    const userIds = [...new Set(movementsData.map((m) => m.created_by).filter(Boolean))];
    const supplierIds = [...new Set(movementsData.map((m) => m.supplier_id).filter(Boolean))];

    // Cargar productos
    const { data: productsData } = await supabase
      .from("products")
      .select("id, name, sku")
      .in("id", productIds);

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
    const { data: suppliersData } = supplierIds.length > 0
      ? await supabase
          .from("suppliers")
          .select("id, name")
          .in("id", supplierIds)
      : { data: [] };

    // Mapear datos
    const movementsWithDetails = movementsData.map((movement) => ({
      ...movement,
      products: productsData?.find((p) => p.id === movement.product_id) || null,
      profiles: profilesData?.find((p) => p.id === movement.created_by) || null,
      suppliers: suppliersData?.find((s) => s.id === movement.supplier_id) || null,
    }));

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
                        <TableHead>Detalle/Traza</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Registrado</TableHead>
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
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}



