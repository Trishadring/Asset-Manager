import { useState } from "react";
import { format } from "date-fns";
import { PlusCircle, Trash2, HandCoins } from "lucide-react";
import { useCustomSales, useCreateCustomSale, useDeleteCustomSale } from "@/hooks/use-finance";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export default function Sales() {
  const { data: sales, isLoading } = useCustomSales();
  const createSale = useCreateCustomSale();
  const deleteSale = useDeleteCustomSale();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const totalRevenue = (sales ?? []).reduce((sum, s) => sum + s.amount, 0);

  const handleSubmit = () => {
    const parsed = parseFloat(amount);
    if (!description.trim() || isNaN(parsed) || parsed <= 0) {
      toast({ variant: "destructive", title: "Please fill in a description and a valid amount." });
      return;
    }
    createSale.mutate(
      { description: description.trim(), amount: parsed, date, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: "Sale recorded", description: `${description} — ${formatCurrency(parsed)}` });
          setDescription("");
          setAmount("");
          setDate(new Date().toISOString().slice(0, 10));
          setNotes("");
          setOpen(false);
        },
        onError: (err) => toast({ variant: "destructive", title: "Failed to save", description: err.message }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Manual Sales</h2>
          <p className="text-muted-foreground mt-1">Log sales to friends, local trades, or anything off-platform.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-sale">
              <PlusCircle className="mr-2 h-4 w-4" /> Record sale
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record a sale</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="sale-desc">Who / what</Label>
                <Input
                  id="sale-desc"
                  placeholder="e.g. sold Black Lotus to friend"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-sale-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sale-amount">Amount ($)</Label>
                  <Input
                    id="sale-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    data-testid="input-sale-amount"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sale-date">Date</Label>
                  <Input
                    id="sale-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    data-testid="input-sale-date"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sale-notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  id="sale-notes"
                  placeholder="e.g. cash, paid via Venmo, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSubmit} disabled={createSale.isPending} data-testid="button-save-sale">
                {createSale.isPending ? "Saving…" : "Save sale"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!isLoading && sales && sales.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <HandCoins className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono">{formatCurrency(totalRevenue)}</p>
                <p className="text-xs text-muted-foreground">{sales.length} manual sale{sales.length !== 1 ? "s" : ""} recorded</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sale history</CardTitle>
          <CardDescription>These are counted as revenue in your dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !sales || sales.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <HandCoins className="h-10 w-10 mx-auto mb-4 opacity-30" />
              <h3 className="font-medium text-foreground">No sales yet</h3>
              <p className="text-sm mt-1">Hit "Record sale" to log your first manual sale.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(sale.date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="font-medium">{sale.description}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{sale.notes ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-primary">
                        {formatCurrency(sale.amount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            deleteSale.mutate(sale.id, {
                              onError: (err) => toast({ variant: "destructive", title: "Failed to delete", description: err.message }),
                            })
                          }
                          data-testid={`button-delete-sale-${sale.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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
  );
}
