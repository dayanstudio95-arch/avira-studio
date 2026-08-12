import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { FileText, Loader2, CheckCircle2, X, FileCheck, HelpCircle, Banknote, TrendingUp, Share2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// This component is deprecated - use UnifiedSidePanel instead
export default function EventDetailDrawer({ isOpen, onClose, event, staffMembers, onEventUpdated }) {
  // Render nothing - redirect to new unified component
  return null;
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSharingTeam, setIsSharingTeam] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);

  if (!event) return null;

  const team = event.team || [];
  const assignedTeam = team.filter(m => {
    if (!m.staffMemberName) return false;
    const staffMember = staffMembers.find(s => s.name === m.staffMemberName);
    return staffMember?.role !== 'editor';
  });
  const requiredCrew = event.requiredCrew || 3;
  const isFullTeam = assignedTeam.length >= requiredCrew;

  const getRoleColor = (memberName) => {
    const staffMember = staffMembers.find(s => s.name === memberName);
    if (staffMember?.role === 'photographer') return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    if (staffMember?.role === 'videographer') return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  const getRoleLabel = (role) => {
    if (role === 'photographer' || role === 'photographer1') return '📸 צלם סטילס 1';
    if (role === 'photographer2') return '📸 צלם סטילס 2';
    if (role === 'videographer') return '🎥 צלם וידאו';
    if (role === 'videographer2') return '🎥 צלם וידאו 2';
    if (role === 'editor') return '✂️ עורך';
    return role;
  };

  const handleShareWithTeam = async () => {
    if (team.length === 0) {
      toast.error('אין צוות משובץ לאירוע זה');
      return;
    }

    setIsSharingTeam(true);
    try {
      const result = await base44.functions.invoke('shareEventInfoWithTeam', {
        eventId: event.id
      });

      if (result.data.success) {
        toast.success(`הודעה נשלחה ל-${result.data.totalSent} אנשי צוות`);
      } else {
        toast.error(result.data.error || 'שגיאה בשליחת ההודעות');
      }
    } catch (error) {
      console.error("Failed to share team info:", error);
      toast.error('שגיאה בשליחת פרטים');
    } finally {
      setIsSharingTeam(false);
    }
  };

  const handleSyncToCalendar = async () => {
    setIsSyncingCalendar(true);
    try {
      await base44.functions.invoke('syncEventToCalendar', {
        eventId: event.id
      });
      toast.success('האירוע סונכרן ליומן בהצלחה עם שמות הצוות');
      if (onEventUpdated) onEventUpdated();
    } catch (error) {
      console.error("Failed to sync to calendar:", error);
      toast.error('שגיאה בסנכרון ליומן');
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="bg-gray-900 border-gray-800 text-white overflow-y-auto max-w-lg" dir="rtl">
        <SheetHeader>
          <SheetTitle className="text-white text-2xl">{event.coupleNames}</SheetTitle>
          <SheetClose />
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* סטטוס חוזה - בנר ירוק בולט */}
          {event.signedAt && (
            <div className="bg-green-500/10 border-2 border-green-500/30 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-400" />
              <div>
                <p className="text-green-400 font-bold text-sm">✅ החוזה חתום!</p>
                <p className="text-green-300 text-xs mt-1">הלקוח חתם את החוזה בהצלחה ותם סונכרן ליומן</p>
              </div>
            </div>
          )}

          {/* סטטוס חוזה ושאלון */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-400" />
                <span className="text-gray-400 text-sm">סטטוס חוזה</span>
              </div>
              <Badge className={`text-xs font-medium ${
                event.signedAt
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
              } border`}>
                {event.signedAt ? "✅ חתום" : "⏳ לא חתום"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-purple-400" />
                <span className="text-gray-400 text-sm">שאלון</span>
              </div>
              <Badge className={`text-xs font-medium ${
                event.productionFormFilledAt
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
              } border`}>
                {event.productionFormFilledAt ? "✅ מולא" : "⏳ לא מולא"}
              </Badge>
            </div>
          </div>

          {/* פרטים בסיסיים */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">פרטים בסיסיים</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">תאריך אירוע:</span>
                <span className="text-white font-medium">
                  {event.date ? format(new Date(event.date), "d/M/yyyy") : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">אולם:</span>
                <span className="text-white font-medium">{event.venue || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">סכום ברוטו:</span>
                <span className="text-yellow-400 font-semibold">₪{(event.totalAmountGross || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">רווח נקי:</span>
                <span className={`font-semibold ${(event.profitNet || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ₪{(event.profitNet || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* צוות הצילום + פרטי הפקה */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-gray-400 text-xs font-semibold uppercase">צוות הצילום</h3>
              <div className="flex gap-2">
                {!event.googleCalendarEventId && (
                  <Button
                    size="sm"
                    onClick={handleSyncToCalendar}
                    disabled={isSyncingCalendar}
                    className="text-xs bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 h-7"
                    title="צור אירוע ביומן גוגל"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${isSyncingCalendar ? 'animate-spin' : ''}`} />
                    {isSyncingCalendar ? 'יוצר...' : 'צור באירוע בקלנדר'}
                  </Button>
                )}
                {team.length > 0 && event.googleCalendarEventId && (
                  <>
                    <Button
                      size="sm"
                      onClick={handleSyncToCalendar}
                      disabled={isSyncingCalendar}
                      className="text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 h-7"
                      title="עדכן יומן עם שמות הצוות"
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${isSyncingCalendar ? 'animate-spin' : ''}`} />
                      {isSyncingCalendar ? 'מסנכרן...' : 'עדכן יומן'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleShareWithTeam}
                      disabled={isSharingTeam}
                      className="text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 h-7"
                    >
                      <Share2 className="w-3 h-3 mr-1" />
                      {isSharingTeam ? 'שולח...' : 'שתף עם צוות'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
              {team.length === 0 ? (
                <p className="text-gray-500 text-sm">טרם הוקצה צוות</p>
              ) : (
                team.map((member, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">{getRoleLabel(member.role)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{member.staffMemberName}</span>
                      <span className={`text-xs ${member.isPaid ? 'text-green-400' : 'text-yellow-400'}`}>
                        ₪{(member.cost || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div className="pt-2 border-t border-gray-700 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">סה"כ הוצאות צוות:</span>
                  <span className="text-white font-semibold">
                    ₪{team.reduce((sum, m) => sum + (m.cost || 0), 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* סטטוס הצוות */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">סטטוס הצוות</h3>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">כללי נדרש:</span>
                <span className="text-white font-medium">{requiredCrew}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">משובץ:</span>
                <span className={`font-medium ${isFullTeam ? 'text-green-400' : 'text-red-400'}`}>
                  {assignedTeam.length} {isFullTeam ? '✅' : `(חסר ${requiredCrew - assignedTeam.length})`}
                </span>
              </div>
              
              {/* Progress Bar */}
              <div className="pt-2 border-t border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-400 text-xs">התקדמות משלוחים:</p>
                  <span className="text-xs text-gray-300">
                    {team.length > 0 ? `${team.filter(m => m.progressStatus === 'sent').length}/${team.length}` : '—'}
                  </span>
                </div>
                {team.length > 0 ? (
                  <>
                    <div className="w-full bg-gray-700 rounded-full h-2 mb-3 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          team.filter(m => m.progressStatus === 'sent').length === team.length
                            ? 'bg-green-500'
                            : team.filter(m => m.progressStatus === 'sent').length > 0
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`}
                        style={{
                          width: `${team.length > 0 ? (team.filter(m => m.progressStatus === 'sent').length / team.length) * 100 : 0}%`
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      {team.map((member, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-gray-700/50 transition-colors">
                          <span className="text-gray-300">{member.staffMemberName}</span>
                          <Badge 
                            className={`text-xs cursor-pointer transition-all hover:opacity-80 ${
                              member.progressStatus === 'sent' 
                                ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                                : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                            } border`}
                          >
                            {member.progressStatus === 'sent' ? '✅ נשלח' : '⏳ ממתין'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 text-xs">—</p>
                )}
              </div>
            </div>
          </div>

          {/* היסטוריית חשבוניות */}
          {event.invoicesList && event.invoicesList.length > 0 && (
            <div>
              <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">היסטוריית חשבוניות</h3>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg space-y-2 p-3">
                {event.invoicesList.map((invoice, idx) => (
                  <div key={idx} className="text-sm border-b border-gray-700 pb-2 last:border-b-0 last:pb-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-300 font-medium">#{invoice.number}</span>
                      <span className="text-yellow-400 font-semibold">₪{invoice.amount?.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {invoice.date ? format(new Date(invoice.date), "d/M/yyyy") : "—"}
                    </div>
                    {invoice.description && (
                      <div className="text-xs text-gray-400 mt-1">{invoice.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* סיכום כלכלי */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              סיכום כלכלי
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">סכום ברוטו:</span>
                <span className="text-white font-semibold">₪{(event.totalAmountGross || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">מע"מ ({event.vatPercent || 18}%):</span>
                <span className="text-white font-semibold">₪{(event.vatAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-700">
                <span className="text-gray-400">עלויות צוות:</span>
                <span className="text-red-400 font-semibold">₪{(event.totalExpenses || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-700">
                <span className="text-white font-semibold">רווח נקי:</span>
                <span className={`font-bold text-lg ${(event.profitNet || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ₪{(event.profitNet || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* הערות */}
          {event.notes && (
            <div>
              <h3 className="text-gray-400 text-xs font-semibold uppercase mb-2">הערות</h3>
              <p className="text-sm text-gray-300 bg-gray-800/50 border border-gray-700 rounded p-3">
                {event.notes}
              </p>
            </div>
          )}
          </div>
      </SheetContent>
    </Sheet>
  );
}