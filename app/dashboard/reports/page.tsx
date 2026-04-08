"use client";

import { Suspense } from "react";
import { ReportsContent } from "./reports-content";

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-6">
          <div className="text-center py-12 text-slate-500">
            Cargando reportes...
          </div>
        </div>
      }
    >
      <ReportsContent />
    </Suspense>
  );
}
