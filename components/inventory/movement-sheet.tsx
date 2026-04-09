"use client";

import { useState, useEffect } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Package,
  Calendar,
  User,
  Building2,
  Hash,
  AlertTriangle,
  FileText,
  Calculator,
  ChevronDown,
  ChevronUp,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { registerMovement } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import {
  formatARS,
  calcularImpuestoPAIS,
  calcularPercepcionGanancias,
  AR_TAXES,
} from "@/lib/countries";
import toast from "react-hot-toast";
import type { Product, Supplier, Warehouse as WarehouseType } from "@/types/database";

interface MovementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  onSuccess?: () => void;
}

export function MovementSheet({
  open,
  onOpenChange,
  products,
  onSuccess,
}: MovementSheetProps) {
  const [movementType, setMovementType] = useState<"Entrada" | "Salida">(
    "Entrada"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [warehouseId, setWarehouseId] = useState<string>("__none__");
  const [countryCode, setCountryCode] = useState<string>("MX");

  // Form state
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [movementDate, setMovementDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [lotNumber, setLotNumber] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");

  // Calculadora AR
  const [showArCalculator, setShowArCalculator] = useState(false);
  const [precioBase, setPrecioBase] = useState("");
  const [incluirPercepcion, setIncluirPercepcion] = useState(true);

  useEffect(() => {
    if (open && movementType === "Entrada") {
      loadSuppliers();
    }
  }, [open, movementType]);

  useEffect(() => {
    if (open) {
      loadWarehouses();
    }
  }, [open]);

  async function loadWarehouses() {
    setIsLoadingWarehouses(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setIsLoadingWarehouses(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (!profile) {
      setIsLoadingWarehouses(false);
      return;
    }

    const cc = profile.country_code || "MX";

    const { data: whData } = await supabase
      .from("warehouses")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", cc)
      .order("name", { ascending: true });

    setWarehouses(whData || []);
    setIsLoadingWarehouses(false);
  }

  async function loadSuppliers() {
    setIsLoadingSuppliers(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setIsLoadingSuppliers(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (!profile) {
      setIsLoadingSuppliers(false);
      return;
    }

    setCountryCode(profile.country_code || "MX");

    const countryCodeValue = profile.country_code || "MX";

    const { data: suppliersData } = await supabase
      .from("suppliers")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCodeValue)
      .order("name", { ascending: true });

    setSuppliers(suppliersData || []);
    setIsLoadingSuppliers(false);
  }

  function resetForm() {
    setProductId("");
    setQuantity("");
    setMovementDate(new Date().toISOString().split("T")[0]);
    setLotNumber("");
    setExpirationDate("");
    setSupplierId("");
    setRecipient("");
    setNotes("");
    setPrecioBase("");
    setShowArCalculator(false);
    setWarehouseId("__none__");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData();
    formData.append("product_id", productId);
    formData.append("type", movementType);
    formData.append("quantity", quantity);
    formData.append("movement_date", movementDate);
    if (lotNumber) formData.append("lot_number", lotNumber);
    if (expirationDate) formData.append("expiration_date", expirationDate);
    if (supplierId) formData.append("supplier_id", supplierId);
    if (recipient) formData.append("recipient", recipient);
    if (notes) formData.append("notes", notes);
    if (warehouseId && warehouseId !== "__none__") {
      formData.append("warehouse_id", warehouseId);
    }

    const result = await registerMovement(formData);

    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || "Movimiento registrado correctamente");
      resetForm();
      setIsSubmitting(false);
      onOpenChange(false);
      onSuccess?.();
    }
  }

  const selectedProduct = products.find((p) => p.id === productId);
  const isLowStock =
    selectedProduct &&
    (selectedProduct.current_stock || selectedProduct.stock || 0) <=
      (selectedProduct.min_stock || 0);

  // Cálculos impositivos AR
  const baseNum = parseFloat(precioBase) || 0;
  const impuestoPAIS = calcularImpuestoPAIS(baseNum);
  const percepcionGanancias = incluirPercepcion
    ? calcularPercepcionGanancias(baseNum)
    : 0;
  const totalAR = baseNum + impuestoPAIS + percepcionGanancias;

  const isAR = countryCode === "AR";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {movementType === "Entrada" ? (
              <>
                <ArrowDownCircle className="h-5 w-5 text-teal-600" />
                Registrar Entrada
              </>
            ) : (
              <>
                <ArrowUpCircle className="h-5 w-5 text-red-600" />
                Registrar Salida
              </>
            )}
          </SheetTitle>
          <SheetDescription>
            {movementType === "Entrada"
              ? "Registra una entrada de productos al inventario"
              : "Registra una salida de productos del inventario"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Toggle Entrada/Salida */}
          <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
            <Button
              type="button"
              variant={movementType === "Entrada" ? "default" : "ghost"}
              className={`flex-1 ${
                movementType === "Entrada"
                  ? "bg-teal-600 hover:bg-teal-700 text-white"
                  : ""
              }`}
              onClick={() => {
                setMovementType("Entrada");
                resetForm();
              }}
            >
              <ArrowDownCircle className="mr-2 h-4 w-4" />
              Entrada
            </Button>
            <Button
              type="button"
              variant={movementType === "Salida" ? "default" : "ghost"}
              className={`flex-1 ${
                movementType === "Salida"
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : ""
              }`}
              onClick={() => {
                setMovementType("Salida");
                resetForm();
              }}
            >
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Salida
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Producto */}
            <div className="space-y-2">
              <Label htmlFor="product">Producto *</Label>
              <Select
                value={productId}
                onValueChange={setProductId}
                required
                disabled={isSubmitting}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Seleccionar producto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        <div>
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-slate-500">
                            SKU: {product.sku} | Stock:{" "}
                            {product.current_stock || product.stock || 0}
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isLowStock && movementType === "Salida" && (
                <p className="text-sm text-orange-600 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Stock bajo. Verifica disponibilidad antes de registrar salida.
                </p>
              )}
            </div>

            {/* Cantidad */}
            <div className="space-y-2">
              <Label htmlFor="quantity">Cantidad *</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                disabled={isSubmitting}
                className="h-12"
                placeholder="Ingresa la cantidad"
              />
            </div>

            {/* Fecha del Movimiento */}
            <div className="space-y-2">
              <Label htmlFor="movement_date">Fecha del Movimiento *</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                <Input
                  id="movement_date"
                  type="date"
                  value={movementDate}
                  onChange={(e) => setMovementDate(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="pl-10 h-12"
                />
              </div>
              <p className="text-xs text-slate-500">
                Fecha real del movimiento (puede ser distinta a hoy)
              </p>
            </div>

            {/* Almacén (opcional) */}
            <div className="space-y-2">
              <Label htmlFor="warehouse">Almacén</Label>
              <Select
                value={warehouseId}
                onValueChange={setWarehouseId}
                disabled={isSubmitting || isLoadingWarehouses}
              >
                <SelectTrigger id="warehouse" className="h-12">
                  <SelectValue placeholder="Sin almacén (stock solo global)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin almacén (solo global)</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <div className="flex items-center gap-2">
                        <Warehouse className="h-4 w-4" />
                        {w.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Si eliges un almacén, el movimiento actualiza también el stock en esa ubicación.
              </p>
            </div>

            {/* Campos condicionales para Entrada */}
            {movementType === "Entrada" && (
              <>
                {/* Proveedor */}
                <div className="space-y-2">
                  <Label htmlFor="supplier">Proveedor</Label>
                  <Select
                    value={supplierId}
                    onValueChange={setSupplierId}
                    disabled={isSubmitting || isLoadingSuppliers}
                  >
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Seleccionar proveedor (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            {supplier.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Número de Lote */}
                <div className="space-y-2">
                  <Label htmlFor="lot_number">Número de Lote</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <Input
                      id="lot_number"
                      value={lotNumber}
                      onChange={(e) => setLotNumber(e.target.value)}
                      disabled={isSubmitting}
                      className="pl-10 h-12"
                      placeholder="Ej: LOT-2025-001"
                    />
                  </div>
                </div>

                {/* Fecha de Vencimiento */}
                <div className="space-y-2">
                  <Label htmlFor="expiration_date">Fecha de Vencimiento</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <Input
                      id="expiration_date"
                      type="date"
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      disabled={isSubmitting}
                      className="pl-10 h-12"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    El vencimiento se registra en cada entrada de inventario, no en la ficha del
                    producto.
                  </p>
                </div>

                {/* Calculadora de impuestos Argentina */}
                {isAR && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-sky-800 hover:bg-sky-100 transition-colors"
                      onClick={() => setShowArCalculator(!showArCalculator)}
                    >
                      <span className="flex items-center gap-2">
                        <Calculator className="h-4 w-4" />
                        Calculadora de costos (ARS)
                      </span>
                      {showArCalculator ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>

                    {showArCalculator && (
                      <div className="px-4 pb-4 space-y-3 border-t border-sky-200">
                        <p className="text-xs text-sky-600 pt-3">
                          Herramienta informativa. No afecta el registro del movimiento.
                        </p>

                        {/* Precio base */}
                        <div className="space-y-1">
                          <Label htmlFor="precio_base" className="text-xs text-sky-800">
                            Precio unitario base (ARS)
                          </Label>
                          <Input
                            id="precio_base"
                            type="number"
                            min="0"
                            step="0.01"
                            value={precioBase}
                            onChange={(e) => setPrecioBase(e.target.value)}
                            className="h-9 bg-white text-sm"
                            placeholder="0.00"
                          />
                        </div>

                        {/* Toggle Percepción de Ganancias */}
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={incluirPercepcion}
                            onChange={(e) => setIncluirPercepcion(e.target.checked)}
                            className="rounded border-sky-300 text-sky-600"
                          />
                          <span className="text-xs text-sky-800">
                            Incluir Percepción de Ganancias ({(AR_TAXES.percepcionGanancias * 100).toFixed(0)}%)
                          </span>
                        </label>

                        {/* Desglose */}
                        {baseNum > 0 && (
                          <div className="rounded-md bg-white border border-sky-200 divide-y divide-sky-100 text-sm">
                            <div className="flex justify-between px-3 py-2">
                              <span className="text-slate-600">Precio base</span>
                              <span className="font-medium">{formatARS(baseNum)}</span>
                            </div>
                            <div className="flex justify-between px-3 py-2">
                              <span className="text-slate-600">
                                Impuesto PAIS ({(AR_TAXES.impuestoPAIS * 100).toFixed(0)}%)
                              </span>
                              <span className="text-orange-600">+ {formatARS(impuestoPAIS)}</span>
                            </div>
                            {incluirPercepcion && (
                              <div className="flex justify-between px-3 py-2">
                                <span className="text-slate-600">
                                  Percepción Ganancias ({(AR_TAXES.percepcionGanancias * 100).toFixed(0)}%)
                                </span>
                                <span className="text-orange-600">+ {formatARS(percepcionGanancias)}</span>
                              </div>
                            )}
                            <div className="flex justify-between px-3 py-2 bg-sky-50 font-semibold">
                              <span className="text-sky-800">Total estimado</span>
                              <span className="text-sky-800">{formatARS(totalAR)}</span>
                            </div>
                            {quantity && (
                              <div className="flex justify-between px-3 py-2 bg-sky-100 font-semibold">
                                <span className="text-sky-900">
                                  Total x {quantity} unidad{parseInt(quantity) !== 1 ? "es" : ""}
                                </span>
                                <span className="text-sky-900">
                                  {formatARS(totalAR * (parseFloat(quantity) || 0))}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Campos condicionales para Salida */}
            {movementType === "Salida" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="recipient">Destinatario / Razón</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
                    <Input
                      id="recipient"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      disabled={isSubmitting}
                      className="pl-10 h-12"
                      placeholder="Ej: Clínica XYZ, Dr. Pérez, Paciente ABC"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">
                    Comentarios / Notas{" "}
                    <span className="text-xs text-slate-500">(Recomendado)</span>
                  </Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                    <Textarea
                      id="notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={isSubmitting}
                      className="pl-10 min-h-[80px]"
                      placeholder="Motivo de la salida, detalles del uso, observaciones..."
                    />
                  </div>
                </div>
              </>
            )}

            {/* Comentarios para Entrada - Opcional */}
            {movementType === "Entrada" && (
              <div className="space-y-2">
                <Label htmlFor="notes">Comentarios / Notas</Label>
                <div className="relative">
                  <FileText className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isSubmitting}
                    className="pl-10 min-h-[80px]"
                    placeholder="Observaciones adicionales sobre la entrada..."
                  />
                </div>
              </div>
            )}

            {/* Botones */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className={`flex-1 ${
                  movementType === "Entrada"
                    ? "bg-teal-600 hover:bg-teal-700"
                    : "bg-red-600 hover:bg-red-700"
                } text-white`}
                disabled={isSubmitting || !productId || !quantity}
              >
                {isSubmitting ? (
                  <>
                    <span className="mr-2">Procesando...</span>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </>
                ) : (
                  "Confirmar Movimiento"
                )}
              </Button>
            </div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
