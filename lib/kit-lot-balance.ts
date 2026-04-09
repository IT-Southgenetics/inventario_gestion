/**
 * Reconstruye stock por lote/vencimiento a partir del historial de movimientos
 * en un almacén. Las salidas sin vencimiento/lote consumen FIFO por fecha de vencimiento.
 */

export type LotMovementInput = {
  type: "Entrada" | "Salida";
  quantity: number;
  expiration_date: string | null;
  lot_number: string | null;
  created_at: string;
};

export type LotBalance = {
  expirationDate: string | null;
  lotNumber: string | null;
  quantity: number;
};

type InternalBucket = {
  expirationDate: string | null;
  lotNumber: string | null;
  quantity: number;
};

function normDate(d: string | null | undefined): string | null {
  if (d == null || d === "") return null;
  return d.length >= 10 ? d.slice(0, 10) : d;
}

function normLot(l: string | null | undefined): string | null {
  if (l == null || l.trim() === "") return null;
  return l.trim();
}

function bucketKey(expirationDate: string | null, lotNumber: string | null): string {
  return `${normDate(expirationDate) ?? ""}\0${normLot(lotNumber) ?? ""}`;
}

function expSortKey(expirationDate: string | null): number {
  const d = normDate(expirationDate);
  if (!d) return Number.POSITIVE_INFINITY;
  const t = new Date(d + "T00:00:00").getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function findBucket(
  buckets: InternalBucket[],
  expirationDate: string | null,
  lotNumber: string | null
): InternalBucket | undefined {
  const ek = normDate(expirationDate);
  const lk = normLot(lotNumber);
  return buckets.find(
    (b) => normDate(b.expirationDate) === ek && normLot(b.lotNumber) === lk
  );
}

/**
 * Saldo actual por combinación (vencimiento, lote) para un producto en un almacén.
 */
export function computeLotBalancesForProduct(
  movements: LotMovementInput[]
): LotBalance[] {
  const sorted = [...movements].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const buckets: InternalBucket[] = [];

  for (const m of sorted) {
    const q = m.quantity;
    if (q <= 0) continue;

    if (m.type === "Entrada") {
      const b = findBucket(buckets, m.expiration_date, m.lot_number);
      if (b) {
        b.quantity += q;
      } else {
        buckets.push({
          expirationDate: normDate(m.expiration_date),
          lotNumber: normLot(m.lot_number),
          quantity: q,
        });
      }
      continue;
    }

    // Salida
    let remaining = q;
    const hasTarget =
      normDate(m.expiration_date) != null || normLot(m.lot_number) != null;

    if (hasTarget) {
      const b = findBucket(buckets, m.expiration_date, m.lot_number);
      if (b) {
        const take = Math.min(remaining, b.quantity);
        b.quantity -= take;
        remaining -= take;
      }
    }

    if (remaining > 0) {
      const positive = buckets
        .filter((b) => b.quantity > 0)
        .sort((a, b) => expSortKey(a.expirationDate) - expSortKey(b.expirationDate));

      for (const b of positive) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, b.quantity);
        b.quantity -= take;
        remaining -= take;
      }
    }
  }

  return buckets
    .filter((b) => b.quantity > 0)
    .map((b) => ({
      expirationDate: b.expirationDate,
      lotNumber: b.lotNumber,
      quantity: b.quantity,
    }));
}

export function encodeLotSelection(
  expirationDate: string | null,
  lotNumber: string | null
): string {
  return JSON.stringify({
    e: normDate(expirationDate),
    l: normLot(lotNumber),
  });
}

export function decodeLotSelection(raw: string): {
  expirationDate: string | null;
  lotNumber: string | null;
} {
  try {
    const o = JSON.parse(raw) as { e?: string | null; l?: string | null };
    return {
      expirationDate: o.e == null || o.e === "" ? null : String(o.e),
      lotNumber: o.l == null || o.l === "" ? null : String(o.l),
    };
  } catch {
    return { expirationDate: null, lotNumber: null };
  }
}

/** Valida y descuenta lotes en orden (mismo producto puede aparecer varias veces en el kit). */
export function validateSequentialLotConsumption(
  initialByProduct: Map<string, LotBalance[]>,
  lines: {
    productId: string;
    quantity: number;
    expirationDate: string | null;
    lotNumber: string | null;
  }[]
): { ok: true } | { ok: false; error: string } {
  const working = new Map<string, Map<string, number>>();

  for (const [pid, balances] of initialByProduct) {
    const m = new Map<string, number>();
    for (const b of balances) {
      const k = bucketKey(b.expirationDate, b.lotNumber);
      m.set(k, (m.get(k) ?? 0) + b.quantity);
    }
    working.set(pid, m);
  }

  for (const line of lines) {
    const m = working.get(line.productId);
    if (!m) {
      return {
        ok: false,
        error: "No hay stock trazable para uno de los productos en este almacén.",
      };
    }
    const k = bucketKey(line.expirationDate, line.lotNumber);
    const cur = m.get(k) ?? 0;
    if (cur < line.quantity) {
      return {
        ok: false,
        error:
          "La cantidad elegida supera el disponible en el lote/vencimiento seleccionado.",
      };
    }
    m.set(k, cur - line.quantity);
  }

  return { ok: true };
}

export function formatLotLabel(b: LotBalance): string {
  const exp =
    b.expirationDate == null
      ? "Sin vencimiento"
      : `Vence ${b.expirationDate}`;
  const lot =
    b.lotNumber == null || b.lotNumber === ""
      ? "sin lote"
      : `Lote ${b.lotNumber}`;
  return `${exp} · ${lot} · ${b.quantity} u.`;
}
