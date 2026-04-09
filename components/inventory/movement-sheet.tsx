"use client";

import { useState, useEffect, useLayoutEffect, useMemo } from "react";
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
  Boxes,
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
import { registerMovement, registerKitExit } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import {
  formatARS,
  calcularImpuestoPAIS,
  calcularPercepcionGanancias,
  AR_TAXES,
} from "@/lib/countries";
import {
  computeLotBalancesForProduct,
  decodeLotSelection,
  encodeLotSelection,
  formatLotLabel,
  validateSequentialLotConsumption,
  type LotBalance,
  type LotMovementInput,
} from "@/lib/kit-lot-balance";
import toast from "react-hot-toast";
import type {
  Product,
  Supplier,
  Warehouse as WarehouseType,
  Kit,
  KitProduct,
} from "@/types/database";

type KitWithProducts = Kit & {
  kit_products: (KitProduct & { product?: Product })[];
};

function resolveKitForProduct(
  productId: string,
  productList: Product[],
  kits: KitWithProducts[]
): KitWithProducts | null {
  if (!productId || kits.length === 0) return null;
  const p = productList.find((x) => x.id === productId);
  if (!p) return null;
  const n = p.name.trim().toLowerCase();
  return kits.find((k) => k.name.trim().toLowerCase() === n) ?? null;
}

interface MovementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Si un producto tiene el mismo nombre que un kit, la salida usa el flujo por componentes y lotes. */
  kits?: KitWithProducts[];
  onSuccess?: () => void;
}

export function MovementSheet({
  open,
  onOpenChange,
  products,
  kits = [],
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

  const [salidaLotBalances, setSalidaLotBalances] = useState<LotBalance[]>([]);
  const [salidaLotKey, setSalidaLotKey] = useState("");
  const [isLoadingSalidaLots, setIsLoadingSalidaLots] = useState(false);
  /** Almacenes donde este producto tiene stock > 0 (salidas deben elegir uno para trazar vencimiento). */
  const [warehouseIdsWithStock, setWarehouseIdsWithStock] = useState<string[]>([]);

  const [kitValidWarehouseIds, setKitValidWarehouseIds] = useState<string[]>([]);
  const [kitConflictMessage, setKitConflictMessage] = useState<string | null>(null);
  const [kitLotsByProductId, setKitLotsByProductId] = useState<Record<string, LotBalance[]>>({});
  const [kitLotSelections, setKitLotSelections] = useState<Record<string, string>>({});
  const [isLoadingKitLots, setIsLoadingKitLots] = useState(false);

  const resolvedKit = useMemo(
    () => resolveKitForProduct(productId, products, kits),
    [productId, products, kits]
  );
  const kitSalidaMode = movementType === "Salida" && Boolean(resolvedKit);

  const productHasWarehouseStock = warehouseIdsWithStock.length > 0;

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

  useEffect(() => {
    if (!open || movementType !== "Salida" || !productId || kitSalidaMode) {
      setWarehouseIdsWithStock([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: wsRows } = await supabase
        .from("warehouse_stock")
        .select("warehouse_id")
        .eq("product_id", productId)
        .gt("current_stock", 0);

      const rawIds = [...new Set((wsRows || []).map((r) => r.warehouse_id))];
      const allowed = new Set(warehouses.map((w) => w.id));
      const ids =
        warehouses.length > 0
          ? rawIds.filter((id) => allowed.has(id))
          : rawIds;

      if (!cancelled) {
        setWarehouseIdsWithStock(ids);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, movementType, productId, warehouses, kitSalidaMode]);

  useEffect(() => {
    if (!open || !kitSalidaMode || !resolvedKit) {
      setKitValidWarehouseIds([]);
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

      const productIds = [...new Set(resolvedKit.kit_products.map((kp) => kp.product_id))];
      if (productIds.length === 0) {
        if (!cancelled) {
          setKitValidWarehouseIds([]);
          setKitConflictMessage("Este kit no tiene productos.");
        }
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
        for (const kp of resolvedKit.kit_products) {
          if ((stockMap.get(kp.product_id) ?? 0) < kp.quantity) {
            ok = false;
            break;
          }
        }
        if (ok) valid.push(whId);
      }

      if (!cancelled) {
        setKitValidWarehouseIds(valid);
        setKitConflictMessage(
          valid.length === 0
            ? "Los componentes del kit no están todos en el mismo almacén con stock suficiente."
            : null
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, kitSalidaMode, resolvedKit]);

  useEffect(() => {
    if (!kitSalidaMode) return;
    if (kitValidWarehouseIds.length === 0) {
      return;
    }
    if (kitValidWarehouseIds.length === 1 && warehouseId === "__none__") {
      setWarehouseId(kitValidWarehouseIds[0]);
    } else if (
      warehouseId !== "__none__" &&
      !kitValidWarehouseIds.includes(warehouseId)
    ) {
      setWarehouseId(kitValidWarehouseIds.length === 1 ? kitValidWarehouseIds[0] : "__none__");
    }
  }, [kitSalidaMode, kitValidWarehouseIds, warehouseId]);

  useEffect(() => {
    if (!open || !kitSalidaMode || !resolvedKit || !warehouseId || warehouseId === "__none__") {
      setKitLotsByProductId({});
      setKitLotSelections({});
      setIsLoadingKitLots(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoadingKitLots(true);
      const supabase = createClient();
      const productIds = [...new Set(resolvedKit.kit_products.map((kp) => kp.product_id))];

      const { data: movRows, error } = await supabase
        .from("movements")
        .select("product_id, type, quantity, expiration_date, lot_number, created_at")
        .in("product_id", productIds)
        .eq("warehouse_id", warehouseId)
        .order("created_at", { ascending: true });

      if (error) {
        if (!cancelled) {
          toast.error("Error al cargar lotes: " + error.message);
          setIsLoadingKitLots(false);
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
      for (const kp of resolvedKit.kit_products) {
        const lots = nextLots[kp.product_id] || [];
        const pick = lots.find((l) => l.quantity >= kp.quantity);
        nextSel[kp.id] = pick ? encodeLotSelection(pick.expirationDate, pick.lotNumber) : "";
      }

      if (!cancelled) {
        setKitLotsByProductId(nextLots);
        setKitLotSelections(nextSel);
        setIsLoadingKitLots(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, kitSalidaMode, resolvedKit, warehouseId]);

  useLayoutEffect(() => {
    if (kitSalidaMode || movementType !== "Salida" || !productHasWarehouseStock) return;
    if (warehouseIdsWithStock.length !== 1) return;
    if (warehouseId !== "__none__") return;
    setWarehouseId(warehouseIdsWithStock[0]);
  }, [kitSalidaMode, movementType, productHasWarehouseStock, warehouseIdsWithStock, warehouseId]);

  useEffect(() => {
    if (!open || movementType !== "Salida" || !productId) {
      setSalidaLotBalances([]);
      setSalidaLotKey("");
      setIsLoadingSalidaLots(false);
      return;
    }

    if (kitSalidaMode) {
      setSalidaLotBalances([]);
      setSalidaLotKey("");
      setIsLoadingSalidaLots(false);
      return;
    }

    if (productHasWarehouseStock && warehouseId === "__none__") {
      setSalidaLotBalances([]);
      setSalidaLotKey("");
      setIsLoadingSalidaLots(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoadingSalidaLots(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setIsLoadingSalidaLots(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id, country_code")
        .eq("id", user.id)
        .single();

      if (!profile || cancelled) {
        setIsLoadingSalidaLots(false);
        return;
      }

      const cc = profile.country_code || "MX";
      let query = supabase
        .from("movements")
        .select("type, quantity, expiration_date, lot_number, created_at")
        .eq("organization_id", profile.organization_id)
        .eq("country_code", cc)
        .eq("product_id", productId)
        .order("created_at", { ascending: true });

      if (warehouseId !== "__none__") {
        query = query.eq("warehouse_id", warehouseId);
      } else {
        query = query.is("warehouse_id", null);
      }

      const { data: movRows, error } = await query;

      if (error) {
        if (!cancelled) {
          toast.error("Error al cargar lotes: " + error.message);
          setSalidaLotBalances([]);
          setSalidaLotKey("");
          setIsLoadingSalidaLots(false);
        }
        return;
      }

      const inputs: LotMovementInput[] = (movRows || []).map((m) => ({
        type: m.type as "Entrada" | "Salida",
        quantity: m.quantity,
        expiration_date: m.expiration_date,
        lot_number: m.lot_number,
        created_at: m.created_at,
      }));

      const balances = computeLotBalancesForProduct(inputs);
      if (!cancelled) {
        setSalidaLotBalances(balances);
        setIsLoadingSalidaLots(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, movementType, productId, warehouseId, productHasWarehouseStock, kitSalidaMode]);

  const qtyNum = useMemo(() => {
    const n = parseInt(quantity, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [quantity]);

  const salidaViableLots = useMemo(() => {
    if (qtyNum <= 0) return [];
    return salidaLotBalances.filter((b) => b.quantity >= qtyNum);
  }, [salidaLotBalances, qtyNum]);

  const needsSalidaLotPick =
    movementType === "Salida" &&
    !kitSalidaMode &&
    productId &&
    (!productHasWarehouseStock || warehouseId !== "__none__") &&
    salidaLotBalances.length > 0;

  const salidaLotStepOk = useMemo(() => {
    if (movementType !== "Salida") return true;
    if (kitSalidaMode) return true;
    if (productHasWarehouseStock && warehouseId === "__none__") return false;
    if (salidaLotBalances.length === 0) return true;
    if (qtyNum <= 0) return false;
    if (salidaViableLots.length === 0) return false;
    return salidaViableLots.some(
      (l) => encodeLotSelection(l.expirationDate, l.lotNumber) === salidaLotKey
    );
  }, [
    movementType,
    productHasWarehouseStock,
    warehouseId,
    salidaLotBalances.length,
    qtyNum,
    salidaViableLots,
    salidaLotKey,
    kitSalidaMode,
  ]);

  const lotKitSelectionComplete = useMemo(() => {
    if (!kitSalidaMode || !resolvedKit) return false;
    if (!warehouseId || warehouseId === "__none__" || kitConflictMessage) return false;

    for (const kp of resolvedKit.kit_products) {
      const key = kitLotSelections[kp.id];
      if (!key) return false;
      const lots = kitLotsByProductId[kp.product_id] || [];
      const chosen = lots.find(
        (l) => encodeLotSelection(l.expirationDate, l.lotNumber) === key
      );
      if (!chosen || chosen.quantity < kp.quantity) return false;
    }

    const initialByProduct = new Map<string, LotBalance[]>();
    const pids = [...new Set(resolvedKit.kit_products.map((k) => k.product_id))];
    for (const pid of pids) {
      initialByProduct.set(pid, [...(kitLotsByProductId[pid] || [])]);
    }
    const lines = resolvedKit.kit_products.map((kp) => {
      const { expirationDate, lotNumber } = decodeLotSelection(kitLotSelections[kp.id] || "");
      return {
        productId: kp.product_id,
        quantity: kp.quantity,
        expirationDate,
        lotNumber,
      };
    });
    return validateSequentialLotConsumption(initialByProduct, lines).ok;
  }, [
    kitSalidaMode,
    resolvedKit,
    warehouseId,
    kitConflictMessage,
    kitLotsByProductId,
    kitLotSelections,
  ]);

  const kitWarehouseOptions = useMemo(
    () => warehouses.filter((w) => kitValidWarehouseIds.includes(w.id)),
    [warehouses, kitValidWarehouseIds]
  );

  const canSubmitMovement = useMemo(() => {
    if (!productId) return false;
    if (!movementDate?.trim()) return false;

    if (movementType === "Entrada") {
      return qtyNum > 0;
    }

    if (kitSalidaMode && resolvedKit) {
      if (!warehouseId || warehouseId === "__none__") return false;
      if (kitConflictMessage) return false;
      if (isLoadingKitLots) return false;
      return lotKitSelectionComplete;
    }

    return qtyNum > 0 && salidaLotStepOk;
  }, [
    productId,
    movementDate,
    movementType,
    kitSalidaMode,
    resolvedKit,
    warehouseId,
    kitConflictMessage,
    isLoadingKitLots,
    lotKitSelectionComplete,
    qtyNum,
    salidaLotStepOk,
  ]);

  useEffect(() => {
    if (!needsSalidaLotPick) return;
    setSalidaLotKey((prev) => {
      if (salidaViableLots.length === 0) return "";
      if (prev) {
        const still = salidaViableLots.find(
          (l) => encodeLotSelection(l.expirationDate, l.lotNumber) === prev
        );
        if (still) return prev;
      }
      const first = salidaViableLots[0];
      return encodeLotSelection(first.expirationDate, first.lotNumber);
    });
  }, [needsSalidaLotPick, salidaViableLots]);

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
    setSalidaLotBalances([]);
    setSalidaLotKey("");
    setWarehouseIdsWithStock([]);
    setKitValidWarehouseIds([]);
    setKitConflictMessage(null);
    setKitLotsByProductId({});
    setKitLotSelections({});
    setIsLoadingKitLots(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (movementType === "Salida" && kitSalidaMode && resolvedKit) {
      setIsSubmitting(true);
      if (!warehouseId || warehouseId === "__none__") {
        toast.error("Seleccioná un almacén");
        setIsSubmitting(false);
        return;
      }

      const lines = resolvedKit.kit_products.map((kp) => {
        const { expirationDate, lotNumber } = decodeLotSelection(kitLotSelections[kp.id] || "");
        return {
          kit_product_id: kp.id,
          quantity: kp.quantity,
          expiration_date: expirationDate,
          lot_number: lotNumber,
        };
      });

      const result = await registerKitExit({
        kit_id: resolvedKit.id,
        warehouse_id: warehouseId,
        movement_date: movementDate,
        recipient: recipient || undefined,
        notes: notes || undefined,
        lines,
      });

      if (result?.error) {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      toast.success(result?.message || "Salida del kit registrada");
      resetForm();
      setIsSubmitting(false);
      onOpenChange(false);
      onSuccess?.();
      return;
    }

    setIsSubmitting(true);

    const formData = new FormData();
    formData.append("product_id", productId);
    formData.append("type", movementType);
    formData.append("quantity", quantity);
    formData.append("movement_date", movementDate);
    if (movementType === "Entrada") {
      if (lotNumber) formData.append("lot_number", lotNumber);
      if (expirationDate) formData.append("expiration_date", expirationDate);
    } else if (salidaLotKey) {
      const { expirationDate: salidaExp, lotNumber: salidaLot } =
        decodeLotSelection(salidaLotKey);
      if (salidaExp) formData.append("expiration_date", salidaExp);
      if (salidaLot) formData.append("lot_number", salidaLot);
    }
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
      <SheetContent
        side="right"
        className={`w-full overflow-y-auto ${kitSalidaMode ? "sm:max-w-xl" : "sm:max-w-lg"}`}
      >
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
              : kitSalidaMode && resolvedKit
                ? `Salida del kit «${resolvedKit.name}»: elegí almacén y lote/vencimiento por cada componente.`
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
              {isLowStock && movementType === "Salida" && !kitSalidaMode && (
                <p className="text-sm text-orange-600 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Stock bajo. Verifica disponibilidad antes de registrar salida.
                </p>
              )}
            </div>

            {kitSalidaMode && resolvedKit && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 flex gap-2">
                <Boxes className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Este producto coincide con el kit <strong>{resolvedKit.name}</strong>. La salida
                  registra movimientos por cada componente con el vencimiento/lote que elijas.
                </span>
              </div>
            )}

            {movementType === "Salida" && kitSalidaMode && resolvedKit && (
              <div className="space-y-2">
                <Label htmlFor="warehouse_kit_salida">Almacén *</Label>
                <Select
                  value={warehouseId === "__none__" ? undefined : warehouseId}
                  onValueChange={setWarehouseId}
                  disabled={
                    isSubmitting ||
                    isLoadingWarehouses ||
                    kitValidWarehouseIds.length === 0
                  }
                >
                  <SelectTrigger id="warehouse_kit_salida" className="h-12">
                    <SelectValue
                      placeholder={
                        kitValidWarehouseIds.length === 0
                          ? "Sin almacén válido para el kit"
                          : "Seleccionar almacén"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {kitWarehouseOptions.map((w) => (
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
                  Solo se listan almacenes donde hay stock de todos los componentes del kit a la vez.
                </p>
                {kitConflictMessage && (
                  <p className="text-sm text-amber-800 flex gap-1 items-start rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    {kitConflictMessage}
                  </p>
                )}
              </div>
            )}

            {movementType === "Salida" && !kitSalidaMode && (
              <div className="space-y-2">
                <Label htmlFor="warehouse_salida">
                  Almacén{productHasWarehouseStock ? " *" : ""}
                </Label>
                <Select
                  value={warehouseId}
                  onValueChange={setWarehouseId}
                  disabled={isSubmitting || isLoadingWarehouses}
                >
                  <SelectTrigger id="warehouse_salida" className="h-12">
                    <SelectValue
                      placeholder={
                        productHasWarehouseStock
                          ? "De qué ubicación sale el stock"
                          : "Sin almacén (stock global)"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {productHasWarehouseStock && warehouseIdsWithStock.length > 1 && (
                      <SelectItem value="__none__" disabled className="opacity-60">
                        Seleccioná un almacén…
                      </SelectItem>
                    )}
                    {!productHasWarehouseStock && (
                      <SelectItem value="__none__">Sin almacén (solo global)</SelectItem>
                    )}
                    {(productHasWarehouseStock
                      ? warehouses.filter((w) => warehouseIdsWithStock.includes(w.id))
                      : warehouses
                    ).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        <div className="flex items-center gap-2">
                          <Warehouse className="h-4 w-4" />
                          {w.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {productHasWarehouseStock && warehouseId === "__none__" && (
                  <p className="text-sm text-amber-700 flex gap-1 items-start">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    Elegí el almacén para ver y elegir la fecha de vencimiento (mismo producto puede
                    tener distintos vencimientos según el lote).
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  {productHasWarehouseStock
                    ? "Las cantidades por vencimiento se calculan solo para el almacén elegido."
                    : "Sin stock en almacenes: se usan movimientos sin ubicación."}
                </p>
              </div>
            )}

            {/* Cantidad (no aplica a salida de kit: cantidades fijas por definición del kit) */}
            {!(movementType === "Salida" && kitSalidaMode) && (
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
            )}

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

            {movementType === "Entrada" && (
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
            )}

            {kitSalidaMode &&
              resolvedKit &&
              warehouseId !== "__none__" &&
              !kitConflictMessage && (
                <div className="rounded-lg border border-slate-200 p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-slate-700">
                    Lote / vencimiento por componente
                  </h4>
                  {isLoadingKitLots ? (
                    <p className="text-sm text-slate-500">Cargando lotes…</p>
                  ) : (
                    <div className="space-y-4">
                      {resolvedKit.kit_products.map((kp) => {
                        const comp = kp.product;
                        const lots = kitLotsByProductId[kp.product_id] || [];
                        const viable = lots.filter((l) => l.quantity >= kp.quantity);
                        const value = kitLotSelections[kp.id] || "";

                        return (
                          <div
                            key={kp.id}
                            className="rounded-md border border-slate-100 bg-slate-50/80 p-3 space-y-2"
                          >
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                              <Package className="h-4 w-4 text-slate-400" />
                              {comp?.name || "Producto"}
                              <span className="text-slate-500 font-normal">
                                — salir {kp.quantity} u.
                              </span>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-slate-600">
                                Origen (vencimiento / lote)
                              </Label>
                              <Select
                                value={value || undefined}
                                onValueChange={(v) =>
                                  setKitLotSelections((prev) => ({ ...prev, [kp.id]: v }))
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

            {movementType === "Salida" &&
              !kitSalidaMode &&
              productId &&
              (!productHasWarehouseStock || warehouseId !== "__none__") && (
              <div className="space-y-2">
                {isLoadingSalidaLots ? (
                  <p className="text-sm text-slate-500">Cargando vencimientos y lotes…</p>
                ) : salidaLotBalances.length > 0 ? (
                  <>
                    <Label htmlFor="salida_lot">
                      Vencimiento / lote de origen *
                    </Label>
                    {salidaViableLots.length > 0 ? (
                      <Select
                        value={salidaLotKey}
                        onValueChange={setSalidaLotKey}
                        disabled={isSubmitting}
                        required
                      >
                        <SelectTrigger id="salida_lot" className="h-12">
                          <SelectValue placeholder="Elegir vencimiento y lote" />
                        </SelectTrigger>
                        <SelectContent>
                          {salidaViableLots.map((l) => {
                            const k = encodeLotSelection(l.expirationDate, l.lotNumber);
                            return (
                              <SelectItem key={k} value={k}>
                                {formatLotLabel(l)}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-orange-600 flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {qtyNum > 0
                          ? "Ningún lote en este almacén tiene stock suficiente para la cantidad indicada."
                          : "Indicá una cantidad válida para ver los lotes disponibles."}
                      </p>
                    )}
                    {salidaViableLots.length > 0 && (
                      <p className="text-xs text-slate-500">
                        Mismo producto puede tener varios vencimientos; la salida debe indicar de
                        cuál se descuenta el stock en este almacén.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    No hay historial con vencimiento/lote en esta ubicación para este producto; la
                    salida no exige elegir lote. Si cargaste entradas sin fecha de vencimiento, todo
                    el stock aparece como un solo lote al calcular saldos.
                  </p>
                )}
              </div>
            )}

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
                disabled={isSubmitting || !canSubmitMovement}
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
