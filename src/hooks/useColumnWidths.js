import { useState, useEffect } from 'react';

const STORAGE_KEY = 'events_table_column_widths';

const DEFAULT_WIDTHS = {
  checkbox: 28,
  id: 28,
  date: 64,
  couple: 96,
  venue: 72,
  photo1: 72,
  photo2: 72,
  video1: 72,
  video2: 72,
  editor: 72,
  teamStatus: 60,
  gross: 68,
  net: 68,
  payment: 74,
  progress: 60,
  album: 60,
};

export function useColumnWidths() {
  const [widths, setWidths] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_WIDTHS, ...JSON.parse(stored) } : DEFAULT_WIDTHS;
    } catch {
      return DEFAULT_WIDTHS;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }, [widths]);

  const setWidth = (column, newWidth) => {
    setWidths(prev => ({ ...prev, [column]: Math.max(30, newWidth) }));
  };

  const resetWidths = () => {
    setWidths(DEFAULT_WIDTHS);
    localStorage.removeItem(STORAGE_KEY);
  };

  return { widths, setWidth, resetWidths };
}