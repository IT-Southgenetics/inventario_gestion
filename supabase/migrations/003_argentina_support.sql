-- Migración 003: Soporte para Argentina y campo tax_id genérico en proveedores
-- tax_id almacena: RFC (MX), RUT (UY), CUIT (AR)

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS tax_id VARCHAR(20);

-- Índice para búsquedas por tax_id
CREATE INDEX IF NOT EXISTS idx_suppliers_tax_id
  ON public.suppliers(tax_id)
  WHERE tax_id IS NOT NULL;

-- Comentario descriptivo
COMMENT ON COLUMN public.suppliers.tax_id IS
  'Identificación fiscal del proveedor: RFC (MX), RUT (UY), CUIT (AR)';
