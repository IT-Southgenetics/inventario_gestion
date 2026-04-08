"use client";

import { useState } from "react";
import {
  ArrowUpCircle,
  Boxes,
  User,
  FileText,
  Package,
  AlertTriangle,
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
import toast from "react-hot-toast";
import type { Product, Kit, KitProduct } from "@/types/database";

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

  const selectedKit = kits.find((k) => k.id === selectedKitId);

  const hasInsufficientStock = selectedKit?.kit_products.some((kp) => {
    const product = kp.product;
    if (!product) return true;
    return (product.current_stock || 0) < kp.quantity;
  });

  function resetForm() {
    setSelectedKitId("");
    setRecipient("");
    setNotes("");
    setIsSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    const result = await registerKitExit({
      kit_id: selectedKitId,
      recipient: recipient || undefined,
      notes: notes || undefined,
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
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-red-600" />
            Salida de Kit
          </SheetTitle>
          <SheetDescription>
            Selecciona un kit para dar de baja todos sus productos en cascada
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Selección de Kit */}
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

            {/* Detalle del Kit seleccionado */}
            {selectedKit && (
              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-slate-700">
                  Productos que se darán de baja:
                </h4>
                <div className="space-y-2">
                  {selectedKit.kit_products.map((kp) => {
                    const product = kp.product;
                    const currentStock = product?.current_stock || 0;
                    const insufficient = currentStock < kp.quantity;

                    return (
                      <div
                        key={kp.id}
                        className={`flex items-center justify-between p-2 rounded text-sm ${
                          insufficient
                            ? "bg-red-50 border border-red-200"
                            : "bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-slate-400" />
                          <span className="font-medium">
                            {product?.name || "Producto no encontrado"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500">
                            Stock: {currentStock}
                          </span>
                          <span
                            className={`font-semibold ${
                              insufficient ? "text-red-600" : "text-red-500"
                            }`}
                          >
                            -{kp.quantity}
                          </span>
                          {insufficient && (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {hasInsufficientStock && (
                  <p className="text-sm text-red-600 flex items-center gap-1 mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    Stock insuficiente en uno o más productos
                  </p>
                )}
              </div>
            )}

            {/* Destinatario */}
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

            {/* Notas */}
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

            {/* Botones */}
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
                  hasInsufficientStock === true
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
