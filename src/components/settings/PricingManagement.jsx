import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Plus, Package, DollarSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function PricingManagement() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    price: 0,
    description: "",
  });

  const queryClient = useQueryClient();

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["packages"],
    queryFn: () => base44.entities.Package.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.Package.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packages"] });
      handleCloseDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) =>
      base44.entities.Package.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packages"] });
      handleCloseDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Package.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
  });

  const handleOpenDialog = (pkg = null) => {
    if (pkg) {
      setEditingPackage(pkg);
      setFormData({
        name: pkg.name,
        price: pkg.price,
        description: pkg.description || "",
      });
    } else {
      setEditingPackage(null);
      setFormData({ name: "", price: 0, description: "" });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingPackage(null);
    setFormData({ name: "", price: 0, description: "" });
  };

  const handleSubmit = () => {
    if (!formData.name || formData.price <= 0) return;

    if (editingPackage) {
      updateMutation.mutate({ id: editingPackage.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm("האם אתה בטוח שברצונך למחוק חבילה זו?")) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-yellow-400" />
            ניהול חבילות ומחירים
          </CardTitle>
          <Button
            onClick={() => handleOpenDialog()}
            className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-sm"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            חבילה חדשה
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {packages.length === 0 ? (
          <p className="text-gray-400 text-center py-8">אין חבילות</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700 hover:bg-transparent">
                  <TableHead className="text-gray-400 text-right">שם חבילה</TableHead>
                  <TableHead className="text-gray-400 text-right">מחיר (₪)</TableHead>
                  <TableHead className="text-gray-400 text-right">תיאור</TableHead>
                  <TableHead className="text-gray-400 text-center">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow key={pkg.id} className="border-gray-700 hover:bg-gray-800/50">
                    <TableCell className="text-white font-medium">{pkg.name}</TableCell>
                    <TableCell className="text-yellow-400 font-semibold">
                      ₪{pkg.price?.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm">
                      {pkg.description ? (
                        <span title={pkg.description} className="truncate block max-w-xs">
                          {pkg.description}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(pkg)}
                          className="text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 h-8 w-8"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(pkg.id)}
                          className="text-gray-400 hover:text-red-400 hover:bg-red-500/10 h-8 w-8"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white">
            <DialogHeader>
              <DialogTitle>
                {editingPackage ? "ערוך חבילה" : "חבילה חדשה"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-2 block">שם החבילה</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="למשל: חבילה בסיסית"
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-2 block flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-yellow-400" />
                  מחיר (₪)
                </label>
                <Input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                  placeholder="0"
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-gray-400 mb-2 block">תיאור (אופציונלי)</label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="תיאור החבילה..."
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleCloseDialog}
                className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              >
                ביטול
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!formData.name || formData.price <= 0}
                className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
              >
                {editingPackage ? "עדכן" : "צור"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}