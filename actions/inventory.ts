"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  computeLotBalancesForProduct,
  lotStockBucketKey,
  validateSequentialLotConsumption,
  type LotMovementInput,
} from "@/lib/kit-lot-balance";

// Schemas de validación Zod
const supplierSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  contact_email: z.string().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().optional(),
  tax_id: z.string().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Color inválido").optional().or(z.literal("")),
});

// El vencimiento del producto no se guarda en `products`: solo en movimientos de Entrada.
const productSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  sku: z.string().min(1, "El SKU es requerido"),
  description: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v == null ? "" : v)),
  min_stock: z.number().int().min(0, "El stock mínimo debe ser 0 o mayor"),
  category_id: z.number().int().positive("La categoría es requerida"),
});

const kitSchema = z.object({
  name: z.string().min(1, "El nombre del kit es requerido"),
  description: z.string().optional(),
  products: z.array(z.object({
    product_id: z.string().uuid("ID de producto inválido"),
    quantity: z.number().int().positive("La cantidad debe ser mayor a 0"),
  })).min(1, "El kit debe contener al menos un producto"),
});

const warehouseSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional().nullable(),
});

const movementSchema = z.object({
  product_id: z.string().uuid("ID de producto inválido"),
  type: z.enum(["Entrada", "Salida"], {
    message: "El tipo debe ser 'Entrada' o 'Salida'",
  }),
  warehouse_id: z
    .union([z.string().uuid("ID de almacén inválido"), z.literal("")])
    .optional()
    .transform((v) => (!v || v === "" ? null : v)),
  quantity: z.coerce
    .number({
      message: "La cantidad debe ser un número",
    })
    .int("La cantidad debe ser un número entero")
    .positive("La cantidad debe ser mayor a 0")
    .min(1, "La cantidad debe ser al menos 1"),
  movement_date: z.string().min(1, "La fecha del movimiento es requerida"),
  lot_number: z.string().optional().nullable(),
  expiration_date: z.string().optional().nullable(),
  supplier_id: z.string().uuid("ID de proveedor inválido").optional().nullable(),
  recipient: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  // Validación Condicional Lógica
  if (data.type === "Entrada") {
    // Para Entradas, el proveedor es recomendado pero no obligatorio
    // (puede ser una entrada manual sin proveedor)
    if (data.supplier_id && !z.string().uuid().safeParse(data.supplier_id).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ID de proveedor inválido",
        path: ["supplier_id"],
      });
    }
  }
  
  if (data.type === "Salida") {
    // Para Salidas, el destinatario es recomendado pero no obligatorio
    // (puede ser una salida interna o ajuste de inventario)
    if (data.recipient && data.recipient.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El destinatario no puede estar vacío si se proporciona",
        path: ["recipient"],
      });
    }
  }

  // Validar formato de fecha si se proporciona
  if (data.expiration_date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(data.expiration_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Formato de fecha inválido. Use YYYY-MM-DD",
        path: ["expiration_date"],
      });
    }
  }
});

export async function createSupplier(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error: "No autenticado",
      };
    }

    // Obtener organization_id y country_code del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return {
        error: "Error al obtener información del usuario",
      };
    }

    // Validar datos
    const rawData = {
      name: formData.get("name") as string,
      contact_email: formData.get("contact_email") as string,
      phone: formData.get("phone") as string,
      tax_id: formData.get("tax_id") as string,
    };

    const validatedData = supplierSchema.parse(rawData);

    // Insertar proveedor
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        ...validatedData,
        organization_id: profile.organization_id,
        country_code: profile.country_code || "MX",
        contact_email: validatedData.contact_email || null,
        phone: validatedData.phone || null,
        tax_id: validatedData.tax_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error al crear proveedor:", error);
      return {
        error: error.message,
      };
    }

    revalidatePath("/dashboard/suppliers");
    return {
      success: true,
      data,
      message: "Proveedor creado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues && error.issues.length > 0 
        ? error.issues[0].message 
        : "Error de validación";
      return {
        error: firstError,
      };
    }
    console.error("Error inesperado en createSupplier:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al crear proveedor",
    };
  }
}

export async function createWarehouse(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const rawData = {
      name: formData.get("name") as string,
      description: (formData.get("description") as string) || null,
    };

    const validatedData = warehouseSchema.parse(rawData);

    const { data, error } = await supabase
      .from("warehouses")
      .insert({
        name: validatedData.name,
        description: validatedData.description?.trim() || null,
        organization_id: profile.organization_id,
        country_code: profile.country_code || "MX",
      })
      .select()
      .single();

    if (error) {
      console.error("Error al crear almacén:", error);
      return { error: error.message };
    }

    revalidatePath("/dashboard/warehouses");
    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      data,
      message: "Almacén creado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message || "Error de validación" };
    }
    console.error("Error inesperado en createWarehouse:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al crear almacén",
    };
  }
}

export async function updateWarehouse(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const warehouseId = formData.get("warehouse_id") as string;
    if (!warehouseId || !z.string().uuid().safeParse(warehouseId).success) {
      return { error: "ID de almacén inválido" };
    }

    const rawData = {
      name: formData.get("name") as string,
      description: (formData.get("description") as string) || null,
    };

    const validatedData = warehouseSchema.parse(rawData);

    const { data, error } = await supabase
      .from("warehouses")
      .update({
        name: validatedData.name,
        description: validatedData.description?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", warehouseId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX")
      .select()
      .single();

    if (error) {
      console.error("Error al actualizar almacén:", error);
      return { error: error.message };
    }

    if (!data) {
      return { error: "Almacén no encontrado" };
    }

    revalidatePath("/dashboard/warehouses");
    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      data,
      message: "Almacén actualizado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message || "Error de validación" };
    }
    console.error("Error inesperado en updateWarehouse:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al actualizar almacén",
    };
  }
}

export async function deleteWarehouse(warehouseId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    if (!z.string().uuid().safeParse(warehouseId).success) {
      return { error: "ID de almacén inválido" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const { error } = await supabase
      .from("warehouses")
      .delete()
      .eq("id", warehouseId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX");

    if (error) {
      console.error("Error al eliminar almacén:", error);
      return { error: error.message };
    }

    revalidatePath("/dashboard/warehouses");
    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reports");
    return {
      success: true,
      message: "Almacén eliminado correctamente",
    };
  } catch (error) {
    console.error("Error inesperado en deleteWarehouse:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al eliminar almacén",
    };
  }
}

export async function createProduct(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error: "No autenticado",
      };
    }

    // Obtener organization_id y country_code del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return {
        error: "Error al obtener información del usuario",
      };
    }

    // Validar datos
    const rawData = {
      name: formData.get("name") as string,
      sku: formData.get("sku") as string,
      description: formData.get("description") as string,
      min_stock: Number(formData.get("min_stock")),
      category_id: Number(formData.get("category_id")),
    };

    const validatedData = productSchema.parse(rawData);

    // Verificar que la categoría pertenezca al mismo país del usuario
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id, country_code")
      .eq("id", validatedData.category_id)
      .eq("organization_id", profile.organization_id)
      .single();

    if (categoryError || !category) {
      return {
        error: "Categoría no encontrada",
      };
    }

    if (category.country_code !== (profile.country_code || "MX")) {
      return {
        error: "No puedes usar una categoría de otro país",
      };
    }

    // Verificar que el SKU no exista en la organización y país
    const { data: existingProduct } = await supabase
      .from("products")
      .select("id")
      .eq("sku", validatedData.sku)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX")
      .single();

    if (existingProduct) {
      return {
        error: "Ya existe un producto con este SKU en tu organización y país",
      };
    }

    // Insertar producto
    const { data, error } = await supabase
      .from("products")
      .insert({
        name: validatedData.name,
        sku: validatedData.sku,
        min_stock: validatedData.min_stock,
        category_id: validatedData.category_id,
        organization_id: profile.organization_id,
        country_code: profile.country_code || "MX",
        current_stock: 0,
        stock: 0,
        description: validatedData.description || null,
        expiration_date: null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error al crear producto:", error);
      return {
        error: error.message,
      };
    }

    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      data,
      message: "Producto creado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues && error.issues.length > 0 
        ? error.issues[0].message 
        : "Error de validación";
      return {
        error: firstError,
      };
    }
    console.error("Error inesperado en createProduct:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al crear producto",
    };
  }
}

export async function registerMovement(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error: "No autenticado",
      };
    }

    // Obtener organization_id y country_code del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return {
        error: "Error al obtener información del usuario",
      };
    }

    // Extraer datos del FormData
    const rawData = {
      product_id: formData.get("product_id") as string,
      type: formData.get("type") as string,
      quantity: formData.get("quantity") as string,
      movement_date: formData.get("movement_date") as string,
      lot_number: formData.get("lot_number") as string | null,
      expiration_date: formData.get("expiration_date") as string | null,
      supplier_id: formData.get("supplier_id") as string | null,
      recipient: formData.get("recipient") as string | null,
      notes: formData.get("notes") as string | null,
      warehouse_id: (formData.get("warehouse_id") as string) || "",
    };

    // Debugging: Log de datos recibidos (solo en desarrollo)
    if (process.env.NODE_ENV === "development") {
      console.log("[registerMovement] Datos recibidos:", {
        product_id: rawData.product_id,
        type: rawData.type,
        quantity: rawData.quantity,
        has_lot_number: !!rawData.lot_number,
        has_expiration_date: !!rawData.expiration_date,
        has_supplier_id: !!rawData.supplier_id,
        has_recipient: !!rawData.recipient,
      });
    }

    // Validar datos con Zod (coerce manejará la conversión automáticamente)
    const validatedData = movementSchema.parse({
      product_id: rawData.product_id || "",
      type: rawData.type || "",
      quantity: rawData.quantity || "0",
      movement_date: rawData.movement_date || new Date().toISOString().split("T")[0],
      lot_number: rawData.lot_number || null,
      expiration_date: rawData.expiration_date || null,
      supplier_id: rawData.supplier_id || null,
      recipient: rawData.recipient || null,
      notes: rawData.notes || null,
      warehouse_id: rawData.warehouse_id || "",
    });

    // Verificar que el producto pertenezca al mismo país del usuario
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("current_stock, name, country_code")
      .eq("id", validatedData.product_id)
      .single();

    if (productError || !product) {
      return {
        error: "Producto no encontrado",
      };
    }

    if (product.country_code !== (profile.country_code || "MX")) {
      return {
        error: "No puedes realizar movimientos en productos de otro país",
      };
    }

    // Si es Salida, verificar stock suficiente
    if (validatedData.type === "Salida") {
      if (product.current_stock < validatedData.quantity) {
        return {
          error: `Stock insuficiente. Stock actual: ${product.current_stock}, solicitado: ${validatedData.quantity}`,
        };
      }
    }

    // Si hay supplier_id, verificar que pertenezca al mismo país
    if (validatedData.supplier_id) {
      const { data: supplier, error: supplierError } = await supabase
        .from("suppliers")
        .select("id, country_code")
        .eq("id", validatedData.supplier_id)
        .eq("organization_id", profile.organization_id)
        .single();

      if (supplierError || !supplier) {
        return {
          error: "Proveedor no encontrado",
        };
      }

      if (supplier.country_code !== (profile.country_code || "MX")) {
        return {
          error: "No puedes usar un proveedor de otro país",
        };
      }
    }

    if (validatedData.warehouse_id) {
      const { data: wh, error: whError } = await supabase
        .from("warehouses")
        .select("id, country_code")
        .eq("id", validatedData.warehouse_id)
        .eq("organization_id", profile.organization_id)
        .single();

      if (whError || !wh) {
        return { error: "Almacén no encontrado" };
      }

      if (wh.country_code !== (profile.country_code || "MX")) {
        return { error: "No puedes usar un almacén de otro país" };
      }

      if (validatedData.type === "Salida") {
        const { data: wsRow } = await supabase
          .from("warehouse_stock")
          .select("current_stock")
          .eq("warehouse_id", validatedData.warehouse_id)
          .eq("product_id", validatedData.product_id)
          .maybeSingle();

        if (!wsRow) {
          return {
            error:
              "No se puede registrar la salida: el producto no tiene stock en el almacén seleccionado.",
          };
        }

        const whStock = wsRow?.current_stock ?? 0;
        if (whStock < validatedData.quantity) {
          return {
            error: `Stock insuficiente en el almacén seleccionado. Disponible: ${whStock}, solicitado: ${validatedData.quantity}`,
          };
        }

        {
          const { data: lotMovRows, error: lotMovErr } = await supabase
            .from("movements")
            .select("type, quantity, expiration_date, lot_number, created_at")
            .eq("organization_id", profile.organization_id)
            .eq("country_code", profile.country_code || "MX")
            .eq("warehouse_id", validatedData.warehouse_id)
            .eq("product_id", validatedData.product_id)
            .order("created_at", { ascending: true });

          if (!lotMovErr && lotMovRows && lotMovRows.length > 0) {
            const inputs: LotMovementInput[] = lotMovRows.map((m) => ({
              type: m.type as "Entrada" | "Salida",
              quantity: m.quantity,
              expiration_date: m.expiration_date,
              lot_number: m.lot_number,
              created_at: m.created_at,
            }));
            const balances = computeLotBalancesForProduct(inputs);

            if (balances.some((b) => b.quantity > 0)) {
              const viable = balances.filter((b) => b.quantity >= validatedData.quantity);
              if (viable.length === 0) {
                return {
                  error:
                    "Ningún lote con esa trazabilidad tiene stock suficiente en este almacén para la cantidad indicada. Revisá el vencimiento/lote o la cantidad.",
                };
              }
              const reqKey = lotStockBucketKey(
                validatedData.expiration_date,
                validatedData.lot_number
              );
              const matched = viable.find(
                (b) => lotStockBucketKey(b.expirationDate, b.lotNumber) === reqKey
              );
              if (!matched) {
                return {
                  error:
                    "Seleccioná el vencimiento y lote de origen de esta salida (debe coincidir con una entrada en este almacén).",
                };
              }
            }
          }
        }
      }
    }

    // Insertar movimiento (el trigger actualizará el stock automáticamente)
    const { data, error } = await supabase
      .from("movements")
      .insert({
        product_id: validatedData.product_id,
        type: validatedData.type,
        quantity: validatedData.quantity,
        movement_date: validatedData.movement_date,
        lot_number: validatedData.lot_number || null,
        expiration_date: validatedData.expiration_date || null,
        supplier_id: validatedData.supplier_id || null,
        recipient: validatedData.recipient || null,
        notes: validatedData.notes || null,
        warehouse_id: validatedData.warehouse_id,
        organization_id: profile.organization_id,
        country_code: profile.country_code || "MX",
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("Error al registrar movimiento:", error);
      return {
        error: error.message,
      };
    }

    // Verificar si el producto quedó con bajo stock después del movimiento
    const { data: updatedProduct, error: productCheckError } = await supabase
      .from("products")
      .select("id, name, sku, current_stock, min_stock")
      .eq("id", validatedData.product_id)
      .single();

    if (!productCheckError && updatedProduct) {
      // Si el stock actual es menor o igual al mínimo, enviar webhook
      if (updatedProduct.current_stock <= updatedProduct.min_stock) {
        // Obtener todos los emails de usuarios del mismo país y organización
        const { data: countryUsers, error: usersError } = await supabase
          .from("profiles")
          .select("email")
          .eq("organization_id", profile.organization_id)
          .eq("country_code", profile.country_code || "MX");

        if (!usersError && countryUsers && countryUsers.length > 0) {
          const emails = countryUsers.map((u) => u.email).filter(Boolean);

          // Enviar webhook de bajo stock
          try {
            await fetch("https://n8n.srv908725.hstgr.cloud/webhook/bajo_stock", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                emails: emails,
                product: {
                  id: updatedProduct.id,
                  name: updatedProduct.name,
                  sku: updatedProduct.sku,
                  current_stock: updatedProduct.current_stock,
                  min_stock: updatedProduct.min_stock,
                },
                country_code: profile.country_code || "MX",
              }),
            });
          } catch (webhookError) {
            // No fallar el movimiento si el webhook falla, solo loguear el error
            console.error("Error al enviar webhook de bajo stock:", webhookError);
          }
        }
      }
    }

    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reports");
    revalidatePath("/dashboard/warehouses");
    return {
      success: true,
      data,
      message: "Movimiento registrado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Mejor debugging: mostrar todos los errores en desarrollo
      if (process.env.NODE_ENV === "development") {
        console.error("[registerMovement] Errores de validación:", {
          errors: error.issues,
          issues: error.issues,
        });
      }

      // Obtener el primer error o un mensaje genérico
      const firstError = error.issues && error.issues.length > 0
        ? error.issues[0].message
        : "Error de validación";
      
      // Si hay múltiples errores, combinarlos en desarrollo
      const errorMessage = process.env.NODE_ENV === "development" && error.issues.length > 1
        ? `${firstError} (y ${error.issues.length - 1} error(es) más)`
        : firstError;

      return {
        error: errorMessage,
      };
    }
    
    // Log detallado de errores inesperados
    console.error("[registerMovement] Error inesperado:", {
      error,
      message: error instanceof Error ? error.message : "Error desconocido",
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      error: error instanceof Error 
        ? `Error al registrar movimiento: ${error.message}` 
        : "Error inesperado al registrar movimiento",
    };
  }
}

type MovementType = "Entrada" | "Salida";

function signedMovementQuantity(type: MovementType, quantity: number) {
  return type === "Entrada" ? quantity : -quantity;
}

async function applyWarehouseStockDelta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  warehouseId: string | null,
  productId: string,
  delta: number
) {
  if (!warehouseId || delta === 0) {
    return { success: true as const };
  }

  const { data: wsRow, error: wsError } = await supabase
    .from("warehouse_stock")
    .select("id, current_stock")
    .eq("warehouse_id", warehouseId)
    .eq("product_id", productId)
    .maybeSingle();

  if (wsError) {
    return { error: wsError.message };
  }

  if (!wsRow) {
    if (delta < 0) {
      return {
        error:
          "No se puede descontar stock del almacén seleccionado porque ese producto no existe en esa ubicación.",
      };
    }

    const { error: insertError } = await supabase.from("warehouse_stock").insert({
      warehouse_id: warehouseId,
      product_id: productId,
      current_stock: delta,
    });

    if (insertError) {
      return { error: insertError.message };
    }

    return { success: true as const };
  }

  const nextStock = wsRow.current_stock + delta;
  if (nextStock < 0) {
    return {
      error:
        "No se puede aplicar el cambio porque dejaría stock negativo en el almacén seleccionado.",
    };
  }

  const { error: updateError } = await supabase
    .from("warehouse_stock")
    .update({
      current_stock: nextStock,
      updated_at: new Date().toISOString(),
    })
    .eq("id", wsRow.id);

  if (updateError) {
    return { error: updateError.message };
  }

  return { success: true as const };
}

export async function updateMovement(movementId: string, formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    if (!z.string().uuid().safeParse(movementId).success) {
      return { error: "ID de movimiento inválido" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const countryCode = profile.country_code || "MX";

    const { data: currentMovement, error: currentMovementError } = await supabase
      .from("movements")
      .select(
        "id, product_id, type, quantity, movement_date, lot_number, expiration_date, supplier_id, recipient, notes, warehouse_id"
      )
      .eq("id", movementId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .single();

    if (currentMovementError || !currentMovement) {
      return { error: "Movimiento no encontrado" };
    }

    const rawData = {
      product_id: formData.get("product_id") as string,
      type: formData.get("type") as string,
      quantity: formData.get("quantity") as string,
      movement_date: formData.get("movement_date") as string,
      lot_number: formData.get("lot_number") as string | null,
      expiration_date: formData.get("expiration_date") as string | null,
      supplier_id: formData.get("supplier_id") as string | null,
      recipient: formData.get("recipient") as string | null,
      notes: formData.get("notes") as string | null,
      warehouse_id: (formData.get("warehouse_id") as string) || "",
    };

    const validatedData = movementSchema.parse({
      product_id: rawData.product_id || "",
      type: rawData.type || "",
      quantity: rawData.quantity || "0",
      movement_date:
        rawData.movement_date || new Date().toISOString().split("T")[0],
      lot_number: rawData.lot_number || null,
      expiration_date: rawData.expiration_date || null,
      supplier_id: rawData.supplier_id || null,
      recipient: rawData.recipient || null,
      notes: rawData.notes || null,
      warehouse_id: rawData.warehouse_id || "",
    });

    const { data: newProduct, error: newProductError } = await supabase
      .from("products")
      .select("id, current_stock, country_code")
      .eq("id", validatedData.product_id)
      .eq("organization_id", profile.organization_id)
      .single();

    if (newProductError || !newProduct) {
      return { error: "Producto no encontrado" };
    }

    if (newProduct.country_code !== countryCode) {
      return { error: "No puedes usar un producto de otro país" };
    }

    const { data: oldProduct, error: oldProductError } = await supabase
      .from("products")
      .select("id, current_stock, country_code")
      .eq("id", currentMovement.product_id)
      .eq("organization_id", profile.organization_id)
      .single();

    if (oldProductError || !oldProduct) {
      return { error: "Producto original no encontrado" };
    }

    if (validatedData.supplier_id) {
      const { data: supplier, error: supplierError } = await supabase
        .from("suppliers")
        .select("id, country_code")
        .eq("id", validatedData.supplier_id)
        .eq("organization_id", profile.organization_id)
        .single();

      if (supplierError || !supplier) {
        return { error: "Proveedor no encontrado" };
      }

      if (supplier.country_code !== countryCode) {
        return { error: "No puedes usar un proveedor de otro país" };
      }
    }

    if (validatedData.warehouse_id) {
      const { data: wh, error: whError } = await supabase
        .from("warehouses")
        .select("id, country_code")
        .eq("id", validatedData.warehouse_id)
        .eq("organization_id", profile.organization_id)
        .single();

      if (whError || !wh) {
        return { error: "Almacén no encontrado" };
      }

      if (wh.country_code !== countryCode) {
        return { error: "No puedes usar un almacén de otro país" };
      }
    }

    const oldSigned = signedMovementQuantity(
      currentMovement.type as MovementType,
      currentMovement.quantity
    );
    const newSigned = signedMovementQuantity(
      validatedData.type as MovementType,
      validatedData.quantity
    );

    if (currentMovement.product_id === validatedData.product_id) {
      const nextStock = oldProduct.current_stock - oldSigned + newSigned;
      if (nextStock < 0) {
        return {
          error:
            "No se puede editar este movimiento porque dejaría stock global negativo.",
        };
      }
    } else {
      const nextOldStock = oldProduct.current_stock - oldSigned;
      if (nextOldStock < 0) {
        return {
          error:
            "No se puede editar este movimiento porque dejaría stock global negativo en el producto original.",
        };
      }

      const nextNewStock = newProduct.current_stock + newSigned;
      if (nextNewStock < 0) {
        return {
          error:
            "No se puede editar este movimiento porque no hay stock suficiente en el producto seleccionado.",
        };
      }
    }

    const oldWarehouseResult = await applyWarehouseStockDelta(
      supabase,
      currentMovement.warehouse_id,
      currentMovement.product_id,
      -oldSigned
    );
    if (oldWarehouseResult.error) {
      return { error: oldWarehouseResult.error };
    }

    const newWarehouseResult = await applyWarehouseStockDelta(
      supabase,
      validatedData.warehouse_id,
      validatedData.product_id,
      newSigned
    );
    if (newWarehouseResult.error) {
      return { error: newWarehouseResult.error };
    }

    if (currentMovement.product_id === validatedData.product_id) {
      const nextStock = oldProduct.current_stock - oldSigned + newSigned;
      const { error: productUpdateError } = await supabase
        .from("products")
        .update({
          current_stock: nextStock,
          stock: nextStock,
          updated_at: new Date().toISOString(),
        })
        .eq("id", oldProduct.id);

      if (productUpdateError) {
        return { error: productUpdateError.message };
      }
    } else {
      const oldNextStock = oldProduct.current_stock - oldSigned;
      const newNextStock = newProduct.current_stock + newSigned;

      const { error: oldProductUpdateError } = await supabase
        .from("products")
        .update({
          current_stock: oldNextStock,
          stock: oldNextStock,
          updated_at: new Date().toISOString(),
        })
        .eq("id", oldProduct.id);

      if (oldProductUpdateError) {
        return { error: oldProductUpdateError.message };
      }

      const { error: newProductUpdateError } = await supabase
        .from("products")
        .update({
          current_stock: newNextStock,
          stock: newNextStock,
          updated_at: new Date().toISOString(),
        })
        .eq("id", newProduct.id);

      if (newProductUpdateError) {
        return { error: newProductUpdateError.message };
      }
    }

    const { error: movementUpdateError } = await supabase
      .from("movements")
      .update({
        product_id: validatedData.product_id,
        type: validatedData.type,
        quantity: validatedData.quantity,
        movement_date: validatedData.movement_date,
        lot_number: validatedData.lot_number || null,
        expiration_date: validatedData.expiration_date || null,
        supplier_id: validatedData.supplier_id || null,
        recipient: validatedData.recipient || null,
        notes: validatedData.notes || null,
        warehouse_id: validatedData.warehouse_id || null,
      })
      .eq("id", currentMovement.id);

    if (movementUpdateError) {
      return { error: movementUpdateError.message };
    }

    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reports");
    revalidatePath("/dashboard/warehouses");

    return {
      success: true,
      message: "Movimiento actualizado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues?.[0]?.message || "Error de validación";
      return { error: firstError };
    }
    console.error("Error inesperado en updateMovement:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Error inesperado al actualizar movimiento",
    };
  }
}

export async function deleteMovement(movementId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    if (!z.string().uuid().safeParse(movementId).success) {
      return { error: "ID de movimiento inválido" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const countryCode = profile.country_code || "MX";

    const { data: movement, error: movementError } = await supabase
      .from("movements")
      .select("id, product_id, type, quantity, warehouse_id")
      .eq("id", movementId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .single();

    if (movementError || !movement) {
      return { error: "Movimiento no encontrado" };
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, current_stock")
      .eq("id", movement.product_id)
      .eq("organization_id", profile.organization_id)
      .single();

    if (productError || !product) {
      return { error: "Producto no encontrado" };
    }

    const signed = signedMovementQuantity(
      movement.type as MovementType,
      movement.quantity
    );
    const nextProductStock = product.current_stock - signed;

    if (nextProductStock < 0) {
      return {
        error:
          "No se puede eliminar este movimiento porque dejaría stock global negativo.",
      };
    }

    const warehouseResult = await applyWarehouseStockDelta(
      supabase,
      movement.warehouse_id,
      movement.product_id,
      -signed
    );
    if (warehouseResult.error) {
      return { error: warehouseResult.error };
    }

    const { error: productUpdateError } = await supabase
      .from("products")
      .update({
        current_stock: nextProductStock,
        stock: nextProductStock,
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);

    if (productUpdateError) {
      return { error: productUpdateError.message };
    }

    const { error: deleteError } = await supabase
      .from("movements")
      .delete()
      .eq("id", movement.id);

    if (deleteError) {
      return { error: deleteError.message };
    }

    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reports");
    revalidatePath("/dashboard/warehouses");

    return {
      success: true,
      message: "Movimiento eliminado correctamente",
    };
  } catch (error) {
    console.error("Error inesperado en deleteMovement:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Error inesperado al eliminar movimiento",
    };
  }
}

export async function updateProduct(productId: string, formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error: "No autenticado",
      };
    }

    // Obtener organization_id y country_code del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return {
        error: "Error al obtener información del usuario",
      };
    }

    // Validar datos
    const rawData = {
      name: formData.get("name") as string,
      sku: formData.get("sku") as string,
      description: formData.get("description") as string,
      min_stock: Number(formData.get("min_stock")),
      category_id: Number(formData.get("category_id")),
    };

    const validatedData = productSchema.parse(rawData);

    // Verificar que el producto pertenezca a la organización y país
    const { data: existingProduct } = await supabase
      .from("products")
      .select("id, sku")
      .eq("id", productId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX")
      .single();

    if (!existingProduct) {
      return {
        error: "Producto no encontrado",
      };
    }

    // Verificar que la categoría pertenezca al mismo país del usuario
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id, country_code")
      .eq("id", validatedData.category_id)
      .eq("organization_id", profile.organization_id)
      .single();

    if (categoryError || !category) {
      return {
        error: "Categoría no encontrada",
      };
    }

    if (category.country_code !== (profile.country_code || "MX")) {
      return {
        error: "No puedes usar una categoría de otro país",
      };
    }

    // Si el SKU cambió, verificar que no exista otro producto con ese SKU en el mismo país
    if (existingProduct.sku !== validatedData.sku) {
      const { data: duplicateProduct } = await supabase
        .from("products")
        .select("id")
        .eq("sku", validatedData.sku)
        .eq("organization_id", profile.organization_id)
        .eq("country_code", profile.country_code || "MX")
        .neq("id", productId)
        .single();

      if (duplicateProduct) {
        return {
          error: "Ya existe otro producto con este SKU en tu organización",
        };
      }
    }

    // Actualizar producto
    const { data, error } = await supabase
      .from("products")
      .update({
        name: validatedData.name,
        sku: validatedData.sku,
        description: validatedData.description || null,
        min_stock: validatedData.min_stock,
        category_id: validatedData.category_id,
        expiration_date: null,
      })
      .eq("id", productId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX")
      .select()
      .single();

    if (error) {
      console.error("Error al actualizar producto:", error);
      return {
        error: error.message,
      };
    }

    // Verificar si el producto quedó con bajo stock después de la actualización
    if (data && data.current_stock <= data.min_stock) {
      // Obtener todos los emails de usuarios del mismo país y organización
      const { data: countryUsers, error: usersError } = await supabase
        .from("profiles")
        .select("email")
        .eq("organization_id", profile.organization_id)
        .eq("country_code", profile.country_code || "MX");

      if (!usersError && countryUsers && countryUsers.length > 0) {
        const emails = countryUsers.map((u) => u.email).filter(Boolean);

        // Enviar webhook de bajo stock
        try {
          await fetch("https://n8n.srv908725.hstgr.cloud/webhook/bajo_stock", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              emails: emails,
              product: {
                id: data.id,
                name: data.name,
                sku: data.sku,
                current_stock: data.current_stock,
                min_stock: data.min_stock,
              },
              country_code: profile.country_code || "MX",
            }),
          });
        } catch (webhookError) {
          // No fallar la actualización si el webhook falla, solo loguear el error
          console.error("Error al enviar webhook de bajo stock:", webhookError);
        }
      }
    }

    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      data,
      message: "Producto actualizado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues && error.issues.length > 0 
        ? error.issues[0].message 
        : "Error de validación";
      return {
        error: firstError,
      };
    }
    console.error("Error inesperado en updateProduct:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al actualizar producto",
    };
  }
}

export async function deleteProduct(
  productId: string,
  options?: { deleteMovementHistory?: boolean }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error: "No autenticado",
      };
    }

    // Obtener organization_id y country_code del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return {
        error: "Error al obtener información del usuario",
      };
    }

    const countryCode = profile.country_code || "MX";
    const deleteMovementHistory = options?.deleteMovementHistory === true;

    // Verificar que el producto pertenezca a la organización y país
    const { data: existingProduct } = await supabase
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .single();

    if (!existingProduct) {
      return {
        error: "Producto no encontrado",
      };
    }

    const { data: kitLinks, error: kitLinksError } = await supabase
      .from("kit_products")
      .select("id")
      .eq("product_id", productId);

    if (kitLinksError) {
      console.error("Error al verificar kits del producto:", kitLinksError);
      return { error: kitLinksError.message };
    }

    if (kitLinks && kitLinks.length > 0) {
      return {
        error:
          "Este producto está incluido en uno o más kits. Edita esos kits y quita el producto antes de eliminarlo.",
      };
    }

    const { count: movementCount, error: movementCountError } = await supabase
      .from("movements")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode);

    if (movementCountError) {
      console.error("Error al contar movimientos:", movementCountError);
      return { error: movementCountError.message };
    }

    const nMovements = movementCount ?? 0;
    if (nMovements > 0 && !deleteMovementHistory) {
      return {
        error:
          nMovements === 1
            ? "Este producto tiene 1 movimiento en el historial. Para eliminarlo, confirma también el borrado de ese historial en el cuadro de diálogo."
            : `Este producto tiene ${nMovements} movimientos en el historial. Para eliminarlo, confirma también el borrado de ese historial en el cuadro de diálogo.`,
      };
    }

    if (nMovements > 0 && deleteMovementHistory) {
      const { error: delMovError } = await supabase
        .from("movements")
        .delete()
        .eq("product_id", productId)
        .eq("organization_id", profile.organization_id)
        .eq("country_code", countryCode);

      if (delMovError) {
        console.error("Error al eliminar movimientos del producto:", delMovError);
        return { error: delMovError.message };
      }
    }

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode);

    if (error) {
      console.error("Error al eliminar producto:", error);
      const msg = error.message || "";
      if (msg.includes("fk_movements_product") || msg.includes("movements")) {
        return {
          error:
            "No se puede eliminar el producto porque aún hay movimientos asociados. Vuelve a intentar marcando la opción de eliminar el historial.",
        };
      }
      return {
        error: error.message,
      };
    }

    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reports");
    return {
      success: true,
      message: "Producto eliminado correctamente",
    };
  } catch (error) {
    console.error("Error inesperado en deleteProduct:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al eliminar producto",
    };
  }
}

export async function createCategory(formData: FormData) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        error: "No autenticado",
      };
    }

    // Obtener organization_id y country_code del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return {
        error: "Error al obtener información del usuario",
      };
    }

    // Validar datos
    const rawData = {
      name: formData.get("name") as string,
      color: formData.get("color") as string,
    };

    const validatedData = categorySchema.parse(rawData);

    // Verificar que el nombre no exista en la organización y país
    const { data: existingCategory } = await supabase
      .from("categories")
      .select("id")
      .eq("name", validatedData.name)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX")
      .single();

    if (existingCategory) {
      return {
        error: "Ya existe una categoría con este nombre en tu organización y país",
      };
    }

    // Insertar categoría
    const { data, error } = await supabase
      .from("categories")
      .insert({
        name: validatedData.name,
        organization_id: profile.organization_id,
        country_code: profile.country_code || "MX",
        color: validatedData.color || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error al crear categoría:", error);
      return {
        error: error.message,
      };
    }

    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      data,
      message: "Categoría creada correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues && error.issues.length > 0 
        ? error.issues[0].message 
        : "Error de validación";
      return {
        error: firstError,
      };
    }
    console.error("Error inesperado en createCategory:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al crear categoría",
    };
  }
}

// ==================== KIT ACTIONS ====================

export async function createKit(data: {
  name: string;
  description?: string;
  products: { product_id: string; quantity: number }[];
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const validatedData = kitSchema.parse(data);

    const { data: kit, error: kitError } = await supabase
      .from("kits")
      .insert({
        name: validatedData.name,
        description: validatedData.description || null,
        organization_id: profile.organization_id,
        country_code: profile.country_code || "MX",
      })
      .select()
      .single();

    if (kitError || !kit) {
      console.error("Error al crear kit:", kitError);
      return { error: kitError?.message || "Error al crear kit" };
    }

    const kitProductsData = validatedData.products.map((p) => ({
      kit_id: kit.id,
      product_id: p.product_id,
      quantity: p.quantity,
    }));

    const { error: productsError } = await supabase
      .from("kit_products")
      .insert(kitProductsData);

    if (productsError) {
      await supabase.from("kits").delete().eq("id", kit.id);
      console.error("Error al asociar productos al kit:", productsError);
      return { error: productsError.message };
    }

    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      data: kit,
      message: "Kit creado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues?.[0]?.message || "Error de validación";
      return { error: firstError };
    }
    console.error("Error inesperado en createKit:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al crear kit",
    };
  }
}

export async function updateKit(
  kitId: string,
  data: {
    name: string;
    description?: string;
    products: { product_id: string; quantity: number }[];
  }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const validatedData = kitSchema.parse(data);

    const { error: updateError } = await supabase
      .from("kits")
      .update({
        name: validatedData.name,
        description: validatedData.description || null,
      })
      .eq("id", kitId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX");

    if (updateError) {
      console.error("Error al actualizar kit:", updateError);
      return { error: updateError.message };
    }

    await supabase.from("kit_products").delete().eq("kit_id", kitId);

    const kitProductsData = validatedData.products.map((p) => ({
      kit_id: kitId,
      product_id: p.product_id,
      quantity: p.quantity,
    }));

    const { error: productsError } = await supabase
      .from("kit_products")
      .insert(kitProductsData);

    if (productsError) {
      console.error("Error al actualizar productos del kit:", productsError);
      return { error: productsError.message };
    }

    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      message: "Kit actualizado correctamente",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues?.[0]?.message || "Error de validación";
      return { error: firstError };
    }
    console.error("Error inesperado en updateKit:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al actualizar kit",
    };
  }
}

export async function deleteKit(kitId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const { error } = await supabase
      .from("kits")
      .delete()
      .eq("id", kitId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", profile.country_code || "MX");

    if (error) {
      console.error("Error al eliminar kit:", error);
      return { error: error.message };
    }

    revalidatePath("/dashboard/inventory");
    return {
      success: true,
      message: "Kit eliminado correctamente",
    };
  } catch (error) {
    console.error("Error inesperado en deleteKit:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al eliminar kit",
    };
  }
}

const kitExitLineSchema = z.object({
  kit_product_id: z.string().uuid("ID de línea de kit inválido"),
  quantity: z.coerce.number().int().positive(),
  expiration_date: z.union([z.string(), z.null()]).optional(),
  lot_number: z.union([z.string(), z.null()]).optional(),
});

export async function registerKitExit(data: {
  kit_id: string;
  warehouse_id: string;
  recipient?: string;
  notes?: string;
  lines: {
    kit_product_id: string;
    quantity: number;
    expiration_date?: string | null;
    lot_number?: string | null;
  }[];
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const countryCode = profile.country_code || "MX";

    if (!data.warehouse_id?.trim() || !z.string().uuid().safeParse(data.warehouse_id).success) {
      return { error: "Debés seleccionar un almacén válido" };
    }

    const warehouseId = data.warehouse_id.trim();

    const linesParse = z.array(kitExitLineSchema).safeParse(data.lines);
    if (!linesParse.success) {
      return { error: linesParse.error.issues[0]?.message || "Líneas de kit inválidas" };
    }

    const normalizedLines = linesParse.data.map((l) => ({
      kit_product_id: l.kit_product_id,
      quantity: l.quantity,
      expiration_date:
        l.expiration_date == null || l.expiration_date === ""
          ? null
          : l.expiration_date.length >= 10
            ? l.expiration_date.slice(0, 10)
            : l.expiration_date,
      lot_number:
        l.lot_number == null || String(l.lot_number).trim() === ""
          ? null
          : String(l.lot_number).trim(),
    }));

    const { data: kit, error: kitError } = await supabase
      .from("kits")
      .select("id, name")
      .eq("id", data.kit_id)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .single();

    if (kitError || !kit) {
      return { error: "Kit no encontrado" };
    }

    const { data: kitProducts, error: kitProductsError } = await supabase
      .from("kit_products")
      .select("id, product_id, quantity")
      .eq("kit_id", data.kit_id);

    if (kitProductsError || !kitProducts || kitProducts.length === 0) {
      return { error: "El kit no tiene productos asociados" };
    }

    if (normalizedLines.length !== kitProducts.length) {
      return { error: "Faltan líneas de selección de lote para el kit" };
    }

    const kpById = new Map(kitProducts.map((kp) => [kp.id, kp]));
    const lineIds = new Set(normalizedLines.map((l) => l.kit_product_id));
    if (lineIds.size !== kitProducts.length) {
      return { error: "Líneas de kit duplicadas o inválidas" };
    }
    for (const id of lineIds) {
      if (!kpById.has(id)) {
        return { error: "Línea de kit no pertenece a este kit" };
      }
    }

    for (const l of normalizedLines) {
      const kp = kpById.get(l.kit_product_id)!;
      if (l.quantity !== kp.quantity) {
        return {
          error: `La cantidad debe coincidir con la definición del kit (${kp.quantity} u.).`,
        };
      }
    }

    const productIds = [...new Set(kitProducts.map((kp) => kp.product_id))];
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, current_stock, country_code")
      .in("id", productIds);

    if (productsError || !products) {
      return { error: "Error al verificar productos del kit" };
    }

    for (const kp of kitProducts) {
      const product = products.find((p) => p.id === kp.product_id);
      if (!product) {
        return { error: `Producto no encontrado en el kit` };
      }
      if (product.country_code !== countryCode) {
        return { error: "No puedes usar productos de otro país en el kit" };
      }
      if (product.current_stock < kp.quantity) {
        return {
          error: `Stock insuficiente para "${product.name}". Stock actual: ${product.current_stock}, necesario: ${kp.quantity}`,
        };
      }
    }

    const { data: wh, error: whError } = await supabase
      .from("warehouses")
      .select("id, country_code")
      .eq("id", warehouseId)
      .eq("organization_id", profile.organization_id)
      .single();

    if (whError || !wh) {
      return { error: "Almacén no encontrado" };
    }

    if (wh.country_code !== countryCode) {
      return { error: "No puedes usar un almacén de otro país" };
    }

    for (const kp of kitProducts) {
      const product = products.find((p) => p.id === kp.product_id);
      const { data: wsRow } = await supabase
        .from("warehouse_stock")
        .select("current_stock")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", kp.product_id)
        .maybeSingle();

      if (!wsRow) {
        return {
          error: `No se puede registrar la salida del kit: "${product?.name || "Producto"}" no tiene stock en el almacén seleccionado.`,
        };
      }

      const whStock = wsRow.current_stock ?? 0;
      if (whStock < kp.quantity) {
        return {
          error: `Stock insuficiente en el almacén para "${product?.name}". Disponible: ${whStock}, necesario: ${kp.quantity}`,
        };
      }
    }

    const { data: movRows, error: movError } = await supabase
      .from("movements")
      .select("product_id, type, quantity, expiration_date, lot_number, created_at")
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .eq("warehouse_id", warehouseId)
      .in("product_id", productIds)
      .order("created_at", { ascending: true });

    if (movError) {
      return { error: movError.message };
    }

    type MovRow = {
      product_id: string;
      type: "Entrada" | "Salida";
      quantity: number;
      expiration_date: string | null;
      lot_number: string | null;
      created_at: string;
    };

    const movementsList = (movRows || []) as MovRow[];

    const initialByProduct = new Map<string, ReturnType<typeof computeLotBalancesForProduct>>();
    for (const pid of productIds) {
      const inputs: LotMovementInput[] = movementsList
        .filter((m) => m.product_id === pid)
        .map((m) => ({
          type: m.type,
          quantity: m.quantity,
          expiration_date: m.expiration_date,
          lot_number: m.lot_number,
          created_at: m.created_at,
        }));
      initialByProduct.set(pid, computeLotBalancesForProduct(inputs));
    }

    const lineByKp = new Map(normalizedLines.map((l) => [l.kit_product_id, l]));
    const orderedForValidation = kitProducts.map((kp) => {
      const l = lineByKp.get(kp.id);
      if (!l) {
        return null;
      }
      return {
        productId: kp.product_id,
        quantity: l.quantity,
        expirationDate: l.expiration_date,
        lotNumber: l.lot_number,
      };
    });
    if (orderedForValidation.some((x) => x === null)) {
      return { error: "Datos de líneas de kit incompletos" };
    }

    const lotCheck = validateSequentialLotConsumption(
      initialByProduct,
      orderedForValidation as {
        productId: string;
        quantity: number;
        expirationDate: string | null;
        lotNumber: string | null;
      }[]
    );
    if (!lotCheck.ok) {
      return { error: lotCheck.error };
    }

    const kitExitNote = `Salida por Kit: ${kit.name}${data.notes ? ` - ${data.notes}` : ""}`;

    const today = new Date().toISOString().split("T")[0];
    const movements = kitProducts.map((kp) => {
      const l = lineByKp.get(kp.id)!;
      return {
        product_id: kp.product_id,
        type: "Salida" as const,
        quantity: kp.quantity,
        movement_date: today,
        organization_id: profile.organization_id,
        country_code: countryCode,
        created_by: user.id,
        recipient: data.recipient || null,
        notes: kitExitNote,
        lot_number: l.lot_number,
        expiration_date: l.expiration_date,
        supplier_id: null,
        warehouse_id: warehouseId,
      };
    });

    const { error: movementsError } = await supabase
      .from("movements")
      .insert(movements);

    if (movementsError) {
      console.error("Error al registrar movimientos del kit:", movementsError);
      return { error: movementsError.message };
    }

    // Verificar productos con bajo stock después de la salida
    const { data: updatedProducts } = await supabase
      .from("products")
      .select("id, name, sku, current_stock, min_stock")
      .in("id", productIds);

    if (updatedProducts) {
      const lowStockProducts = updatedProducts.filter(
        (p) => p.current_stock <= p.min_stock
      );

      if (lowStockProducts.length > 0) {
        const { data: countryUsers } = await supabase
          .from("profiles")
          .select("email")
          .eq("organization_id", profile.organization_id)
          .eq("country_code", profile.country_code || "MX");

        if (countryUsers && countryUsers.length > 0) {
          const emails = countryUsers.map((u) => u.email).filter(Boolean);

          for (const product of lowStockProducts) {
            try {
              await fetch("https://n8n.srv908725.hstgr.cloud/webhook/bajo_stock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  emails,
                  product: {
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    current_stock: product.current_stock,
                    min_stock: product.min_stock,
                  },
                  country_code: profile.country_code || "MX",
                }),
              });
            } catch (webhookError) {
              console.error("Error al enviar webhook de bajo stock:", webhookError);
            }
          }
        }
      }
    }

    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/reports");
    revalidatePath("/dashboard/warehouses");
    return {
      success: true,
      message: `Salida del kit "${kit.name}" registrada correctamente (${kitProducts.length} productos)`,
    };
  } catch (error) {
    console.error("Error inesperado en registerKitExit:", error);
    return {
      error: error instanceof Error ? error.message : "Error inesperado al registrar salida del kit",
    };
  }
}

export async function updateMovementWarehouse(
  movementId: string,
  warehouseId: string | null
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "No autenticado" };
    }

    if (!z.string().uuid().safeParse(movementId).success) {
      return { error: "ID de movimiento inválido" };
    }

    if (warehouseId && !z.string().uuid().safeParse(warehouseId).success) {
      return { error: "ID de almacén inválido" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, country_code")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { error: "Error al obtener información del usuario" };
    }

    const countryCode = profile.country_code || "MX";

    const { data: movement, error: movementError } = await supabase
      .from("movements")
      .select("id, product_id, type, quantity, warehouse_id")
      .eq("id", movementId)
      .eq("organization_id", profile.organization_id)
      .eq("country_code", countryCode)
      .single();

    if (movementError || !movement) {
      return { error: "Movimiento no encontrado" };
    }

    if (movement.warehouse_id === warehouseId) {
      return {
        success: true,
        message: "No hubo cambios en el almacén",
      };
    }

    if (warehouseId) {
      const { data: warehouse, error: warehouseError } = await supabase
        .from("warehouses")
        .select("id, country_code")
        .eq("id", warehouseId)
        .eq("organization_id", profile.organization_id)
        .single();

      if (warehouseError || !warehouse) {
        return { error: "Almacén no encontrado" };
      }

      if (warehouse.country_code !== countryCode) {
        return { error: "No puedes usar un almacén de otro país" };
      }
    }

    const stockDelta =
      movement.type === "Entrada" ? movement.quantity : -movement.quantity;

    if (movement.warehouse_id) {
      const { data: oldStockRow } = await supabase
        .from("warehouse_stock")
        .select("id, current_stock")
        .eq("warehouse_id", movement.warehouse_id)
        .eq("product_id", movement.product_id)
        .maybeSingle();

      if (oldStockRow) {
        const nextStock = oldStockRow.current_stock - stockDelta;
        if (nextStock < 0) {
          return {
            error:
              "No se puede editar este movimiento porque dejaría stock negativo en el almacén actual.",
          };
        }

        const { error: oldUpdateError } = await supabase
          .from("warehouse_stock")
          .update({
            current_stock: nextStock,
            updated_at: new Date().toISOString(),
          })
          .eq("id", oldStockRow.id);

        if (oldUpdateError) {
          return { error: oldUpdateError.message };
        }
      }
    }

    if (warehouseId) {
      const { data: newStockRow } = await supabase
        .from("warehouse_stock")
        .select("id, current_stock")
        .eq("warehouse_id", warehouseId)
        .eq("product_id", movement.product_id)
        .maybeSingle();

      if (newStockRow) {
        const nextStock = newStockRow.current_stock + stockDelta;
        if (nextStock < 0) {
          return {
            error:
              "No se puede asignar este movimiento al almacén seleccionado: stock insuficiente en esa ubicación.",
          };
        }

        const { error: newUpdateError } = await supabase
          .from("warehouse_stock")
          .update({
            current_stock: nextStock,
            updated_at: new Date().toISOString(),
          })
          .eq("id", newStockRow.id);

        if (newUpdateError) {
          return { error: newUpdateError.message };
        }
      } else {
        if (stockDelta < 0) {
          return {
            error:
              "No se puede asignar una salida a un almacén que no tiene stock previo de este producto.",
          };
        }

        const { error: insertError } = await supabase.from("warehouse_stock").insert({
          warehouse_id: warehouseId,
          product_id: movement.product_id,
          current_stock: stockDelta,
        });

        if (insertError) {
          return { error: insertError.message };
        }
      }
    }

    const { error: updateMovementError } = await supabase
      .from("movements")
      .update({
        warehouse_id: warehouseId,
      })
      .eq("id", movement.id);

    if (updateMovementError) {
      return { error: updateMovementError.message };
    }

    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/inventory");
    revalidatePath("/dashboard/reports");
    revalidatePath("/dashboard/warehouses");

    return {
      success: true,
      message: "Almacén del movimiento actualizado correctamente",
    };
  } catch (error) {
    console.error("Error inesperado en updateMovementWarehouse:", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Error inesperado al actualizar el almacén del movimiento",
    };
  }
}

