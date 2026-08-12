import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { base44 } from "@/api/base44Client";

export const paymentStatusConfig = {
  "Paid": { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: "✅" },
  "Partially Paid": { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: "🟡" },
  "Unpaid": { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: "🔴" }
};

export const statusLabels = {
  "Paid": "שולם",
  "Partially Paid": "שולם חלקית",
  "Unpaid": "לא שולם"
};

export default function PaymentStatusSelector({ eventId, currentStatus, onStatusChange }) {
  const [updating, setUpdating] = useState(false);
  const status = currentStatus || "Unpaid";
  const config = paymentStatusConfig[status] || paymentStatusConfig["Unpaid"];

  const handleChange = async (newStatus) => {
    if (updating) return;
    setUpdating(true);
    try {
      await base44.entities.Event.update(eventId, { clientPaymentStatus: newStatus });
      if (onStatusChange) onStatusChange(newStatus);
    } catch (error) {
      console.error("Failed to update payment status:", error);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={updating}
          className="focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Badge
            variant="outline"
            className={`${config.color} border font-medium cursor-pointer hover:opacity-80 transition-opacity`}
          >
            {updating ? "מעדכן..." : `${config.icon} ${statusLabels[status]}`}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-gray-800 border-gray-700 text-white">
        <DropdownMenuItem onSelect={() => handleChange("Paid")} className="focus:bg-green-500/20 cursor-pointer">
          <span className="mr-2">✅</span> {statusLabels["Paid"]}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleChange("Partially Paid")} className="focus:bg-yellow-500/20 cursor-pointer">
          <span className="mr-2">🟡</span> {statusLabels["Partially Paid"]}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handleChange("Unpaid")} className="focus:bg-red-500/20 cursor-pointer">
          <span className="mr-2">🔴</span> {statusLabels["Unpaid"]}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}