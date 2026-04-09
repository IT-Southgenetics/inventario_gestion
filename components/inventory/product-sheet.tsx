"use client";

import { useState, useEffect } from "react";
import { Package, Hash, FileText, AlertCircle, Plus, Palette } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { createProduct, updateProduct, createCategory } from "@/actions/inventory";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import type { Category, Product } from "@/types/database";

interface ProductSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  product?: Product | null;
}

export function ProductSheet({
  open,
  onOpenChange,
  onSuccess,
  product,
}: ProductSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#14b8a6"); // Teal por defecto

  // Form state
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [minStock, setMinStock] = useState("0");
  const [categoryId, setCategoryId] = useState("");

  useEffect(() => {
    if (open) {
      loadCategories();
      if (product) {
        setName(product.name);
        setSku(product.sku);
        setDescription(product.description || "");
        setMinStock(product.min_stock.toString());
        setCategoryId(product.category_id.toString());
      } else {
        resetForm(); // Resetear el formulario si es nuevo producto
      }
    }
  }, [open, product]);

  async function loadCategories() {
    setIsLoadingCategories(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setIsLoadingCategories(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (!profile) {
      setIsLoadingCategories(false);
      return;
    }

    const countryCode = profile.country_code || "MX";

    const { data: categoriesData } = await supabase
      .from("categories")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    setCategories(categoriesData || []);
    setIsLoadingCategories(false);
  }

  function resetForm() {
    setName("");
    setSku("");
    setDescription("");
    setMinStock("0");
    setCategoryId("");
    setIsSubmitting(false);
  }

  async function handleCreateCategory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsCreatingCategory(true);

    const formData = new FormData();
    formData.append("name", newCategoryName);
    formData.append("color", newCategoryColor);

    const result = await createCategory(formData);

    if (result?.error) {
      toast.error(result.error);
      setIsCreatingCategory(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || "Categoría creada correctamente");
      setNewCategoryName("");
      setNewCategoryColor("#14b8a6"); // Reset a color por defecto
      setIsCategoryDialogOpen(false);
      setIsCreatingCategory(false);
      // Recargar categorías y seleccionar la nueva
      await loadCategories();
      if (result.data) {
        setCategoryId(result.data.id.toString());
      }
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData();
    formData.append("name", name);
    formData.append("sku", sku);
    formData.append("description", description);
    formData.append("min_stock", minStock);
    formData.append("category_id", categoryId);

    const result = product
      ? await updateProduct(product.id, formData)
      : await createProduct(formData);

    if (result?.error) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || (product ? "Producto actualizado correctamente" : "Producto creado correctamente"));
      resetForm();
      onSuccess?.();
      // Cerrar el Sheet después de un pequeño delay para asegurar que todo se procese
      setTimeout(() => {
        onOpenChange(false);
      }, 100);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-lg overflow-y-auto bg-teal-600 border-teal-700 [&>button]:text-white [&>button]:hover:bg-teal-500/20"
      >
        <SheetHeader className="border-b border-teal-500/30 pb-4">
          <SheetTitle className="flex items-center gap-2 text-white">
            <div className="p-2 rounded-lg bg-teal-500/20">
              <Package className="h-5 w-5 text-white" />
            </div>
            {product ? "Editar Producto" : "Nuevo Producto"}
          </SheetTitle>
          <SheetDescription className="text-teal-50/90">
            {product
              ? "Modifica la información del producto"
              : "Completa la información para agregar un nuevo producto al inventario"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nombre */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-white">Nombre del Producto *</Label>
              <div className="relative">
                <Package className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-teal-300" />
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="pl-10 h-12 bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900 placeholder:text-slate-400"
                  placeholder="Ej: Kit BRCA1/2"
                />
              </div>
            </div>

            {/* SKU */}
            <div className="space-y-2">
              <Label htmlFor="sku" className="text-white">SKU (Código) *</Label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-teal-300" />
                <Input
                  id="sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  required
                  disabled={isSubmitting || !!product}
                  className="pl-10 h-12 bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900 placeholder:text-slate-400"
                  placeholder="Ej: KIT-BRCA-001"
                />
              </div>
              <p className="text-xs text-teal-50/80">
                {product
                  ? "El SKU no se puede modificar después de crear el producto"
                  : "El SKU debe ser único en tu organización"}
              </p>
            </div>

            {/* Categoría */}
            <div className="space-y-2">
              <Label htmlFor="category" className="text-white">Categoría *</Label>
              <Select
                value={categoryId === "__add_category__" ? "" : categoryId}
                onValueChange={(value) => {
                  if (value === "__add_category__") {
                    setIsCategoryDialogOpen(true);
                    // No cambiar el valor del select
                    return;
                  }
                  setCategoryId(value);
                }}
                required
                disabled={isSubmitting || isLoadingCategories}
              >
                <SelectTrigger className="h-12 bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900">
                  <SelectValue placeholder="Seleccionar categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id.toString()}>
                      <div className="flex items-center gap-2">
                        {category.color && (
                          <div
                            className="w-4 h-4 rounded-full border border-slate-200"
                            style={{ backgroundColor: category.color }}
                          />
                        )}
                        <span>{category.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                  <div className="border-t border-slate-200 my-1" />
                  <SelectItem
                    value="__add_category__"
                    className="text-teal-600 font-medium focus:text-teal-700"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Agregar categoría
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {categories.length === 0 && !isLoadingCategories && (
                <p className="text-sm text-amber-200 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  No hay categorías. Crea una categoría primero.
                </p>
              )}
            </div>

            {/* Stock Mínimo */}
            <div className="space-y-2">
              <Label htmlFor="min_stock" className="text-white">Stock Mínimo *</Label>
              <Input
                id="min_stock"
                type="number"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                required
                disabled={isSubmitting}
                className="h-12 bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900 placeholder:text-slate-400"
                placeholder="0"
              />
              <p className="text-xs text-teal-50/80">
                Se mostrará una alerta cuando el stock esté por debajo de este
                valor
              </p>
            </div>

            {/* Descripción */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-white">Descripción</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 h-5 w-5 text-teal-300" />
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                  className="pl-10 min-h-[100px] bg-white/95 border-white/20 focus:bg-white focus:border-white/40 text-slate-900 placeholder:text-slate-400"
                  placeholder="Descripción opcional del producto..."
                />
              </div>
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
                className="flex-1 bg-white text-teal-600 hover:bg-teal-50 font-semibold"
                disabled={
                  isSubmitting ||
                  !name ||
                  !sku ||
                  !categoryId ||
                  minStock === "" ||
                  categories.length === 0
                }
              >
                {isSubmitting ? (
                  <>
                    <span className="mr-2">Guardando...</span>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
                  </>
                ) : (
                  product ? "Actualizar Producto" : "Crear Producto"
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Dialog para crear categoría */}
        <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-teal-600" />
                Nueva Categoría
              </DialogTitle>
              <DialogDescription>
                Crea una nueva categoría para organizar tus productos
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateCategory}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="category_name">Nombre de la Categoría *</Label>
                  <Input
                    id="category_name"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    required
                    disabled={isCreatingCategory}
                    placeholder="Ej: Oncológicos, Ginecológicos"
                    className="h-12"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="category_color" className="flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    Color de la Categoría
                  </Label>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <input
                        type="color"
                        id="category_color"
                        value={newCategoryColor}
                        onChange={(e) => setNewCategoryColor(e.target.value)}
                        disabled={isCreatingCategory}
                        className="h-12 w-20 rounded-lg border-2 border-slate-200 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        type="text"
                        value={newCategoryColor}
                        onChange={(e) => setNewCategoryColor(e.target.value)}
                        disabled={isCreatingCategory}
                        placeholder="#14b8a6"
                        className="h-12 font-mono"
                        pattern="^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Elige un color para identificar visualmente esta categoría
                  </p>
                  {/* Colores predefinidos */}
                  <div className="flex gap-2 flex-wrap mt-2">
                    {[
                      { name: "Teal", value: "#14b8a6" },
                      { name: "Azul", value: "#3b82f6" },
                      { name: "Violeta", value: "#8b5cf6" },
                      { name: "Rosa", value: "#ec4899" },
                      { name: "Naranja", value: "#f97316" },
                      { name: "Verde", value: "#10b981" },
                      { name: "Rojo", value: "#ef4444" },
                      { name: "Amarillo", value: "#eab308" },
                    ].map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        onClick={() => setNewCategoryColor(color.value)}
                        disabled={isCreatingCategory}
                        className={`w-10 h-10 rounded-lg border-2 transition-all ${
                          newCategoryColor === color.value
                            ? "border-slate-900 scale-110 shadow-md"
                            : "border-slate-200 hover:border-slate-400"
                        }`}
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCategoryDialogOpen(false);
                    setNewCategoryName("");
                    setNewCategoryColor("#14b8a6");
                  }}
                  disabled={isCreatingCategory}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                  disabled={isCreatingCategory || !newCategoryName}
                >
                  {isCreatingCategory ? "Creando..." : "Crear Categoría"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

