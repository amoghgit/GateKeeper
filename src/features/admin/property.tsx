"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Building2, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { apartmentSchema, type ApartmentInput } from "@/shared/schemas";
import type { Apartment, Building } from "@/shared/types";
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { Badge, Card, Field, Input, NativeSelect, Skeleton, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { api, applyFieldErrors, errorMessage } from "@/lib/api-client";
import { useAction } from "@/lib/hooks";

const INVALIDATE = [["buildings"], ["apartments"]];

const buildingForm = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  floors: z.coerce.number<string | number>().int().min(1, "At least 1 floor").max(200),
  blocks: z.string().max(400),
});
type BuildingFormValues = z.infer<typeof buildingForm>;

function useBuildings() {
  return useQuery({ queryKey: ["buildings"], queryFn: () => api.get<Building[]>("/admin/buildings") });
}
function useApartments() {
  return useQuery({ queryKey: ["apartments", "admin"], queryFn: () => api.get<Apartment[]>("/admin/apartments") });
}

function ConfirmDelete({
  label,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  label: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>This can&apos;t be undone. The action is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            <Trash2 /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BuildingDialog({ building, open, onOpenChange }: { building: Building | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<z.input<typeof buildingForm>, unknown, BuildingFormValues>({
    resolver: zodResolver(buildingForm),
    values: { name: building?.name ?? "", floors: building?.floors ?? 10, blocks: building?.blocks.join(", ") ?? "" },
  });
  const e = form.formState.errors;
  const save = useAction(
    (v: BuildingFormValues) => {
      const body = {
        name: v.name,
        floors: v.floors,
        blocks: v.blocks
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean),
      };
      return building ? api.patch<Building>(`/admin/buildings/${building.buildingId}`, body) : api.post<Building>("/admin/buildings", body);
    },
    { success: building ? "Building updated" : "Building added", invalidate: INVALIDATE, silentError: true },
  );
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v);
      onOpenChange(false);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) form.setError("root", { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate aria-label="Building">
          <DialogHeader>
            <DialogTitle>{building ? "Edit building" : "Add a building"}</DialogTitle>
            <DialogDescription>Blocks (wings) are optional and used to group apartments.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Building name" htmlFor="b-name" error={e.name?.message}>
                <Input id="b-name" placeholder="Tower C" aria-invalid={!!e.name} {...form.register("name")} />
              </Field>
              <Field label="Floors" htmlFor="b-floors" error={e.floors?.message}>
                <Input id="b-floors" type="number" min={1} aria-invalid={!!e.floors} {...form.register("floors")} />
              </Field>
            </div>
            <Field label="Blocks" htmlFor="b-blocks" optional hint="Comma-separated, e.g. North Wing, South Wing">
              <Input id="b-blocks" {...form.register("blocks")} />
            </Field>
            {e.root?.message && <p className="text-danger text-sm">{e.root.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save building
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BuildingsPage() {
  const buildings = useBuildings();
  const apartments = useApartments();
  const [editing, setEditing] = useState<Building | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Building | null>(null);
  const remove = useAction((id: string) => api.delete(`/admin/buildings/${id}`), {
    success: "Building deleted",
    invalidate: INVALIDATE,
    onSuccess: () => setDeleting(null),
  });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apartments.data ?? []) m.set(a.buildingId, (m.get(a.buildingId) ?? 0) + 1);
    return m;
  }, [apartments.data]);

  return (
    <>
      <PageHeader
        title="Buildings"
        description="Towers, blocks and floors in your community."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Add building
          </Button>
        }
      />
      {buildings.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : buildings.isError ? (
        <ErrorState error={buildings.error} onRetry={() => buildings.refetch()} />
      ) : buildings.data!.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No buildings yet" description="Add your first tower or block to start creating apartments." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {buildings.data!.map((b) => (
            <Card key={b.buildingId} className="flex flex-col p-5">
              <div className="flex items-start justify-between">
                <span className="bg-primary-softer text-primary flex size-10 items-center justify-center rounded-xl">
                  <Building2 className="size-5" />
                </span>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${b.name}`}
                    onClick={() => {
                      setEditing(b);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => setDeleting(b)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <h2 className="mt-4 text-base font-semibold">{b.name}</h2>
              <p className="text-muted-foreground text-[13px]">
                {b.floors} floors · {counts.get(b.buildingId) ?? 0} apartments
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {b.blocks.length ? (
                  b.blocks.map((bl) => (
                    <Badge key={bl} tone="outline">
                      {bl}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground text-xs">No blocks</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <BuildingDialog key={editing?.buildingId ?? "new"} building={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDelete
        label={deleting?.name ?? "building"}
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.buildingId)}
        loading={remove.isPending}
      />
    </>
  );
}

function ApartmentDialog({ open, onOpenChange, buildings }: { open: boolean; onOpenChange: (o: boolean) => void; buildings: Building[] }) {
  const form = useForm<z.input<typeof apartmentSchema>, unknown, ApartmentInput>({
    resolver: zodResolver(apartmentSchema),
    defaultValues: { buildingId: "", block: "", floor: 1, unitNumber: "" },
  });
  const e = form.formState.errors;
  const buildingId = useWatch({ control: form.control, name: "buildingId" });
  const building = buildings.find((b) => b.buildingId === buildingId);
  const create = useAction((v: ApartmentInput) => api.post<Apartment>("/admin/apartments", v), {
    success: (a) => `Apartment ${a.unitNumber} added`,
    invalidate: INVALIDATE,
    silentError: true,
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await create.mutateAsync(v);
      form.reset();
      onOpenChange(false);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) form.setError("root", { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate aria-label="Add apartment">
          <DialogHeader>
            <DialogTitle>Add an apartment</DialogTitle>
            <DialogDescription>Unit numbers must be unique within a building.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Building" htmlFor="a-building" error={e.buildingId?.message}>
              <NativeSelect id="a-building" aria-invalid={!!e.buildingId} {...form.register("buildingId")}>
                <option value="">Select building…</option>
                {buildings.map((b) => (
                  <option key={b.buildingId} value={b.buildingId}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Unit number" htmlFor="a-unit" error={e.unitNumber?.message}>
                <Input id="a-unit" className="uppercase" placeholder="C-0401" aria-invalid={!!e.unitNumber} {...form.register("unitNumber")} />
              </Field>
              <Field label="Floor" htmlFor="a-floor" error={e.floor?.message}>
                <Input id="a-floor" type="number" min={0} max={building?.floors} aria-invalid={!!e.floor} {...form.register("floor")} />
              </Field>
              <Field label="Block" htmlFor="a-block" error={e.block?.message} optional>
                <NativeSelect id="a-block" disabled={!building?.blocks.length} {...form.register("block")}>
                  <option value="">—</option>
                  {building?.blocks.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {e.root?.message && <p className="text-danger text-sm">{e.root.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Add apartment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ApartmentsPage() {
  const buildings = useBuildings();
  const apartments = useApartments();
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Apartment | null>(null);
  const remove = useAction((id: string) => api.delete(`/admin/apartments/${id}`), {
    success: "Apartment deleted",
    invalidate: INVALIDATE,
    onSuccess: () => setDeleting(null),
  });
  const rows = (apartments.data ?? []).filter((a) => !filter || a.buildingId === filter);
  return (
    <>
      <PageHeader
        title="Apartments"
        description="Every unit residents can be assigned to."
        actions={
          <Button onClick={() => setAdding(true)} disabled={!buildings.data?.length}>
            <Plus /> Add apartment
          </Button>
        }
      />
      <Card>
        <div className="border-border flex items-center justify-between gap-3 border-b p-4">
          <NativeSelect aria-label="Filter by building" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56">
            <option value="">All buildings</option>
            {buildings.data?.map((b) => (
              <option key={b.buildingId} value={b.buildingId}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
          <span className="text-muted-foreground text-xs">{rows.length} units</span>
        </div>
        {apartments.isLoading ? (
          <TableSkeleton />
        ) : apartments.isError ? (
          <ErrorState error={apartments.error} onRetry={() => apartments.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Layers} title="No apartments" description="Add units so residents can be assigned to them." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Unit</TH>
                <TH>Building</TH>
                <TH>Block</TH>
                <TH>Floor</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.apartmentId}>
                  <TD className="text-foreground font-mono font-medium">{a.unitNumber}</TD>
                  <TD>{a.buildingName}</TD>
                  <TD>{a.block ?? "—"}</TD>
                  <TD className="tabular-nums">{a.floor === 0 ? "Ground" : a.floor}</TD>
                  <TD className="text-right">
                    <Button size="icon" variant="ghost" aria-label={`Delete ${a.unitNumber}`} onClick={() => setDeleting(a)}>
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <ApartmentDialog open={adding} onOpenChange={setAdding} buildings={buildings.data ?? []} />
      <ConfirmDelete
        label={deleting ? `unit ${deleting.unitNumber}` : "apartment"}
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.apartmentId)}
        loading={remove.isPending}
      />
    </>
  );
}
