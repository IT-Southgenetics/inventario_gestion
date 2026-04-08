export type UserRole = "ADMIN" | "MANAGER" | "VIEWER";

export interface Profile {
  id: string;
  email: string;
  organization_id: string;
  role: UserRole;
  country_code: string;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  color: string | null;
  organization_id: string;
  country_code: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_email: string | null;
  phone: string | null;
  tax_id: string | null;
  organization_id: string;
  country_code: string;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  stock: number; // Deprecated: usar current_stock
  current_stock: number;
  min_stock: number;
  description: string | null;
  expiration_date: string | null;
  category_id: number;
  organization_id: string;
  country_code: string;
  created_at: string;
  updated_at: string;
}

export interface Kit {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  country_code: string;
  created_at: string;
  updated_at: string;
}

export interface KitProduct {
  id: string;
  kit_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
}

export interface Movement {
  id: string;
  product_id: string;
  type: "Entrada" | "Salida";
  quantity: number;
  movement_date: string;
  lot_number: string | null;
  expiration_date: string | null;
  supplier_id: string | null;
  recipient: string | null;
  notes: string | null;
  organization_id: string;
  country_code: string;
  created_at: string;
  created_by: string | null;
}

