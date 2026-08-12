import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { Download, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AllInvoicesPage() {
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadAllLeads();
  }, []);

  const loadAllLeads = async () => {
    setIsLoading(true);
    try {
      const allLeads = await base44.entities.Lead.list("-created_date");
      setLeads(allLeads || []);
    } catch (error) {
      console.error("Error loading leads:", error);
      toast.error("שגיאה בטעינת הנתונים");
    } finally {
      setIsLoading(false);
    }
  };

  // Flatten all invoices from all leads
  const allInvoices = leads.flatMap(lead =>
    (lead.invoicesList || []).map(inv => ({
      ...inv,
      leadId: lead.id,
      coupleNames: lead.coupleNames,
      leadEventDate: lead.eventDate,
    }))
  );

  // Filter by search term
  const filteredInvoices = allInvoices.filter(inv =>
    inv.coupleNames?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.number?.includes(searchTerm) ||
    inv.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sort by date descending
  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateB - dateA;
  });

  // Calculate totals
  const totalAmount = filteredInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const totalVat = totalAmount * 0.18; // Assuming 18% VAT

  const exportToCSV = () => {
    const headers = ["שם הלקוח", "תאריך אירוע", "מס' חשבונית", "תאריך", "תיאור", "סכום", "קישור"];
    const rows = filteredInvoices.map(inv => [
      inv.coupleNames || "—",
      inv.leadEventDate ? format(new Date(inv.leadEventDate), "d/M/yyyy") : "—",
      inv.number || "—",
      inv.date ? format(new Date(inv.date), "d/M/yyyy") : "—",
      inv.description || "—",
      inv.amount || 0,
      inv.url || "—",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `חשבוניות_${format(new Date(), "dd-MM-yyyy")}.csv`;
    link.click();
    toast.success("קובץ CSV הורד בהצלחה");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-6" dir="rtl">
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">ניהול חשבוניות</h1>
            <p className="text-gray-400 text-sm mt-1">רשימה מרכזית של כל החשבוניות במערכת</p>
          </div>
          <Button
            onClick={exportToCSV}
            disabled={filteredInvoices.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg gap-2"
          >
            <Download className="w-4 h-4" />
            ייצא CSV
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-gray-400 text-xs font-semibold uppercase mb-1">סה"כ חשבוניות</div>
            <div className="text-2xl font-bold text-white">{filteredInvoices.length}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-gray-400 text-xs font-semibold uppercase mb-1">סכום כולל</div>
            <div className="text-2xl font-bold text-green-400">₪{totalAmount.toLocaleString()}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-gray-400 text-xs font-semibold uppercase mb-1">מע"מ 18%</div>
            <div className="text-2xl font-bold text-yellow-400">₪{totalVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-gray-400 text-xs font-semibold uppercase mb-1">סה"כ לידים</div>
            <div className="text-2xl font-bold text-blue-400">{leads.filter(l => (l.invoicesList || []).length > 0).length}</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="חיפוש לפי שם לקוח, מספר חשבונית או תיאור..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-500 rounded-lg px-4 py-2"
          />
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {filteredInvoices.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500">אין חשבוניות להצגה</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/80 text-gray-400 border-b border-gray-700">
                      <th className="text-right px-4 py-3 font-semibold">שם לקוח</th>
                      <th className="text-center px-3 py-3 font-semibold">תאריך אירוע</th>
                      <th className="text-center px-3 py-3 font-semibold">מס' חשבונית</th>
                      <th className="text-center px-3 py-3 font-semibold">תאריך חשבונית</th>
                      <th className="text-center px-3 py-3 font-semibold">תיאור</th>
                      <th className="text-center px-3 py-3 font-semibold">סכום</th>
                      <th className="text-center px-3 py-3 font-semibold">קישור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInvoices.map((inv, idx) => (
                      <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{inv.coupleNames || "—"}</td>
                        <td className="px-3 py-3 text-gray-300 text-center whitespace-nowrap">
                          {inv.leadEventDate ? format(new Date(inv.leadEventDate), "d/M/yyyy") : "—"}
                        </td>
                        <td className="px-3 py-3 text-gray-300 text-center">{inv.number || "—"}</td>
                        <td className="px-3 py-3 text-gray-300 text-center whitespace-nowrap">
                          {inv.date ? format(new Date(inv.date), "d/M/yyyy") : "—"}
                        </td>
                        <td className="px-3 py-3 text-gray-300 max-w-[150px] truncate" title={inv.description}>
                          {inv.description || "—"}
                        </td>
                        <td className="px-3 py-3 text-center text-green-400 font-semibold whitespace-nowrap">
                          ₪{(inv.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {inv.url ? (
                            <a
                              href={inv.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 transition-colors"
                              title="פתח חשבונית"
                            >
                              <Download className="w-4 h-4 inline-block" />
                            </a>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-800/60 border-t-2 border-gray-700">
                      <td colSpan={5} className="px-4 py-3 text-gray-400 font-semibold">סה"כ</td>
                      <td className="px-3 py-3 text-center text-green-400 font-bold whitespace-nowrap">
                        ₪{totalAmount.toLocaleString()}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden p-4 space-y-4">
                {sortedInvoices.map((inv, idx) => (
                  <div key={idx} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-white">{inv.coupleNames || "—"}</p>
                        <p className="text-xs text-gray-400">מס' {inv.number || "—"}</p>
                      </div>
                      <span className="text-green-400 font-bold whitespace-nowrap">
                        ₪{(inv.amount || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-400">אירוע:</span>
                        <p className="text-white">{inv.leadEventDate ? format(new Date(inv.leadEventDate), "d/M/yyyy") : "—"}</p>
                      </div>
                      <div>
                        <span className="text-gray-400">תאריך:</span>
                        <p className="text-white">{inv.date ? format(new Date(inv.date), "d/M/yyyy") : "—"}</p>
                      </div>
                    </div>
                    {inv.url && (
                      <a
                        href={inv.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center text-blue-400 hover:text-blue-300 text-xs font-medium"
                      >
                        פתח חשבונית
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}