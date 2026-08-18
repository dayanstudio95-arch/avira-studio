import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, RefreshCw, ChevronDown, ChevronUp, Plus, Pencil, Trash2 } from "lucide-react";

// Rows are written exclusively by the log_audit_event() Postgres trigger
// (supabase/migrations/0024_audit_log.sql) attached to these 8 tables — this is a
// read-only viewer, there's no create/edit UI here on purpose.
const TABLE_LABELS = {
  profiles: "משתמשים",
  tenants: "פרטי הסטודיו",
  app_settings: "הגדרות מערכת",
  tenant_secrets: "מפתחות אינטגרציה",
  staff_members: "אנשי צוות (תעריפים)",
  packages: "חבילות",
  discount_presets: "הנחות",
  automations: "אוטומציות",
};

const FIELD_LABELS = {
  role: "תפקיד",
  is_active: "פעיל",
  full_name: "שם מלא",
  phone: "טלפון",
  name: "שם",
  value: "ערך",
  key: "מפתח",
  price: "מחיר",
  default_price: "מחיר ברירת מחדל",
  amount: "סכום",
  default_rate: "תעריף ברירת מחדל",
  rates_by_role: "תעריפים לפי תפקיד",
  is_active_automation: "פעיל",
  frequency: "תדירות",
  logo_url: "לוגו",
  display_name_to_clients: "שם ללקוחות",
  timezone: "אזור זמן",
  currency: "מטבע",
};

const ACTION_META = {
  insert: { label: "נוסף", icon: Plus, className: "bg-green-900/50 text-green-300 border-green-700" },
  update: { label: "עודכן", icon: Pencil, className: "bg-blue-900/50 text-blue-300 border-blue-700" },
  delete: { label: "נמחק", icon: Trash2, className: "bg-red-900/50 text-red-300 border-red-700" },
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatValue(val) {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "כן" : "לא";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export default function AuditLogTab() {
  const { user } = useAuth();
  const canView = isAdmin(user);

  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await base44.entities.AuditLog.list("-created_date", 200);
      setLogs(data);
    } catch {
      // RLS blocks this table for non-admin roles entirely — a permission error here
      // just means "nothing to show", not a real failure, so it's swallowed rather
      // than surfaced as a toast.
      setLogs([]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (canView) load();
    else setIsLoading(false);
  }, [canView]);

  if (!canView) return null;

  const presentTables = [...new Set(logs.map((l) => l.tableName))];
  const filteredLogs = tableFilter === "all" ? logs : logs.filter((l) => l.tableName === tableFilter);

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800 flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-white flex items-center gap-2">
            <History className="w-5 h-5 text-yellow-400" />
            יומן פעילות
          </CardTitle>
          <p className="text-gray-400 text-sm mt-1">מי שינה מה — משתמשים, הגדרות, תמחור וצוות (200 האחרונים)</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" className="border-gray-700 text-gray-300 gap-2">
          <RefreshCw className="w-4 h-4" /> רענן
        </Button>
      </CardHeader>
      <CardContent className="p-6">
        {presentTables.length > 0 && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setTableFilter("all")}
              className={`px-3 py-1 rounded text-sm ${tableFilter === "all" ? "bg-yellow-500 text-gray-900 font-semibold" : "bg-gray-800 text-gray-300"}`}
            >
              הכל
            </button>
            {presentTables.map((t) => (
              <button
                key={t}
                onClick={() => setTableFilter(t)}
                className={`px-3 py-1 rounded text-sm ${tableFilter === t ? "bg-yellow-500 text-gray-900 font-semibold" : "bg-gray-800 text-gray-300"}`}
              >
                {TABLE_LABELS[t] || t}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="h-32 bg-gray-800 rounded-lg animate-pulse" />
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>אין רשומות עדיין</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log) => {
              const meta = ACTION_META[log.action] || ACTION_META.update;
              const Icon = meta.icon;
              const isExpanded = expandedId === log.id;
              const changedKeys = log.changedFields ? Object.keys(log.changedFields) : [];
              const isExpandable = log.action === "update" && changedKeys.length > 0;

              return (
                <div key={log.id} className="bg-gray-800/40 border border-gray-700 rounded-lg overflow-hidden">
                  <div
                    className={`flex items-center justify-between p-3 ${isExpandable ? "cursor-pointer hover:bg-gray-800/70" : ""}`}
                    onClick={() => isExpandable && setExpandedId(isExpanded ? null : log.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${meta.className}`}>
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                      <div>
                        <p className="text-sm text-white">
                          <span className="font-medium">{log.actorName || "מערכת"}</span>
                          {" "}
                          <span className="text-gray-400">{TABLE_LABELS[log.tableName] || log.tableName}</span>
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(log.createdDate || log.createdAt)}</p>
                      </div>
                    </div>
                    {isExpandable && (isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />)}
                  </div>

                  {isExpandable && isExpanded && (
                    <div className="border-t border-gray-700 bg-gray-950/50 p-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-right py-1 pl-4 font-medium">שדה</th>
                            <th className="text-right py-1 font-medium">ערך חדש</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changedKeys.map((key) => (
                            <tr key={key} className="border-t border-gray-800">
                              <td className="py-1 pl-4 text-gray-400">{FIELD_LABELS[key] || key}</td>
                              <td className="py-1 text-gray-200">{formatValue(log.changedFields[key])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
