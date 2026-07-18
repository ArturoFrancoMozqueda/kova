import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { CalendarDays, Pencil, Plus, ReceiptText, Trash2, WalletCards } from "lucide-react";

import { useFeature } from "@/auth/useFeature";
import { EXPENSES_MANAGE_PERMISSION, usePermission } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ViewEmpty, ViewError, ViewPermissionDenied } from "@/components/ui/view-states";
import { ViewHeader } from "@/components/ui/view-header";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "./api";
import type { Expense, ExpenseCategory, ExpensePayload } from "./types";

function dateInputValue(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStart(): string {
  const value = new Date();
  value.setDate(1);
  return dateInputValue(value);
}

export default function ExpensesView() {
  useDocumentTitle(copy.expenses.title);
  const enabled = useFeature("margin_reports");
  const canManage = usePermission(EXPENSES_MANAGE_PERMISSION);
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(dateInputValue);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<Expense | null | "new">(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setExpenses(await listExpenses(startDate, endDate));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate]);

  useEffect(() => {
    if (enabled && canManage) void load();
  }, [canManage, enabled, load]);

  const total = useMemo(
    () => expenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
    [expenses],
  );

  if (!enabled) return <Navigate to="/reports" replace />;
  if (!canManage) {
    return <ViewPermissionDenied title={copy.expenses.deniedTitle} description={copy.expenses.deniedBody} />;
  }

  const save = async (payload: ExpensePayload) => {
    setBusy(true);
    try {
      if (editing === "new") await createExpense(payload);
      else if (editing) await updateExpense(editing.id, payload);
      toast(editing === "new" ? copy.expenses.created : copy.expenses.updated, "success");
      setEditing(null);
      await load();
    } catch {
      toast(copy.expenses.saveError, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteExpense(deleting.id);
      toast(copy.expenses.deleted, "success");
      setDeleting(null);
      await load();
    } catch {
      toast(copy.expenses.deleteError, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <ViewHeader
        eyebrow={copy.expenses.eyebrow}
        title={copy.expenses.title}
        actions={<Button onClick={() => setEditing("new")}><Plus className="mr-2 h-4 w-4" />{copy.expenses.add}</Button>}
        meta={copy.expenses.meta}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2"><Label htmlFor="expense-start">{copy.expenses.startDate}</Label><Input id="expense-start" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="expense-end">{copy.expenses.endDate}</Label><Input id="expense-end" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></div>
        <Button variant="outline" onClick={() => void load()}>{copy.expenses.apply}</Button>
      </div>

      <Card className="overflow-hidden border-kova-blue/20 bg-kova-blue/[0.03]">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-kova-md bg-kova-blue/10 text-kova-blue"><WalletCards className="h-5 w-5" /></div>
          <div><p className="text-xs font-medium uppercase tracking-wide text-kova-tertiary">{copy.expenses.periodTotal}</p><p className="text-2xl font-bold tabular-nums text-kova-ink">{formatMoney(total)}</p><p className="text-xs text-kova-muted">{copy.expenses.records(expenses.length)}</p></div>
        </CardContent>
      </Card>

      {loading ? <ExpenseSkeleton /> : error ? <ViewError message={copy.expenses.loadError} onRetry={() => void load()} retryLabel={copy.expenses.retry} /> : expenses.length === 0 ? (
        <ViewEmpty icon={<ReceiptText className="h-6 w-6" />} title={copy.expenses.emptyTitle} body={copy.expenses.emptyBody} primaryCta={{ label: copy.expenses.add, onClick: () => setEditing("new") }} />
      ) : (
        <div className="divide-y divide-kova-border rounded-kova-lg border-[0.5px] border-kova-border bg-white shadow-kova-card">
          {expenses.map((expense) => (
            <article key={expense.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-kova-md bg-kova-surface text-kova-blue"><CalendarDays className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><p className="font-semibold text-kova-ink">{copy.expenses.categories[expense.category]}</p><p className="text-sm text-kova-muted">{expense.expense_date}{expense.note ? ` · ${expense.note}` : ""}</p></div>
              <p className="text-lg font-bold tabular-nums text-kova-ink">{formatMoney(expense.amount)}</p>
              <div className="flex gap-1 self-end sm:self-auto"><Button variant="ghost" size="icon" aria-label={copy.expenses.edit} onClick={() => setEditing(expense)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={copy.expenses.delete} onClick={() => setDeleting(expense)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>
            </article>
          ))}
        </div>
      )}

      {editing ? <ExpenseDialog expense={editing === "new" ? null : editing} busy={busy} onCancel={() => setEditing(null)} onSave={save} /> : null}
      <ConfirmDialog open={deleting !== null} title={copy.expenses.deleteTitle} description={copy.expenses.deleteBody} confirmLabel={copy.expenses.deleteConfirm} busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
    </main>
  );
}

function ExpenseDialog({ expense, busy, onCancel, onSave }: { expense: Expense | null; busy: boolean; onCancel: () => void; onSave: (payload: ExpensePayload) => Promise<void> }) {
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "servicios");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? dateInputValue());
  const [note, setNote] = useState(expense?.note ?? "");
  const valid = Number(amount) > 0 && expenseDate !== "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    void onSave({ category, amount, expense_date: expenseDate, note: note.trim() || null });
  };
  return (
    <Dialog open onClose={busy ? () => {} : onCancel}>
      <form onSubmit={submit}>
        <DialogHeader><DialogTitle>{expense ? copy.expenses.editTitle : copy.expenses.createTitle}</DialogTitle><DialogDescription>{copy.expenses.formBody}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="expense-category">{copy.expenses.category}</Label><Select id="expense-category" value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>{Object.entries(copy.expenses.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
          <div className="space-y-2"><Label htmlFor="expense-amount">{copy.expenses.amount}</Label><Input id="expense-amount" type="number" min="0.01" step="0.01" data-money value={amount} onChange={(event) => setAmount(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="expense-date">{copy.expenses.date}</Label><Input id="expense-date" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="expense-note">{copy.expenses.note}</Label><Input id="expense-note" maxLength={500} value={note} placeholder={copy.expenses.notePlaceholder} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{copy.expenses.cancel}</Button><Button type="submit" disabled={busy || !valid}>{busy ? copy.expenses.saving : copy.expenses.save}</Button></DialogFooter>
      </form>
    </Dialog>
  );
}

function ExpenseSkeleton() {
  return <div className="space-y-2" aria-label={copy.expenses.loading}>{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-kova-lg bg-kova-surface" />)}</div>;
}
