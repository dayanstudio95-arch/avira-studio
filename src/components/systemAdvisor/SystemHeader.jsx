import React from "react";
import { Shield, RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

function getSystemStatus(score) {
  if (score >= 80) return { label: "תקין", color: "text-emerald-400", icon: CheckCircle, bg: "bg-emerald-500/15 border-emerald-500/40" };
  if (score >= 50) return { label: "יש בעיות", color: "text-orange-400", icon: AlertTriangle, bg: "bg-orange-500/15 border-orange-500/40" };
  return { label: "קריטי", color: "text-red-400", icon: XCircle, bg: "bg-red-500/15 border-red-500/40" };
}

export default function SystemHeader({ score, openIssues, activeAutomations, totalAutomations, totalDebt, inactiveAutomations, unpaidCount, lastRefresh, loading, onRefresh }) {
  const status = getSystemStatus(score);
  const StatusIcon = status.icon;

  const formatTime = (d) => d
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : "";

  const today = new Date();
  const dateStr = today.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-5">
      {/* Top row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white text-lg font-bold leading-tight">יועץ מערכת</h1>
            <p className="text-gray-500 text-xs">{dateStr}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-gray-600 text-xs hidden sm:block">עודכן: {formatTime(lastRefresh)}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="border-gray-700 text-gray-400 hover:text-white text-xs gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            רענן
          </Button>
        </div>
      </div>

      {/* KPI pills — clickable */}
      <div className="flex flex-wrap gap-3">
        {/* System status */}
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold ${status.bg} ${status.color}`}>
          <StatusIcon className="w-4 h-4" />
          מצב: {status.label}
        </div>

        {/* Open issues */}
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold ${
          openIssues > 0
            ? "bg-red-500/15 border-red-500/40 text-red-400"
            : "bg-gray-800 border-gray-700 text-gray-400"
        }`}>
          🔴 {openIssues} בעיות פתוחות
        </div>

        {/* Automations — clickable → AutomationsDashboard */}
        <Link
          to="/AutomationsDashboard"
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-opacity hover:opacity-80 cursor-pointer ${
            inactiveAutomations > 0
              ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
              : "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
          }`}
        >
          {inactiveAutomations > 0 ? "⚠️" : "✅"} {activeAutomations}/{totalAutomations} אוטומציות
          {inactiveAutomations > 0 && <span className="text-xs opacity-70">({inactiveAutomations} כבויות)</span>}
        </Link>

        {/* Debt — clickable → tab business */}
        <button
          onClick={() => {
            const el = document.querySelector('[data-tab-trigger="business"]');
            if (el) el.click();
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-opacity hover:opacity-80 cursor-pointer ${
            totalDebt > 0
              ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
              : "bg-gray-800 border-gray-700 text-gray-400"
          }`}
        >
          💰 ₪{totalDebt.toLocaleString()} חובות
          {unpaidCount > 0 && <span className="text-xs opacity-70">({unpaidCount} לקוחות)</span>}
        </button>
      </div>
    </div>
  );
}