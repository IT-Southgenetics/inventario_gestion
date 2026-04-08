"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  LogOut,
  X,
  Building2,
  History,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { signOut } from "@/actions/auth";
import { createClient } from "@/lib/supabase/client";
import { CountrySelector } from "./country-selector";

interface SidebarProps {
  onClose?: () => void;
  isMobile?: boolean;
}

const navigationItems: Array<{
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}> = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Inventario",
    href: "/dashboard/inventory",
    icon: Package,
  },
  {
    name: "Proveedores",
    href: "/dashboard/suppliers",
    icon: Building2,
  },
  {
    name: "Historial",
    href: "/dashboard/history",
    icon: History,
  },
  {
    name: "Reportes",
    href: "/dashboard/reports",
    icon: FileSpreadsheet,
  },
  {
    name: "Usuarios",
    href: "/dashboard/users",
    icon: Users,
    adminOnly: false,
  },
];

export function Sidebar({ onClose, isMobile = false }: SidebarProps) {
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("VIEWER");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserEmail(user.email || "");

        // Obtener el rol del usuario
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (profile) {
          setUserRole(profile.role);
        }
      }

      setIsLoading(false);
    }

    loadUser();
  }, []);

  const filteredItems = navigationItems.filter(
    (item) => !item.adminOnly || userRole === "ADMIN"
  );

  return (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-teal-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">SG</span>
          </div>
          <span className="text-xl font-bold text-teal-700">
            SouthGenetics
          </span>
        </div>
        {isMobile && onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-4 py-4">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={isMobile ? onClose : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors touch-target",
                isActive
                  ? "bg-teal-50 text-teal-700 border-l-4 border-teal-600"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer - User Profile */}
      <div className="border-t border-slate-200 p-4">
        {!isLoading && (
          <>
            <div className="mb-3 flex items-center gap-3 px-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-teal-700 font-semibold text-xs">
                {userEmail
                  .split("@")[0]
                  .split(".")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {userEmail.split("@")[0]}
                </p>
                <p className="text-xs text-slate-500 truncate">{userEmail}</p>
              </div>
            </div>
            <div className="mb-3">
              <CountrySelector />
            </div>
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                className="w-full justify-start text-slate-600 hover:text-red-600 hover:bg-red-50"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesión
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

