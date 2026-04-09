"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ArrowUpCircle,
  Boxes,
  User,
  FileText,
  Package,
  AlertTriangle,
  Warehouse,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { registerKitExit } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import type { Product, Kit, KitProduct, Warehouse as WarehouseType } from "@/types/database";
import {
  computeLotBalancesForProduct,
  decodeLotSelection,
  encodeLotSelection,
  formatLotLabel,
  validateSequentialLotConsumption,
  type LotBalance,
  type LotMovementInput,
} from "@/lib/kit-lot-balance";

type KitWithProducts = Kit & {
  kit_products: (KitProduct & { product?: Product })[];
};

interface KitExitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kits: KitWithProducts[];
  onSuccess?: () => void;
}

export function KitExitSheet({
  open,
  onOpenChange,
  kits,
  onSuccess,
}: KitExitSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [validWarehouseIds, setValidWarehouseIds] = useState<string[]>([]);
  const [kitConflictMessage, setKitConflictMessage] = useState<string | null>(null);
  const [isLoadingLots, setIsLoadingLots] = useState(false);
  const [lotsByProductId, setLotsByProductId] = useState<Record<string, LotBalance[]>>({});
  const [lotSelections, setLotSelections] = useState<Record<string, string>>({});

  const selectedKit = useMemo(
    () => kits.find((k) => k.id === selectedKitId),
    [kits, selectedKitId]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setIsLoadingWarehouses(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setIsLoadingWarehouses(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, country_code")
        .eq("id", user.id)
        .single();
      if (!profile || cancelled) {
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
      if (!cancelled) {
        setWarehouses(whData || []);
        setIsLoadingWarehouses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const kit = kits.find((k) => k.id === selectedKitId);
    if (!open || !kit) {
      setValidWarehouseIds([]);
      setKitConflictMessage(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, country_code")
        .eq("id", user.id)
        .single();
      if (!profile || cancelled) return;

      const productIds = [...new Set(kit.kit_products.map((kp) => kp.product_id))];
      if (productIds.length === 0) {
        setValidWarehouseIds([]);
        setKitConflictMessage("Este kit no tiene productos.");
        return;
      }

      const { data: wsRows } = await supabase
        .from("warehouse_stock")
        .select("warehouse_id, product_id, current_stock")
        .in("product_id", productIds)
        .gt("current_stock", 0);

      const byWarehouse = new Map<string, Map<string, number>>();
      for (const r of wsRows || []) {
        if (!byWarehouse.has(r.warehouse_id)) {
          byWarehouse.set(r.warehouse_id, new Map());
        }
        byWarehouse.get(r.warehouse_id)!.set(r.product_id, r.current_stock);
      }

      const valid: string[] = [];
      for (const [whId, stockMap] of byWarehouse) {
        let ok = true;
        for (const kp of kit.kit_products) {
          if ((stockMap.get(kp.product_id) ?? 0) < kp.quantity) {
            ok = false;
            break;
          }
        }
        if (ok) valid.push(whId);
      }

      if (!cancelled) {
        setValidWarehouseIds(valid);
        setKitConflictMessage(
          valid.length === 0
            ? "Los componentes del kit no están todos en el mismo almacén con stock suficiente. No se puede armar la salida."
            : null
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, selectedKitId, kits]);

  useEffect(() => {
    if (!validWarehouseIds.length) {
      setWarehouseId("");
      return;
    }
    if (!warehouseId || !validWarehouseIds.includes(warehouseId)) {
      setWarehouseId(validWarehouseIds[0]);
    }
  }, [validWarehouseIds, warehouseId, selectedKitId]);

  useEffect(() => {
    const kit = kits.find((k) => k.id === selectedKitId);
    if (!open || !kit || !warehouseId) {
      setLotsByProductId({});
      setLotSelections({});
      setIsLoadingLots(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoadingLots(true);
      const supabase = createClient();
      const productIds = [...new Set(kit.kit_products.map((kp) => kp.product_id))];

      const { data: movRows, error } = await supabase
        .from("movements")
        .select("product_id, type, quantity, expiration_date, lot_number, created_at")
        .in("product_id", productIds)
        .eq("warehouse_id", warehouseId)
        .order("created_at", { ascending: true });

      if (error) {
        if (!cancelled) {
          toast.error("Error al cargar lotes: " + error.message);
          setIsLoadingLots(false);
        }
        return;
      }

      type Row = {
        product_id: string;
        type: "Entrada" | "Salida";
        quantity: number;
        expiration_date: string | null;
        lot_number: string | null;
        created_at: string;
      };

      const rows = (movRows || []) as Row[];
      const nextLots: Record<string, LotBalance[]> = {};
      for (const pid of productIds) {
        const inputs: LotMovementInput[] = rows
          .filter((m) => m.product_id === pid)
          .map((m) => ({
            type: m.type,
            quantity: m.quantity,
            expiration_date: m.expiration_date,
            lot_number: m.lot_number,
            created_at: m.created_at,
          }));
        nextLots[pid] = computeLotBalancesForProduct(inputs);
      }

      const nextSel: Record<string, string> = {};
      for (const kp of kit.kit_products) {
        const lots = nextLots[kp.product_id] || [];
        const pick = lots.find((l) => l.quantity >= kp.quantity);
        nextSel[kp.id] = pick
          ? encodeLotSelection(pick.expirationDate, pick.lotNumber)
          : "";
      }

      if (!cancelled) {
        setLotsByProductId(nextLots);
        setLotSelections(nextSel);
        setIsLoadingLots(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, selectedKitId, warehouseId, kits]);

  const warehouseOptions = useMemo(
    () => warehouses.filter((w) => validWarehouseIds.includes(w.id)),
    [warehouses, validWarehouseIds]
  );

  const lotSelectionComplete = useMemo(() => {
    if (!selectedKit || !warehouseId || kitConflictMessage) return false;
    for (const kp of selectedKit.kit_products) {
      const key = lotSelections[kp.id];
      if (!key) return false;
      const lots = lotsByProductId[kp.product_id] || [];
      const chosen = lots.find(
        (l) => encodeLotSelection(l.expirationDate, l.lotNumber) === key
      );
      if (!chosen || chosen.quantity < kp.quantity) return false;
    }
    const initialByProduct = new Map<string, LotBalance[]>();
    const pids = [...new Set(selectedKit.kit_products.map((k) => k.product_id))];
    for (const pid of pids) {
      initialByProduct.set(pid, [...(lotsByProductId[pid] || [])]);
    }
    const lines = selectedKit.kit_products.map((kp) => {
      const { expirationDate, lotNumber } = decodeLotSelection(lotSelections[kp.id] || "");
      return {
        productId: kp.product_id,
        quantity: kp.quantity,
        expirationDate,
        lotNumber,
      };
    });
    return validateSequentialLotConsumption(initialByProduct, lines).ok;
  }, [selectedKit, warehouseId, kitConflictMessage, lotsByProductId, lotSelections]);

  function resetForm() {
    setSelectedKitId("");
    setRecipient("");
    setNotes("");
    setWarehouseId("");
    setValidWarehouseIds([]);
    setKitConflictMessage(null);
    setLotsByProductId({});
    setLotSelections({});
    setIsSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedKit || !warehouseId) return;
    setIsSubmitting(true);

    const lines = selectedKit.kit_products.map((kp) => {
      const { expirationDate, lotNumber } = decodeLotSelection(lotSelections[kp.id] || "");
      return {
        kit_product_id: kp.id,
        quantity: kp.quantity,
        expiration_date: expirationDate,
        lot_number: lotNumber,
      };
    });

    const result = await registerKitExit({
      kit_id: selectedKit.id,
      warehouse_id: warehouseId,
      recipient: recipient || undefined,
      notes: notes || undefined,
      lines,
    });

    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || "Salida del kit registrada");
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-red-600" />
            Salida de Kit
          </SheetTitle>
          <SheetDescription>
            Elegí un almacén donde estén todos los componentes; luego seleccioná vencimiento/lote por
            producto.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="kit">Kit *</Label>
              <Select
                value={selectedKitId}
                onValueChange={setSelectedKitId}
                required
                disabled={isSubmitting}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Seleccionar kit" />
                </SelectTrigger>
                <SelectContent>
                  {kits.map((kit) => (
                    <SelectItem key={kit.id} value={kit.id}>
                      <div className="flex items-center gap-2">
                        <Boxes className="h-4 w-4" />
                        <div>
                          <div className="font-medium">{kit.name}</div>
                          <div className="text-xs text-slate-500">
                            {kit.kit_products.length} producto(s)
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="kit-warehouse">Almacén *</Label>
              <Select
                value={warehouseId || undefined}
                onValueChange={setWarehouseId}
                disabled={
                  isSubmitting ||
                  isLoadingWarehouses ||
                  !selectedKitId ||
                  validWarehouseIds.length === 0
                }
              >
                <SelectTrigger id="kit-warehouse" className="h-12">
                  <SelectValue
                    placeholder={
                      !selectedKitId
                        ? "Primero elegí un kit"
                        : validWarehouseIds.length === 0
                          ? "Sin almacén válido"
                          : "Seleccionar almacén"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {warehouseOptions.map((w) => (
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
                Solo se listan almacenes donde hay stock de todos los ítems del kit a la vez.
              </p>
            </div>

            {kitConflictMessage && selectedKitId && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{kitConflictMessage}</span>
              </div>
            )}

            {selectedKit && warehouseId && !kitConflictMessage && (
              <div className="rounded-lg border border-slate-200 p-4 space-y-4">
                <h4 className="text-sm font-semibold text-slate-700">
                  Lote / vencimiento por producto
                </h4>
                {isLoadingLots ? (
                  <p className="text-sm text-slate-500">Cargando lotes…</p>
                ) : (
                  <div className="space-y-4">
                    {selectedKit.kit_products.map((kp) => {
                      const product = kp.product;
                      const lots = lotsByProductId[kp.product_id] || [];
                      const viable = lots.filter((l) => l.quantity >= kp.quantity);
                      const value = lotSelections[kp.id] || "";

                      return (
                        <div
                          key={kp.id}
                          className="rounded-md border border-slate-100 bg-slate-50/80 p-3 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                            <Package className="h-4 w-4 text-slate-400" />
                            {product?.name || "Producto"}
                            <span className="text-slate-500 font-normal">
                              — salir {kp.quantity} u.
                            </span>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-slate-600">Origen (vencimiento / lote)</Label>
                            <Select
                              value={value || undefined}
                              onValueChange={(v) =>
                                setLotSelections((prev) => ({ ...prev, [kp.id]: v }))
                              }
                              disabled={isSubmitting || viable.length === 0}
                            >
                              <SelectTrigger className="h-10 bg-white">
                                <SelectValue
                                  placeholder={
                                    viable.length === 0
                                      ? "Sin lote con stock suficiente"
                                      : "Elegir lote"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {viable.map((l) => {
                                  const k = encodeLotSelection(l.expirationDate, l.lotNumber);
                                  return (
                                    <SelectItem key={k} value={k}>
                                      {formatLotLabel(l)}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-xs text-slate-600">
                            Unidades a descontar:{" "}
                            <span className="font-semibold tabular-nums">{kp.quantity}</span> (fijado
                            por el kit)
                          </p>
                          {viable.length === 0 && lots.length > 0 && (
                            <p className="text-xs text-amber-700 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Ningún lote tiene {kp.quantity} u. disponibles en este almacén.
                            </p>
                          )}
                          {lots.length === 0 && (
                            <p className="text-xs text-amber-700 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              No hay movimientos trazables en este almacén para este producto.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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
                  placeholder="Ej: Clínica XYZ, Dr. Pérez"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isSubmitting}
                  className="pl-10 min-h-[80px]"
                  placeholder="Observaciones sobre la salida del kit..."
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  resetForm();
                  onOpenChange(false);
                }}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                disabled={
                  isSubmitting ||
                  !selectedKitId ||
                  !warehouseId ||
                  !!kitConflictMessage ||
                  !lotSelectionComplete ||
                  isLoadingLots
                }
              >
                {isSubmitting ? (
                  <>
                    <span className="mr-2">Procesando...</span>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </>
                ) : (
                  "Confirmar Salida del Kit"
                )}
              </Button>
            </div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
