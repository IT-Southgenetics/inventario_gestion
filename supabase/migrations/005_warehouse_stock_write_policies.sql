-- Permitir escrituras en warehouse_stock bajo RLS
-- Solo sobre filas que pertenezcan a almacenes de la misma organización y país del usuario.

DROP POLICY IF EXISTS "Users can insert warehouse_stock via warehouse" ON public.warehouse_stock;
DROP POLICY IF EXISTS "Users can update warehouse_stock via warehouse" ON public.warehouse_stock;
DROP POLICY IF EXISTS "Users can delete warehouse_stock via warehouse" ON public.warehouse_stock;

CREATE POLICY "Users can insert warehouse_stock via warehouse" ON public.warehouse_stock
  FOR INSERT
  WITH CHECK (
    warehouse_id IN (
      SELECT id FROM public.warehouses
      WHERE organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can update warehouse_stock via warehouse" ON public.warehouse_stock
  FOR UPDATE
  USING (
    warehouse_id IN (
      SELECT id FROM public.warehouses
      WHERE organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    warehouse_id IN (
      SELECT id FROM public.warehouses
      WHERE organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can delete warehouse_stock via warehouse" ON public.warehouse_stock
  FOR DELETE
  USING (
    warehouse_id IN (
      SELECT id FROM public.warehouses
      WHERE organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
        AND country_code = (SELECT COALESCE(country_code, 'MX') FROM public.profiles WHERE id = auth.uid())
    )
  );
