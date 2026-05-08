import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { Trash2, Loader2, Plus } from "lucide-react";

import { usePurchases, useCreatePurchase, useDeletePurchase } from "@/hooks/use-finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const purchaseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  date: z.string().optional(),
});

type PurchaseFormValues = z.infer<typeof purchaseSchema>;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export default function Purchases() {
  const { data: purchases, isLoading } = usePurchases();
  const createPurchase = useCreatePurchase();
  const deletePurchase = useDeletePurchase();
  const { toast } = useToast();

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      description: "",
      amount: undefined as any,
      date: format(new Date(), "yyyy-MM-dd"),
    },
  });

  const onSubmit = (data: PurchaseFormValues) => {
    createPurchase.mutate(data, {
      onSuccess: () => {
        form.reset({ description: "", amount: undefined as any, date: format(new Date(), "yyyy-MM-dd") });
        toast({
          title: "Purchase added",
          description: "Your inventory purchase has been logged.",
        });
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Error",
          description: err.message,
        });
      },
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("Are you sure you want to delete this purchase?")) return;
    deletePurchase.mutate(id, {
      onSuccess: () => {
        toast({
          title: "Purchase deleted",
        });
      },
    });
  };

  const runningTotal = purchases?.reduce((sum, p) => sum + p.amount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Purchases</h2>
        <p className="text-muted-foreground mt-1">Log supplies, inventory, and other expenses.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-lg">Add Purchase</CardTitle>
            <CardDescription>Record a new expense</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  {...form.register("date")}
                  data-testid="input-purchase-date"
                />
                {form.formState.errors.date && (
                  <p className="text-sm text-destructive">{form.formState.errors.date.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="e.g. MH3 Booster Boxes"
                  {...form.register("description")}
                  data-testid="input-purchase-desc"
                />
                {form.formState.errors.description && (
                  <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount ($)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...form.register("amount")}
                  data-testid="input-purchase-amount"
                />
                {form.formState.errors.amount && (
                  <p className="text-sm text-destructive">{form.formState.errors.amount.message}</p>
                )}
              </div>
              <Button 
                type="submit" 
                className="w-full" 
                disabled={createPurchase.isPending}
                data-testid="button-add-purchase"
              >
                {createPurchase.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Expense
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">History</CardTitle>
            <div className="text-sm font-medium">
              Total: <span className="font-mono text-primary font-bold">{formatCurrency(runningTotal)}</span>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !purchases || purchases.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground bg-muted/30 rounded-md border border-dashed">
                No purchases recorded yet.
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-[120px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map((purchase) => (
                      <TableRow key={purchase.id} data-testid={`row-purchase-${purchase.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {format(new Date(purchase.date), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="font-medium">{purchase.description}</TableCell>
                        <TableCell className="text-right font-mono text-destructive">
                          -{formatCurrency(purchase.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(purchase.id)}
                            data-testid={`button-delete-purchase-${purchase.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
