"use client";

import { useState, useEffect } from "react";
import { Boxes, Plus, Trash2, Package, FileText } from "lucide-react";
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
import { createKit, updateKit } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import type { Product, Kit, KitProduct } from "@/types/database";

interface KitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  kit?: (Kit & { kit_products?: (KitProduct & { product?: Product })[] }) | null;
  products: Product[];
}

interface KitProductEntry {
  product_id: string;
  quantity: number;
}

export function KitSheet({
  open,
  onOpenChange,
  onSuccess,
  kit,
  products,
}: KitSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kitProducts, setKitProducts] = useState<KitProductEntry[]>([
    { product_id: "", quantity: 1 },
  ]);

  useEffect(() => {
    if (open) {
      if (kit) {
        setName(kit.name);
        setDescription(kit.description || "");
        if (kit.kit_products && kit.kit_products.length > 0) {
          setKitProducts(
            kit.kit_products.map((kp) => ({
              product_id: kp.product_id,
              quantity: kp.quantity,
            }))
          );
        } else {
          setKitProducts([{ product_id: "", quantity: 1 }]);
        }
      } else {
        resetForm();
      }
    }
  }, [open, kit]);

  function resetForm() {
    setName("");
    setDescription("");
    setKitProducts([{ product_id: "", quantity: 1 }]);
    setIsSubmitting(false);
  }

  function addProduct() {
    setKitProducts([...kitProducts, { product_id: "", quantity: 1 }]);
  }

  function removeProduct(index: number) {
    if (kitProducts.length <= 1) return;
    setKitProducts(kitProducts.filter((_, i) => i !== index));
  }

  function updateKitProduct(
    index: number,
    field: "product_id" | "quantity",
    value: string | number
  ) {
    const updated = [...kitProducts];
    if (field === "product_id") {
      updated[index].product_id = value as string;
    } else {
      updated[index].quantity = value as number;
    }
    setKitProducts(updated);
  }

  const selectedProductIds = kitProducts.map((kp) => kp.product_id).filter(Boolean);

  function getAvailableProducts(currentProductId: string) {
    return products.filter(
      (p) => p.id === currentProductId || !selectedProductIds.includes(p.id)
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    const validProducts = kitProducts.filter((kp) => kp.product_id && kp.quantity > 0);

    if (validProducts.length === 0) {
      toast.error("Agrega al menos un producto al kit");
      setIsSubmitting(false);
      return;
    }

    const data = {
      name,
      description: description || undefined,
      products: validProducts,
    };

    const result = kit
      ? await updateKit(kit.id, data)
      : await createKit(data);

    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || (kit ? "Kit actualizado" : "Kit creado"));
      resetForm();
      onSuccess?.();
      setTimeout(() => onOpenChange(false), 100);
    }
  }

  const isFormValid =
    name.trim() !== "" &&
    kitProducts.some((kp) => kp.product_id && kp.quantity > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto bg-indigo-600 border-indigo-700 [&>button]:text-white [&>button]:hover:bg-indigo-500/20"
      >
        <SheetHeader className="border-b border-indigo-500/30 pb-4">
          <SheetTitle className="flex items-center gap-2 text-white">
            <div className="p-2 rounded-lg bg-indigo-500/20">
              <Boxes className="h-5 w-5 text-white" />
            </div>
            {kit ? "Editar Kit" : "Nuevo Kit"}
          </SheetTitle>
          <SheetDescription className="text-indigo-50/90">
            {kit
              ? "Modifica los productos que componen este kit"
              : "Agrupa productos en un kit para dar salidas en conjunto"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nombre del Kit */}
            <div className="space-y-2">
              <Label htmlFor="kit_name" className="text-white">
                Nombre del Kit *
              </Label>
              <div className="relative">
                <Boxes className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-indigo-300" />
                <Input
                  id="kit_name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="pl-10 h-12 bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900 placeholder:text-slate-400"
                  placeholder="Ej: Kit BRCA1/2 Completo"
                />
              </div>
            </div>

            {/* Descripción */}
            <div className="space-y-2">
              <Label htmlFor="kit_description" className="text-white">
                Descripción
              </Label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 h-5 w-5 text-indigo-300" />
                <Textarea
                  id="kit_description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                  className="pl-10 min-h-[80px] bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900 placeholder:text-slate-400"
                  placeholder="Descripción opcional del kit..."
                />
              </div>
            </div>

            {/* Productos del Kit */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-white">Productos del Kit *</Label>
                <Button
                  type="button"
                  size="sm"
                  onClick={addProduct}
                  disabled={isSubmitting || kitProducts.length >= products.length}
                  className="bg-white/20 hover:bg-white/30 text-white border-0 h-8"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Agregar
                </Button>
              </div>

              <div className="space-y-3">
                {kitProducts.map((kp, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-3 rounded-lg bg-white/10"
                  >
                    <div className="flex-1">
                      <Select
                        value={kp.product_id}
                        onValueChange={(value) =>
                          updateKitProduct(index, "product_id", value)
                        }
                        disabled={isSubmitting}
                      >
                        <SelectTrigger className="h-10 bg-white/95 border-white/20 text-slate-900">
                          <SelectValue placeholder="Seleccionar producto" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableProducts(kp.product_id).map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4" />
                                <span>{product.name}</span>
                                <span className="text-xs text-slate-400">
                                  ({product.sku})
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min="1"
                        value={kp.quantity}
                        onChange={(e) =>
                          updateKitProduct(
                            index,
                            "quantity",
                            parseInt(e.target.value) || 1
                          )
                        }
                        disabled={isSubmitting}
                        className="h-10 bg-white/95 border-white/20 text-slate-900 text-center"
                        title="Cantidad"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeProduct(index)}
                      disabled={isSubmitting || kitProducts.length <= 1}
                      className="h-10 w-10 p-0 text-white/70 hover:text-red-300 hover:bg-red-500/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <p className="text-xs text-indigo-50/70">
                Selecciona los productos y la cantidad de cada uno que componen este kit
              </p>
            </div>

            {/* Botones */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-white text-indigo-600 hover:bg-indigo-50 font-semibold"
                disabled={isSubmitting || !isFormValid}
              >
                {isSubmitting ? (
                  <>
                    <span className="mr-2">Guardando...</span>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  </>
                ) : kit ? (
                  "Actualizar Kit"
                ) : (
                  "Crear Kit"
                )}
              </Button>
            </div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
