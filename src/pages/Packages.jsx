import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Package, Plus, Edit, Trash2, Camera, Video, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function Packages() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: 0,
    photographers: 1,
    videographers: 1,
  });

  const queryClient = useQueryClient();

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["packages"],
    queryFn: () => base44.entities.Package.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => {
      const totalCrewCount = (data.photographers || 0) + (data.videographers || 0);
      return base44.entities.Package.create({ ...data, totalCrewCount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packages"] });
      handleCloseDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const totalCrewCount = (data.photographers || 0) + (data.videographers || 0);
      return base44.entities.Package.update(id, { ...data, totalCrewCount });
    },
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
        description: pkg.description || "",
        price: pkg.price,
        photographers: pkg.photographers || 1,
        videographers: pkg.videographers || 1,
      });
    } else {
      setEditingPackage(null);
      setFormData({
        name: "",
        description: "",
        price: 0,
        photographers: 1,
        videographers: 1,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingPackage(null);
    setFormData({
      name: "",
      description: "",
      price: 0,
      photographers: 1,
      videographers: 1,
    });
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
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-12 bg-gray-800 rounded-lg w-64"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-64 bg-gray-800 rounded-xl"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
              <Package className="w-8 h-8 text-yellow-400" />
              חבילות
            </h1>
            <p className="text-gray-400">ניהול חבילות צילום ווידאו</p>
          </div>
          <Button
            onClick={() => handleOpenDialog()}
            className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
          >
            <Plus className="w-5 h-5 mr-2" />
            חבילה חדשה
          </Button>
        </div>

        {packages.length === 0 ? (
          <Card className="bg-gray-900/50 border-gray-800 text-center p-12">
            <Package className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">אין חבילות</h3>
            <p className="text-gray-400 mb-6">צור את החבילה הראשונה שלך</p>
            <Button
              onClick={() => handleOpenDialog()}
              className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
            >
              <Plus className="w-5 h-5 mr-2" />
              צור חבילה
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packages.map((pkg) => (
              <Card
                key={pkg.id}
                className="bg-gray-900/50 border-gray-800 backdrop-blur-sm hover:border-yellow-400/30 transition-all duration-300"
              >
                <CardHeader className="border-b border-gray-800">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-white text-xl">{pkg.name}</CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDialog(pkg)}
                        className="text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(pkg.id)}
                        className="text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  {pkg.description && (
                    <p className="text-gray-400 text-sm">{pkg.description}</p>
                  )}
                  
                  <div className="pt-4 border-t border-gray-800">
                    <div className="text-3xl font-bold text-yellow-400 mb-4">
                      ₪{pkg.price?.toLocaleString()}
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-gray-300">
                          <Camera className="w-4 h-4 text-blue-400" />
                          <span className="text-sm">צלמים</span>
                        </div>
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                          {pkg.photographers || 0}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-gray-300">
                          <Video className="w-4 h-4 text-purple-400" />
                          <span className="text-sm">צלמי וידאו</span>
                        </div>
                        <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                          {pkg.videographers || 0}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                        <div className="flex items-center gap-2 text-gray-300">
                          <Users className="w-4 h-4 text-yellow-400" />
                          <span className="text-sm font-semibold">סה״כ צוות</span>
                        </div>
                        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 font-bold">
                          {pkg.totalCrewCount || 0}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
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
                <label className="text-sm text-gray-400 mb-2 block">תיאור</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="תיאור החבילה..."
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
              
              <div>
                <label className="text-sm text-gray-400 mb-2 block">מחיר</label>
                <Input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                  placeholder="0"
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400 mb-2 block flex items-center gap-2">
                    <Camera className="w-4 h-4 text-blue-400" />
                    צלמים
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.photographers}
                    onChange={(e) => setFormData({ ...formData, photographers: Number(e.target.value) })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
                
                <div>
                  <label className="text-sm text-gray-400 mb-2 block flex items-center gap-2">
                    <Video className="w-4 h-4 text-purple-400" />
                    צלמי וידאו
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.videographers}
                    onChange={(e) => setFormData({ ...formData, videographers: Number(e.target.value) })}
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                </div>
              </div>
              
              <div className="bg-gray-800/50 p-3 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">סה״כ אנשי צוות:</span>
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    {(formData.photographers || 0) + (formData.videographers || 0)}
                  </Badge>
                </div>
              </div>
            </div>
            
            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleCloseDialog}
                className="border-gray-700 text-gray-300 hover:bg-gray-800"
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
      </div>
    </div>
  );
}