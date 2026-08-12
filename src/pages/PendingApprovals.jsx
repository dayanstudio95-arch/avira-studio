import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function PendingApprovals() {
  const [records, setRecords] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const all = await base44.entities.PendingAutomation.list();
      const pending = all.filter(r => r.status === 'pending');
      setRecords(pending.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    } catch (err) {
      toast.error('שגיאה בטעינת ההודעות');
      console.error(err);
    }
    setLoading(false);
  };

  const handleApprove = async (recordId) => {
    setActionLoading(recordId);
    try {
      const res = await base44.functions.invoke('approvePendingAutomation', {
        pending_id: recordId,
        action: 'approve'
      });
      
      if (res.data?.success) {
        toast.success(`אושרו ${res.data.sent} הודעות בהצלחה`);
        setRecords(r => r.filter(rec => rec.id !== recordId));
      } else {
        toast.error('שגיאה בעיבוד האישור');
      }
    } catch (err) {
      toast.error('שגיאה: ' + err.message);
    }
    setActionLoading(null);
  };

  const handleReject = async (recordId) => {
    setActionLoading(recordId);
    try {
      const res = await base44.functions.invoke('approvePendingAutomation', {
        pending_id: recordId,
        action: 'reject'
      });
      
      if (res.data?.success) {
        toast.success('ההודעות נדחו');
        setRecords(r => r.filter(rec => rec.id !== recordId));
      } else {
        toast.error('שגיאה בדחיית ההודעות');
      }
    } catch (err) {
      toast.error('שגיאה: ' + err.message);
    }
    setActionLoading(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6" dir="rtl">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">🔔 אישור הודעות ממתינות</h1>
          <p className="text-gray-400">סקור ואשר הודעות רגישות לפני שליחה לקוחות</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          </div>
        ) : records.length === 0 ? (
          <Card className="bg-gray-900 border-gray-700 p-8 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-xl font-semibold text-white mb-2">אין הודעות ממתינות</h3>
            <p className="text-gray-400">כל ההודעות הרגישות כבר אושרו או דוחו</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {records.map(record => {
              const messages = JSON.parse(record.messages || '[]');
              const isExpanded = expandedId === record.id;
              
              return (
                <Card
                  key={record.id}
                  className="bg-gray-900 border-gray-700 overflow-hidden hover:border-indigo-700/50 transition-all"
                >
                  {/* Card Header - Click to expand */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : record.id)}
                    className="w-full p-5 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1 text-right">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-white">{record.automationName}</h3>
                        <div className="flex items-center gap-3 mt-2 text-sm text-gray-400">
                          <span>📅 {format(new Date(record.created_date), 'dd/MM/yyyy HH:mm')}</span>
                          <span>📨 {record.totalCount} הודעות</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-indigo-400">{record.totalCount}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Expandable Content */}
                  {isExpanded && (
                    <div className="border-t border-gray-700 bg-gray-800/30 p-5 space-y-4 max-h-96 overflow-y-auto">
                      <div className="space-y-3">
                        {messages.map((msg, idx) => (
                          <div
                            key={idx}
                            className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-indigo-300">
                                {msg.coupleNames || msg.leadId || 'Unknown'}
                              </span>
                              <span className="text-sm text-gray-500">{msg.phoneNumber}</span>
                            </div>
                            
                            {msg.eventDate && (
                              <div className="text-xs text-gray-500">
                                📅 {msg.eventDate}
                                {msg.venueName && ` • ${msg.venueName}`}
                              </div>
                            )}
                            
                            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-gray-800/60 p-3 rounded border border-gray-700 max-h-24 overflow-y-auto">
                              {msg.messageText}
                            </pre>
                          </div>
                        ))}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-3 pt-4 border-t border-gray-700">
                        <Button
                          onClick={() => handleApprove(record.id)}
                          disabled={actionLoading === record.id}
                          className="flex-1 bg-green-700 hover:bg-green-600 text-white font-semibold gap-2"
                        >
                          {actionLoading === record.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                          אשר ושלח
                        </Button>
                        <Button
                          onClick={() => handleReject(record.id)}
                          disabled={actionLoading === record.id}
                          variant="destructive"
                          className="flex-1 bg-red-700 hover:bg-red-600 text-white font-semibold gap-2"
                        >
                          {actionLoading === record.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                          דחה
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}