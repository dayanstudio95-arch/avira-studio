import React from "react";

// Design E for the reports (2026-10-07, the owner's reference image): gold income, coral
// expenses, green profit, each a vertical gradient; faint navy grid; glass tooltip.
export const CHART_COLORS = { income: "#FACC15", expenses: "#F05B70", profit: "#22C987" };

// Called as a function ({chartGradients()}): recharts only renders a <defs> element placed
// directly inside the chart, not one wrapped in a component.
export function chartGradients() {
  return (
    <defs>
      <linearGradient id="rg-income" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FDE047" />
        <stop offset="100%" stopColor="#F59E0B" />
      </linearGradient>
      <linearGradient id="rg-expenses" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FB7185" />
        <stop offset="100%" stopColor="#E11D48" />
      </linearGradient>
      <linearGradient id="rg-profit" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#34D399" />
        <stop offset="100%" stopColor="#059669" />
      </linearGradient>
    </defs>
  );
}

export const gridProps = { strokeDasharray: "3 3", stroke: "rgba(148,163,184,0.14)" };
export const axisProps = { stroke: "#7C8AA3", tickLine: false, axisLine: { stroke: "rgba(148,163,184,0.25)" } };
export const tooltipProps = {
  contentStyle: {
    background: "rgba(12,23,44,0.95)",
    border: "1px solid rgba(96,130,240,0.45)",
    borderRadius: 12,
    color: "#F8FAFC",
    boxShadow: "0 12px 30px -10px rgba(0,0,0,0.8)",
  },
  cursor: { fill: "rgba(96,130,240,0.08)" },
};

export function Legend({ items }) {
  return (
    <div className="flex items-center gap-4 text-sm text-slate-300">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          {label}
        </span>
      ))}
    </div>
  );
}
