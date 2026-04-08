-- Almacenes / ubicaciones y stock por almacén

CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  organization_id uuid NOT NULL,
  country_code varchar DEFAULT 'MX',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  current_stock integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_org_country ON public.warehouses(organization_id, country_code);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_warehouse ON public.warehouse_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product ON public.warehouse_stock(product_id);

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movements_warehouse ON public.movements(warehouse_id);

-- Trigger: actualizar warehouse_stock cuando hay almacén en el movimiento
CREATE OR REPLACE FUNCTION public.update_warehouse_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delta integer;
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'Entrada' THEN
    delta := NEW.quantity;
  ELSIF NEW.type = 'Salida' THEN
    delta := -NEW.quantity;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.warehouse_stock (id, warehouse_id, product_id, current_stock)
  VALUES (gen_random_uuid(), NEW.warehouse_id, NEW.product_id, delta)
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET
    current_stock = warehouse_stock.current_stock + EXCLUDED.current_stock,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_warehouse_stock_after_movement ON public.movements;
CREATE TRIGGER update_warehouse_stock_after_movement
  AFTER INSERT ON public.movements
  FOR EACH ROW
  EXECUTE PROCEDURE public.update_warehouse_stock();

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;

-- RLS warehouses (mismo patrón que kits)
DROP POLICY IF EXISTS "Users can view warehouses from their org and country" ON public.warehouses;
DROP POLICY IF EXISTS "Users can insert warehouses in their org and country" ON public.warehouses;
DROP POLICY IF EXISTS "Users can update warehouses in their org and country" ON public.warehouses;
DROP POLICY IF EXISTS "Users can delete warehouses in their org and country" ON public.warehouses;
DROP POLICY IF EXISTS "Users can view warehouse_stock via warehouse" ON public.warehouse_stock;

CREATE POLICY "Users can view warehouses from their org and country" ON public.warehouses
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert warehouses in their org and country" ON public.warehouses
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update warehouses in their org and country" ON public.warehouses
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete warehouses in their org and country" ON public.warehouses
  FOR DELETE USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
    AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
  );

-- RLS warehouse_stock: solo filas cuyo almacén pertenece al usuario
CREATE POLICY "Users can view warehouse_stock via warehouse" ON public.warehouse_stock
  FOR SELECT USING (
    warehouse_id IN (
      SELECT id FROM public.warehouses
      WHERE organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
    )
  );
