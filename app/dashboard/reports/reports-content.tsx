"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Search,
  Calendar,
  Package,
  ArrowDownCircle,
  ArrowUpCircle,
  FileSpreadsheet,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import * as XLSX from "xlsx";
import type { Movement, Product, Profile } from "@/types/database";

type MovementRow = Movement & {
  product_name: string;
  product_sku: string;
  user_email: string;
  supplier_name: string;
};

export function ReportsContent() {
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "Entrada" | "Salida">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [totalCount, setTotalCount] = useState(0);

  const loadMovements = useCallback(async () => {
    setIsLoading(true);
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

    let query = supabase
      .from("movements")
      .select("*", { count: "exact" })
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (dateFrom) {
      query = query.gte("movement_date", dateFrom);
    }
    if (dateTo) {
      query = query.lte("movement_date", dateTo);
    }
    if (typeFilter !== "all") {
      query = query.eq("type", typeFilter);
    }

    const { data: movementsData, error: movementsError, count } = await query;

    if (movementsError) {
      toast.error("Error al cargar movimientos: " + movementsError.message);
      setIsLoading(false);
      return;
    }

    setTotalCount(count || 0);

    if (!movementsData || movementsData.length === 0) {
      setMovements([]);
      setIsLoading(false);
      return;
    }

    const productIds = [...new Set(movementsData.map((m) => m.product_id))];
    const userIds = [...new Set(movementsData.map((m) => m.created_by).filter(Boolean))];
    const supplierIds = [...new Set(movementsData.map((m) => m.supplier_id).filter(Boolean))];

    const { data: productsData } = await supabase
      .from("products")
      .select("id, name, sku")
      .in("id", productIds);

    const { data: profilesData } = userIds.length > 0
      ? await supabase.from("profiles").select("id, email").in("id", userIds)
      : { data: [] };

    const { data: suppliersData } = supplierIds.length > 0
      ? await supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : { data: [] };

    const rows: MovementRow[] = movementsData.map((m) => {
      const product = productsData?.find((p) => p.id === m.product_id);
      const userProfile = profilesData?.find((p) => p.id === m.created_by);
      const supplier = suppliersData?.find((s) => s.id === m.supplier_id);

      return {
        ...m,
        product_name: product?.name || "Producto eliminado",
        product_sku: product?.sku || "N/A",
        user_email: userProfile?.email || "Sistema",
        supplier_name: supplier?.name || "",
      };
    });

    setMovements(rows);
    setIsLoading(false);
  }, [dateFrom, dateTo, typeFilter]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  const filteredMovements = movements.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.product_name.toLowerCase().includes(q) ||
      m.product_sku.toLowerCase().includes(q) ||
      m.user_email.toLowerCase().includes(q) ||
      m.recipient?.toLowerCase().includes(q) ||
      m.supplier_name.toLowerCase().includes(q) ||
      m.lot_number?.toLowerCase().includes(q) ||
      m.notes?.toLowerCase().includes(q)
    );
  });

  function exportToExcel() {
    setIsExporting(true);

    try {
      const data = filteredMovements.map((m) => ({
        "Fecha Movimiento": m.movement_date || "",
        Producto: m.product_name,
        SKU: m.product_sku,
        Tipo: m.type,
        Cantidad: m.type === "Entrada" ? m.quantity : -m.quantity,
        Proveedor: m.supplier_name || "",
        Destinatario: m.recipient || "",
        "Nro. Lote": m.lot_number || "",
        "Fecha Vencimiento": m.expiration_date || "",
        Notas: m.notes || "",
        Usuario: m.user_email,
        "Fecha Registro": new Date(m.created_at).toLocaleString("es-ES"),
      }));

      const ws = XLSX.utils.json_to_sheet(data);

      const colWidths = [
        { wch: 16 },
        { wch: 30 },
        { wch: 16 },
        { wch: 10 },
        { wch: 10 },
        { wch: 25 },
        { wch: 25 },
        { wch: 18 },
        { wch: 18 },
        { wch: 40 },
        { wch: 30 },
        { wch: 20 },
      ];
      ws["!cols"] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Movimientos");

      const today = new Date().toISOString().split("T")[0];
      const fileName = `reporte_movimientos_${today}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast.success(`Reporte descargado: ${fileName}`);
    } catch (error) {
      console.error("Error al exportar:", error);
      toast.error("Error al generar el archivo Excel");
    } finally {
      setIsExporting(false);
    }
  }

  const formatMovementDate = (dateString: string) => {
    const date = new Date(dateString + "T00:00:00");
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatCreatedAt = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
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
            <h1 className="text-3xl font-bold text-slate-900">Reportes</h1>
            <p className="text-slate-600 mt-1">
              Reporte sábana de todos los movimientos del inventario
            </p>
          </div>
          <Button
            onClick={exportToExcel}
            disabled={isExporting || filteredMovements.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isExporting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                Exportando...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Descargar Excel
              </>
            )}
          </Button>
        </div>

        {/* Filtros */}
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
              <Filter className="h-4 w-4" />
              Filtros
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Búsqueda */}
              <div className="md:col-span-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Buscar por producto, SKU, usuario, destinatario..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10"
                  />
                </div>
              </div>

              {/* Tipo */}
              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  <SelectItem value="Entrada">Entradas</SelectItem>
                  <SelectItem value="Salida">Salidas</SelectItem>
                </SelectContent>
              </Select>

              {/* Rango de fechas */}
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 text-sm"
                  title="Fecha desde"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-10 text-sm"
                  title="Fecha hasta"
                />
              </div>
            </div>
            {(dateFrom || dateTo || typeFilter !== "all") && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {totalCount} movimiento(s) encontrado(s)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    setTypeFilter("all");
                    setSearchQuery("");
                  }}
                >
                  Limpiar filtros
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Resumen */}
      {!isLoading && filteredMovements.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-slate-200">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{filteredMovements.length}</p>
              <p className="text-xs text-slate-500">Total movimientos</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">
                {filteredMovements.filter((m) => m.type === "Entrada").reduce((sum, m) => sum + m.quantity, 0)}
              </p>
              <p className="text-xs text-emerald-600">Total entradas</p>
            </CardContent>
          </Card>
          <Card className="border-rose-200 bg-rose-50/50">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-rose-600">
                {filteredMovements.filter((m) => m.type === "Salida").reduce((sum, m) => sum + m.quantity, 0)}
              </p>
              <p className="text-xs text-rose-600">Total salidas</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabla */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Cargando movimientos...</div>
      ) : filteredMovements.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12"
        >
          <FileSpreadsheet className="h-16 w-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-700 mb-2">Sin movimientos</h3>
          <p className="text-slate-500">
            No se encontraron movimientos con los filtros aplicados
          </p>
        </motion.div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="font-semibold">Fecha Mov.</TableHead>
                        <TableHead className="font-semibold">Producto</TableHead>
                        <TableHead className="font-semibold">SKU</TableHead>
                        <TableHead className="font-semibold">Tipo</TableHead>
                        <TableHead className="font-semibold text-right">Cantidad</TableHead>
                        <TableHead className="font-semibold">Proveedor</TableHead>
                        <TableHead className="font-semibold">Destinatario</TableHead>
                        <TableHead className="font-semibold">Lote</TableHead>
                        <TableHead className="font-semibold">Notas</TableHead>
                        <TableHead className="font-semibold">Usuario</TableHead>
                        <TableHead className="font-semibold">Registrado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMovements.map((m) => {
                        const isEntrada = m.type === "Entrada";
                        return (
                          <TableRow key={m.id} className="hover:bg-slate-50/50">
                            <TableCell className="text-sm whitespace-nowrap">
                              {m.movement_date
                                ? formatMovementDate(m.movement_date)
                                : "-"}
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                              {m.product_name}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-slate-500">
                              {m.product_sku}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={
                                  isEntrada
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                    : "bg-rose-100 text-rose-700 border-rose-200"
                                }
                              >
                                {m.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <span
                                className={`font-bold ${
                                  isEntrada ? "text-emerald-600" : "text-rose-600"
                                }`}
                              >
                                {isEntrada ? "+" : "-"}{m.quantity}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {m.supplier_name || "-"}
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {m.recipient || "-"}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-slate-500">
                              {m.lot_number || "-"}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-[200px] truncate">
                              {m.notes || "-"}
                            </TableCell>
                            <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                              {m.user_email.split("@")[0]}
                            </TableCell>
                            <TableCell className="text-xs text-slate-400 whitespace-nowrap">
                              {formatCreatedAt(m.created_at)}
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

          {/* Móvil */}
          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">
                {filteredMovements.length} movimiento(s)
              </span>
              <Button
                size="sm"
                onClick={exportToExcel}
                disabled={isExporting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
              >
                <Download className="h-3 w-3 mr-1" />
                Excel
              </Button>
            </div>
            {filteredMovements.map((m, index) => {
              const isEntrada = m.type === "Entrada";
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                >
                  <Card
                    className={`border-l-4 ${
                      isEntrada
                        ? "border-l-emerald-500"
                        : "border-l-rose-500"
                    } border-slate-200`}
                  >
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium text-sm text-slate-900">{m.product_name}</p>
                          <p className="text-xs text-slate-400">{m.product_sku}</p>
                        </div>
                        <span
                          className={`font-bold ${
                            isEntrada ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {isEntrada ? "+" : "-"}{m.quantity}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
                        <span>
                          {m.movement_date ? formatMovementDate(m.movement_date) : "-"}
                        </span>
                        <span className="text-right">{m.type}</span>
                        <span>{m.user_email.split("@")[0]}</span>
                        <span className="text-right">{m.recipient || m.supplier_name || "-"}</span>
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
