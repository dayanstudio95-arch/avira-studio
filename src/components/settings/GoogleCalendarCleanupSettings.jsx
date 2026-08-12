import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Calendar } from 'lucide-react';
import { toast } from 'sonner';

export default function GoogleCalendarCleanupSettings() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [isLoading, setIsLoading] = useState(false);

  const handleCleanup = async () => {
    if (!year || year < 2000 || year > 2100) {
      toast.error('בחר שנה תקינה (2000-2100)');
      return;
    }

    try {
      setIsLoading(true);
      const res = await base44.functions.invoke('cleanupGoogleCalendarOnlyDuplicates', { year });
      const { message, deletedCount, duplicateGroupsFound } = res.data || {};
      toast.success(`${message}\n✅ נמחקו ${deletedCount} אירועים מ-${duplicateGroupsFound} קבוצות כפילויות`);
    } catch (error) {
      toast.error('שגיאה בניקוי: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <Calendar className="w-5 h-5 text-yellow-400" />
          ניקוי כפילויות ביומן גוגל
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <p className="text-gray-400 text-sm">
          זה ינקה אירועים כפולים (אותו שם ותאריך) מיומן הגוגל שלך. שם האירוע וולא השעה מופיעה בהשוואה.
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="year" className="text-gray-300 font-medium">
              בחר שנה:
            </Label>
            <Input
              id="year"
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
              className="bg-gray-800 border-gray-700 text-white focus:border-yellow-400 focus:ring-yellow-400/20"
              disabled={isLoading}
            />
          </div>

          <Button
            onClick={handleCleanup}
            disabled={isLoading}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'מנקה...' : `הפעל ניקוי לשנת ${year}`}
          </Button>
        </div>

        <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3">
          <p className="text-yellow-300 text-xs">
            ⚠️ <strong>זהירות:</strong> פעולה זו תמחוק אירועים מיומן הגוגל ואינה ניתנת לביטול.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}