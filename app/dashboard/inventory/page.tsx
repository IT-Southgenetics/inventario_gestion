"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Package,
  Plus,
  History,
  Edit,
  Trash2,
  Calendar,
  AlertTriangle,
  Boxes,
  ArrowUpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { deleteProduct, deleteKit } from "@/actions/inventory";
import type { Product, Category, Kit, KitProduct } from "@/types/database";

type ProductWithCategory = Product & {
  category?: Category;
  warehouseBreakdown?: { name: string; quantity: number }[];
  /** Próximo vencimiento según entradas con fecha (no usa `products.expiration_date`). */
  nearestEntryExpiration?: string | null;
};

type KitWithProducts = Kit & {
  kit_products: (KitProduct & { product?: Product })[];
};

import { MovementSheet } from "@/components/inventory/movement-sheet";
import { ProductSheet } from "@/components/inventory/product-sheet";
import { KitSheet } from "@/components/inventory/kit-sheet";
import { KitExitSheet } from "@/components/inventory/kit-exit-sheet";

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [isMovementSheetOpen, setIsMovementSheetOpen] = useState(false);
  const [isProductSheetOpen, setIsProductSheetOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithCategory | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<ProductWithCategory | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProductInfo, setDeleteProductInfo] = useState<{
    loading: boolean;
    movementCount: number;
    inKits: boolean;
  } | null>(null);
  const [confirmDeleteMovements, setConfirmDeleteMovements] = useState(false);

  // Kit states
  const [kits, setKits] = useState<KitWithProducts[]>([]);
  const [isKitSheetOpen, setIsKitSheetOpen] = useState(false);
  const [isKitExitSheetOpen, setIsKitExitSheetOpen] = useState(false);
  const [editingKit, setEditingKit] = useState<KitWithProducts | null>(null);
  const [deleteKitDialogOpen, setDeleteKitDialogOpen] = useState(false);
  const [kitToDelete, setKitToDelete] = useState<KitWithProducts | null>(null);
  const [isDeletingKit, setIsDeletingKit] = useState(false);
  const [activeTab, setActiveTab] = useState<"products" | "kits">("products");

  const loadData = useCallback(async () => {
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

    // Cargar productos
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    if (productsError) {
      console.error("Error al cargar productos:", productsError);
      toast.error("Error al cargar productos: " + productsError.message);
      setIsLoading(false);
      return;
    }

    // Cargar categorías
    const { data: categoriesData, error: categoriesError } = await supabase
      .from("categories")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    if (categoriesError) {
      console.error("Error al cargar categorías:", categoriesError);
    }

    const categoriesList = categoriesData || [];
    const pids = (productsData || []).map((p: Product) => p.id);
    const nearestEntryExpirationByProduct: Record<string, string> = {};
    const breakdownByProduct: Record<string, { name: string; quantity: number }[]> =
      {};

    if (pids.length > 0) {
      const { data: entradaExpRows } = await supabase
        .from("movements")
        .select("product_id, expiration_date")
        .eq("organization_id", profile.organization_id)
        .eq("country_code", countryCode)
        .eq("type", "Entrada")
        .not("expiration_date", "is", null)
        .in("product_id", pids);

      for (const row of entradaExpRows || []) {
        if (!row.expiration_date) continue;
        const d =
          row.expiration_date.length >= 10
            ? row.expiration_date.slice(0, 10)
            : row.expiration_date;
        const prev = nearestEntryExpirationByProduct[row.product_id];
        if (!prev || d < prev) {
          nearestEntryExpirationByProduct[row.product_id] = d;
        }
      }

      const { data: wsRows } = await supabase
        .from("warehouse_stock")
        .select("product_id, warehouse_id, current_stock")
        .in("product_id", pids)
        .gt("current_stock", 0);

      const whIds = [...new Set((wsRows || []).map((r) => r.warehouse_id))];
      const { data: whRows } =
        whIds.length > 0
          ? await supabase.from("warehouses").select("id, name").in("id", whIds)
          : { data: [] as { id: string; name: string }[] };

      const whName = Object.fromEntries(
        (whRows || []).map((w) => [w.id, w.name])
      );

      for (const r of wsRows || []) {
        const name = whName[r.warehouse_id] || "Almacén";
        if (!breakdownByProduct[r.product_id]) {
          breakdownByProduct[r.product_id] = [];
        }
        breakdownByProduct[r.product_id].push({
          name,
          quantity: r.current_stock,
        });
      }
    }

    // Mapear productos con información de categoría
    const productsWithCategory = (productsData || []).map((p: Product) => {
      const category = categoriesList.find((c) => c.id === p.category_id);
      return {
        ...p,
        category,
        warehouseBreakdown: breakdownByProduct[p.id] || [],
        nearestEntryExpiration: nearestEntryExpirationByProduct[p.id] ?? null,
      };
    });

    // Cargar kits
    const { data: kitsData } = await supabase
      .from("kits")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .order("name", { ascending: true });

    if (kitsData && kitsData.length > 0) {
      const kitIds = kitsData.map((k: Kit) => k.id);
      const { data: kitProductsData } = await supabase
        .from("kit_products")
        .select("*")
        .in("kit_id", kitIds);

      const kitsWithProducts: KitWithProducts[] = kitsData.map((k: Kit) => {
        const kitProds = (kitProductsData || [])
          .filter((kp: KitProduct) => kp.kit_id === k.id)
          .map((kp: KitProduct) => ({
            ...kp,
            product: productsData?.find((p: Product) => p.id === kp.product_id),
          }));
        return { ...k, kit_products: kitProds };
      });

      setKits(kitsWithProducts);
    } else {
      setKits([]);
    }

    setProducts(productsWithCategory);
    setCategories(categoriesList);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!deleteDialogOpen || !productToDelete) {
      setDeleteProductInfo(null);
      setConfirmDeleteMovements(false);
      return;
    }

    setConfirmDeleteMovements(false);
    let cancelled = false;

    (async () => {
      setDeleteProductInfo({ loading: true, movementCount: 0, inKits: false });
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

      const cc = profile.country_code || "MX";

      const [movRes, kpRes] = await Promise.all([
        supabase
          .from("movements")
          .select("*", { count: "exact", head: true })
          .eq("product_id", productToDelete.id)
          .eq("organization_id", profile.organization_id)
          .eq("country_code", cc),
        supabase.from("kit_products").select("id").eq("product_id", productToDelete.id),
      ]);

      if (cancelled) return;

      setDeleteProductInfo({
        loading: false,
        movementCount: movRes.count ?? 0,
        inKits: (kpRes.data?.length ?? 0) > 0,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [deleteDialogOpen, productToDelete?.id]);

  // Filtrar productos
  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === null || product.category_id === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const getStockStatus = (product: Product) => {
    const stock = product.current_stock || product.stock || 0;
    const minStock = product.min_stock || 0;

    if (stock <= 0) {
      return { status: "empty", label: "Sin Stock", variant: "destructive" as const };
    } else if (stock <= minStock) {
      return { status: "low", label: "Stock Bajo", variant: "destructive" as const };
    } else {
      return { status: "ok", label: "En Stock", variant: "default" as const };
    }
  };

  const getCategoryName = (categoryId: number) => {
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || "Sin categoría";
  };

  const getExpirationStatus = (expirationDate: string | null) => {
    if (!expirationDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(expirationDate + "T00:00:00");
    const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { status: "expired", label: "Vencido", color: "text-red-600" };
    } else if (diffDays <= 30) {
      return { status: "soon", label: `Vence en ${diffDays}d`, color: "text-orange-600" };
    } else if (diffDays <= 90) {
      return { status: "warning", label: `Vence en ${diffDays}d`, color: "text-amber-600" };
    }
    return { status: "ok", label: expDate.toLocaleDateString("es-ES"), color: "text-slate-400" };
  };

  async function handleDeleteProduct() {
    if (!productToDelete) return;

    const movementCount = deleteProductInfo?.movementCount ?? 0;
    const needsMovementConfirm = movementCount > 0;
    if (needsMovementConfirm && !confirmDeleteMovements) {
      toast.error(
        "Confirma que deseas eliminar también el historial de movimientos de este producto."
      );
      return;
    }

    setIsDeleting(true);
    const result = await deleteProduct(productToDelete.id, {
      deleteMovementHistory: needsMovementConfirm ? confirmDeleteMovements : false,
    });

    if (result?.error) {
      toast.error(result.error);
      setIsDeleting(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || "Producto eliminado correctamente");
      setDeleteDialogOpen(false);
      setProductToDelete(null);
      setConfirmDeleteMovements(false);
      setDeleteProductInfo(null);
      loadData();
    }
    setIsDeleting(false);
  }

  async function handleDeleteKit() {
    if (!kitToDelete) return;

    setIsDeletingKit(true);
    const result = await deleteKit(kitToDelete.id);

    if (result?.error) {
      toast.error(result.error);
      setIsDeletingKit(false);
      return;
    }

    if (result?.success) {
      toast.success(result.message || "Kit eliminado correctamente");
      setDeleteKitDialogOpen(false);
      setKitToDelete(null);
      loadData();
    }
    setIsDeletingKit(false);
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Inventario</h1>
            <p className="text-slate-600 mt-1">
              Gestiona tus productos y stock
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button
              onClick={() => setIsProductSheetOpen(true)}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Producto
            </Button>
            <Button
              onClick={() => setIsKitSheetOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Boxes className="mr-2 h-4 w-4" />
              Kit
            </Button>
            <Button
              onClick={() => setIsMovementSheetOpen(true)}
              variant="outline"
            >
              <Plus className="mr-2 h-4 w-4" />
              Movimiento
            </Button>
            {kits.length > 0 && (
              <Button
                onClick={() => setIsKitExitSheetOpen(true)}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <ArrowUpCircle className="mr-2 h-4 w-4" />
                Salida Kit
              </Button>
            )}
          </div>
        </div>

        {/* Buscador */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 text-base"
          />
        </div>

        {/* Toggle Productos / Kits */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
          <Button
            type="button"
            variant={activeTab === "products" ? "default" : "ghost"}
            className={`flex-1 ${
              activeTab === "products" ? "bg-teal-600 hover:bg-teal-700 text-white" : ""
            }`}
            onClick={() => setActiveTab("products")}
          >
            <Package className="mr-2 h-4 w-4" />
            Productos ({products.length})
          </Button>
          <Button
            type="button"
            variant={activeTab === "kits" ? "default" : "ghost"}
            className={`flex-1 ${
              activeTab === "kits" ? "bg-indigo-600 hover:bg-indigo-700 text-white" : ""
            }`}
            onClick={() => setActiveTab("kits")}
          >
            <Boxes className="mr-2 h-4 w-4" />
            Kits ({kits.length})
          </Button>
        </div>

        {activeTab === "products" && (
          <Tabs
            value={selectedCategory?.toString() || "all"}
            onValueChange={(value) =>
              setSelectedCategory(value === "all" ? null : parseInt(value))
            }
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">Todos</TabsTrigger>
              {categories.slice(0, 3).map((category) => (
                <TabsTrigger key={category.id} value={category.id.toString()}>
                  {category.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </motion.div>

      {/* Lista de Productos */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">
          Cargando...
        </div>
      ) : activeTab === "kits" ? (
        /* ===== SECCIÓN DE KITS ===== */
        kits.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <Boxes className="h-16 w-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-700 mb-2">
              No hay kits
            </h3>
            <p className="text-slate-500 mb-6">
              Crea un kit para agrupar productos y dar salidas en conjunto
            </p>
            <Button
              onClick={() => setIsKitSheetOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Crear Kit
            </Button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {kits.map((kit, index) => (
              <motion.div
                key={kit.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <Card className="border-slate-200 hover:border-indigo-300 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <div className="p-1.5 rounded-md bg-indigo-100">
                            <Boxes className="h-4 w-4 text-indigo-600" />
                          </div>
                          <h3 className="font-semibold text-slate-900">
                            {kit.name}
                          </h3>
                          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            {kit.kit_products.length} producto(s)
                          </span>
                        </div>
                        {kit.description && (
                          <p className="text-sm text-slate-500 mt-1 ml-10">
                            {kit.description}
                          </p>
                        )}
                        <div className="mt-2 ml-10 flex flex-wrap gap-2">
                          {kit.kit_products.map((kp) => (
                            <span
                              key={kp.id}
                              className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md"
                            >
                              <Package className="h-3 w-3" />
                              {kp.product?.name || "Producto"}
                              <span className="text-slate-400">x{kp.quantity}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setEditingKit(kit);
                            setIsKitSheetOpen(true);
                          }}
                          title="Editar kit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setKitToDelete(kit);
                            setDeleteKitDialogOpen(true);
                          }}
                          title="Eliminar kit"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )
      ) : filteredProducts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12"
        >
          <Package className="h-16 w-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-700 mb-2">
            {searchQuery || selectedCategory
              ? "No se encontraron productos"
              : "No hay productos"}
          </h3>
          <p className="text-slate-500 mb-6">
            {searchQuery || selectedCategory
              ? "Intenta con otros filtros de búsqueda"
              : "Comienza agregando tu primer producto"}
          </p>
          {!searchQuery && !selectedCategory && (
            <Button
              onClick={() => setIsProductSheetOpen(true)}
              className="bg-teal-600 hover:bg-teal-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Agregar Producto
            </Button>
          )}
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filteredProducts.map((product, index) => {
            const stockStatus = getStockStatus(product);
            const expStatus = getExpirationStatus(product.nearestEntryExpiration ?? null);
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <Card className="border-slate-200 hover:border-teal-300 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="font-medium text-slate-900 truncate">
                            {product.name}
                          </h3>
                          <span className="text-xs text-slate-400">
                            {product.sku}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span
                            className={`text-sm font-medium ${
                              stockStatus.status === "empty"
                                ? "text-red-600"
                                : stockStatus.status === "low"
                                ? "text-orange-600"
                                : "text-slate-600"
                            }`}
                          >
                            {product.current_stock || product.stock || 0}
                          </span>
                          {product.min_stock > 0 && (
                            <span className="text-xs text-slate-400">
                              mín. {product.min_stock}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">
                            {getCategoryName(product.category_id)}
                          </span>
                          {expStatus && (
                            <span className={`text-xs flex items-center gap-1 ${expStatus.color}`}>
                              <Calendar className="h-3 w-3" />
                              {expStatus.label}
                            </span>
                          )}
                        </div>
                        {product.warehouseBreakdown &&
                          product.warehouseBreakdown.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {product.warehouseBreakdown.map((row, i) => (
                                <Badge
                                  key={`${row.name}-${i}`}
                                  variant="secondary"
                                  className="text-xs font-normal bg-slate-100 text-slate-700"
                                >
                                  {row.name}: {row.quantity} u.
                                </Badge>
                              ))}
                            </div>
                          )}
                      </div>
                      <div className="flex items-center gap-2">
                        {stockStatus.status === "low" || stockStatus.status === "empty" ? (
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              stockStatus.status === "empty"
                                ? "bg-red-500"
                                : "bg-orange-500 animate-pulse"
                            }`}
                          />
                        ) : null}
                        <div className="flex items-center gap-1 ml-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/dashboard/history?product_id=${product.id}`);
                            }}
                            title="Ver historial"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProduct(product);
                              setIsProductSheetOpen(true);
                            }}
                            title="Editar producto"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProductToDelete(product);
                              setDeleteDialogOpen(true);
                            }}
                            title="Eliminar producto"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Sheet de Registro de Movimientos */}
      <MovementSheet
        open={isMovementSheetOpen}
        onOpenChange={setIsMovementSheetOpen}
        products={products}
        onSuccess={() => {
          loadData();
          setIsMovementSheetOpen(false);
        }}
      />

      {/* Sheet de Crear/Editar Producto */}
      <ProductSheet
        open={isProductSheetOpen}
        onOpenChange={(open) => {
          setIsProductSheetOpen(open);
          if (!open) {
            setEditingProduct(null);
          }
        }}
        product={editingProduct}
        onSuccess={() => {
          loadData();
          setEditingProduct(null);
        }}
      />

      {/* Sheet de Crear/Editar Kit */}
      <KitSheet
        open={isKitSheetOpen}
        onOpenChange={(open) => {
          setIsKitSheetOpen(open);
          if (!open) setEditingKit(null);
        }}
        kit={editingKit}
        products={products}
        onSuccess={() => {
          loadData();
          setEditingKit(null);
        }}
      />

      {/* Sheet de Salida de Kit */}
      <KitExitSheet
        open={isKitExitSheetOpen}
        onOpenChange={setIsKitExitSheetOpen}
        kits={kits}
        onSuccess={() => {
          loadData();
          setIsKitExitSheetOpen(false);
        }}
      />

      {/* Dialog de Confirmación para Eliminar Producto */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setProductToDelete(null);
            setConfirmDeleteMovements(false);
            setDeleteProductInfo(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar producto?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-slate-600">
                <p>
                  Esta acción no se puede deshacer. Se eliminará permanentemente el producto{" "}
                  <strong className="text-slate-900">{productToDelete?.name}</strong>.
                </p>

                {deleteProductInfo?.loading && (
                  <p className="text-slate-500">Comprobando historial y kits…</p>
                )}

                {!deleteProductInfo?.loading && deleteProductInfo?.inKits && (
                  <div
                    className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
                    role="alert"
                  >
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <p>
                      Este producto forma parte de uno o más <strong>kits</strong>. Quita el
                      producto de esos kits (editando cada kit) y luego podrás eliminarlo.
                    </p>
                  </div>
                )}

                {!deleteProductInfo?.loading &&
                  !deleteProductInfo?.inKits &&
                  (deleteProductInfo?.movementCount ?? 0) > 0 && (
                    <div
                      className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950"
                      role="alert"
                    >
                      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
                      <div className="space-y-2">
                        <p>
                          Hay{" "}
                          <strong>
                            {deleteProductInfo?.movementCount ?? 0}{" "}
                            {(deleteProductInfo?.movementCount ?? 0) === 1
                              ? "movimiento"
                              : "movimientos"}
                          </strong>{" "}
                          registrados para este producto. La base de datos no permite borrar el
                          producto sin quitar antes ese historial.
                        </p>
                        <label className="flex cursor-pointer items-start gap-2 text-sm font-normal">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-300"
                            checked={confirmDeleteMovements}
                            onChange={(e) => setConfirmDeleteMovements(e.target.checked)}
                            disabled={isDeleting}
                          />
                          <span>
                            También eliminar todo el historial de movimientos de este producto
                            (entradas y salidas). Es irreversible.
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                {!deleteProductInfo?.loading &&
                  !deleteProductInfo?.inKits &&
                  (deleteProductInfo?.movementCount ?? 0) === 0 && (
                    <p className="text-slate-500">
                      No hay movimientos registrados para este producto; puedes eliminarlo de
                      inmediato.
                    </p>
                  )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setProductToDelete(null);
                setConfirmDeleteMovements(false);
                setDeleteProductInfo(null);
              }}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteProduct}
              disabled={
                isDeleting ||
                deleteProductInfo?.loading ||
                deleteProductInfo?.inKits === true ||
                ((deleteProductInfo?.movementCount ?? 0) > 0 && !confirmDeleteMovements)
              }
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Confirmación para Eliminar Kit */}
      <Dialog open={deleteKitDialogOpen} onOpenChange={setDeleteKitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar kit?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. Se eliminará el kit{" "}
              <strong>{kitToDelete?.name}</strong> y sus asociaciones de productos.
              Los productos en sí no se eliminarán.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteKitDialogOpen(false);
                setKitToDelete(null);
              }}
              disabled={isDeletingKit}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteKit}
              disabled={isDeletingKit}
            >
              {isDeletingKit ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

