"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type WmsOrder = {
  order_sn: string;
  wms_status: string;
  marketplace_status: string | null;
  shipping_status: string | null;
  tracking_number: string | null;
  updated_at: string;
};

type WmsOrderListResponse = {
  message?: string | string[];
  orders?: WmsOrder[];
  pagination?: {
    page?: number;
    page_size?: number;
    total?: number;
    total_pages?: number;
  };
};

type WmsOrdersPage = {
  orders: WmsOrder[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

type WmsOrderItem = {
  sku: string;
  quantity: number;
  price: number;
};

type WmsOrderDetail = {
  order_sn: string;
  marketplace_status: string | null;
  shipping_status: string | null;
  wms_status: string;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
  items: WmsOrderItem[];
};

type WmsOrderDetailResponse = {
  message?: string | string[];
  order?: WmsOrderDetail | null;
};

type WmsAction = "pick" | "pack" | "ship";

type WmsActionConfig = {
  action: WmsAction;
  label: string;
  disabled: boolean;
};

type WmsActionPayload = {
  message?: string | string[];
};

type WmsDetailSyncPayload = {
  message?: string | string[];
};

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

type StatusFilterOption = {
  value: string;
  label: string;
};

type OrdersFilters = {
  marketplace_status: string[];
  shipping_status: string[];
  wms_status: string[];
};

type FilterKey = keyof OrdersFilters;

const DEFAULT_FILTERS: OrdersFilters = {
  marketplace_status: [],
  shipping_status: [],
  wms_status: [],
};

const marketplaceStatusVariantMap: Record<string, BadgeVariant> = {
  cancelled: "error",
  shipping: "warning",
  shipped: "warning",
  delivered: "success",
  paid: "info",
  processing: "ongoing",
};

const marketplaceStatusLabelMap: Record<string, string> = {
  delivered: "Delivered",
  shipping: "Shipping",
  shipped: "Shipped",
  cancelled: "Cancelled",
  paid: "Paid",
  processing: "Processing",
};

const shippingStatusVariantMap: Record<string, BadgeVariant> = {
  cancelled: "error",
  shipped: "warning",
  awaiting_pickup: "info",
  delivered: "success",
  label_created: "success",
  approved: "success",
};

const shippingStatusLabelMap: Record<string, string> = {
  cancelled: "Cancelled",
  awaiting_pickup: "Awaiting Pickup",
  shipped: "Shipped",
  delivered: "Delivered",
  label_created: "Label Created",
};

const wmsStatusVariantMap: Record<string, BadgeVariant> = {
  READY_TO_PICK: "warning",
  PICKING: "ongoing",
  PACKED: "info",
  SHIPPED: "success",
};

const wmsStatusLabelMap: Record<string, string> = {
  READY_TO_PICK: "Ready to Pickup",
  PICKING: "Picking",
  PACKED: "Packed",
  SHIPPED: "Shipped",
};

const marketplaceStatusFilterOptions: StatusFilterOption[] = [
  { value: "processing", label: "Processing" },
  { value: "paid", label: "Paid" },
  { value: "shipping", label: "Shipping" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const shippingStatusFilterOptions: StatusFilterOption[] = [
  { value: "awaiting_pickup", label: "Awaiting Pickup" },
  { value: "approved", label: "Approved" },
  { value: "label_created", label: "Label Created" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const wmsStatusFilterOptions: StatusFilterOption[] = [
  { value: "READY_TO_PICK", label: "Ready to Pickup" },
  { value: "PICKING", label: "Picking" },
  { value: "PACKED", label: "Packed" },
  { value: "SHIPPED", label: "Shipped" },
];

function resolveMessage(message: string | string[] | undefined, fallback: string) {
  if (!message) return fallback;
  if (Array.isArray(message)) return message.join(", ");
  return message;
}

async function fetchOrders(
  page: number,
  pageSize: number,
  updatedAtOrder: "asc" | "desc",
  filters: OrdersFilters,
): Promise<WmsOrdersPage> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    updated_at_order: updatedAtOrder,
  });
  if (filters.marketplace_status.length > 0) {
    params.set("marketplace_status", filters.marketplace_status.join(","));
  }
  if (filters.shipping_status.length > 0) {
    params.set("shipping_status", filters.shipping_status.join(","));
  }
  if (filters.wms_status.length > 0) {
    params.set("wms_status", filters.wms_status.join(","));
  }

  const response = await fetch(`/api/orders?${params.toString()}`, {
    cache: "no-store",
  });

  let payload: WmsOrderListResponse | null = null;
  try {
    payload = (await response.json()) as WmsOrderListResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(resolveMessage(payload?.message, "Unable to fetch WMS order list."));
  }

  return {
    orders: payload?.orders ?? [],
    pagination: {
      page: payload?.pagination?.page ?? page,
      page_size: payload?.pagination?.page_size ?? pageSize,
      total: payload?.pagination?.total ?? 0,
      total_pages: payload?.pagination?.total_pages ?? 1,
    },
  };
}

async function fetchOrderDetail(orderSn: string) {
  const response = await fetch(`/api/orders?order_sn=${encodeURIComponent(orderSn)}`, {
    cache: "no-store",
  });

  let payload: WmsOrderDetailResponse | null = null;
  try {
    payload = (await response.json()) as WmsOrderDetailResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(resolveMessage(payload?.message, "Unable to fetch order detail."));
  }

  if (!payload?.order) {
    throw new Error("Order detail is empty.");
  }

  return payload.order;
}

async function postOrderAction(orderSn: string, action: WmsAction) {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderSn)}/${action}`, {
    method: "POST",
    cache: "no-store",
  });

  let payload: WmsActionPayload | null = null;
  try {
    payload = (await response.json()) as WmsActionPayload;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(resolveMessage(payload?.message, "Failed to update order status."));
  }

  return payload;
}

async function syncOrderDetail(orderSn: string) {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderSn)}/sync`, {
    method: "POST",
    cache: "no-store",
  });

  let payload: WmsDetailSyncPayload | null = null;
  try {
    payload = (await response.json()) as WmsDetailSyncPayload;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(resolveMessage(payload?.message, "Failed to sync order detail."));
  }

  return payload;
}

function formatDateTime(isoValue: string) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function normalizeStatusKey(status: string | null) {
  if (!status) return "";
  return status.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function toTitleCaseFromStatus(status: string | null) {
  if (!status) return "-";
  return status
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function toMarketplaceStatusBadgeVariant(status: string | null) {
  const key = normalizeStatusKey(status);
  if (!key) return "outline";
  return marketplaceStatusVariantMap[key] ?? "outline";
}

function toMarketplaceStatusLabel(status: string | null) {
  const key = normalizeStatusKey(status);
  if (!key) return "-";
  return marketplaceStatusLabelMap[key] ?? toTitleCaseFromStatus(status);
}

function toShippingStatusBadgeVariant(status: string | null) {
  const key = normalizeStatusKey(status);
  if (!key) return "outline";
  return shippingStatusVariantMap[key] ?? "outline";
}

function toShippingStatusLabel(status: string | null) {
  const key = normalizeStatusKey(status);
  if (!key) return "-";
  return shippingStatusLabelMap[key] ?? toTitleCaseFromStatus(status);
}

function toWmsStatusBadgeVariant(status: string | null) {
  if (!status) return "outline";
  return wmsStatusVariantMap[status] ?? "outline";
}

function toWmsStatusLabel(status: string | null) {
  if (!status) return "-";
  return wmsStatusLabelMap[status] ?? status.replaceAll("_", " ");
}

function toActionLabel(action: WmsAction) {
  if (action === "pick") return "Pickup";
  if (action === "pack") return "Pack";
  return "Ship";
}

function getWmsActionConfig(status: string | null): WmsActionConfig | null {
  if (status === "READY_TO_PICK") {
    return {
      action: "pick",
      label: "Pickup",
      disabled: false,
    };
  }
  if (status === "PICKING") {
    return {
      action: "pack",
      label: "Pack",
      disabled: false,
    };
  }
  if (status === "PACKED") {
    return {
      action: "ship",
      label: "Ship",
      disabled: false,
    };
  }
  if (status === "SHIPPED") {
    return {
      action: "ship",
      label: "Shipped",
      disabled: true,
    };
  }

  return null;
}

function normalizeFilterSelection(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

type StatusFilterDropdownProps = {
  title: string;
  options: StatusFilterOption[];
  value: string[];
  onSave: (nextValues: string[]) => void;
};

function StatusFilterDropdown({ title, options, value, onSave }: StatusFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  const draftSet = new Set(draft);
  const appliedCount = value.length;

  return (
    <div ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label={`Filter ${title}`}
        onClick={() =>
          setOpen((current) => {
            const next = !current;
            if (next) {
              setDraft(value);
            }
            return next;
          })
        }
      >
        <Filter className={cn("h-3.5 w-3.5", appliedCount > 0 ? "text-primary" : "")} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-md border border-border bg-background p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-foreground">{title}</p>
          <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
            {options.map((option) => {
              const checked = draftSet.has(option.value);
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(checkedState) => {
                      setDraft((current) => {
                        const next = new Set(current);
                        if (checkedState === true) {
                          next.add(option.value);
                        } else {
                          next.delete(option.value);
                        }
                        return Array.from(next);
                      });
                    }}
                  />
                  <span className="text-foreground">{option.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft([])}>
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onSave(normalizeFilterSelection(draft));
                setOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function OrdersList() {
  const queryClient = useQueryClient();
  const [selectedOrderSn, setSelectedOrderSn] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }]);
  const [filters, setFilters] = useState<OrdersFilters>(DEFAULT_FILTERS);
  const [isOrderDetailSyncCooldown, setIsOrderDetailSyncCooldown] = useState(false);
  const orderDetailSyncCooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatedAtOrder: "asc" | "desc" =
    sorting[0]?.id === "updated_at" && sorting[0].desc === false ? "asc" : "desc";

  const {
    data: ordersPage,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["orders", pagination.pageIndex, pagination.pageSize, updatedAtOrder, filters],
    queryFn: () =>
      fetchOrders(pagination.pageIndex + 1, pagination.pageSize, updatedAtOrder, filters),
  });

  const {
    data: orderDetail,
    isLoading: isDetailLoading,
    isError: isDetailError,
    error: detailError,
  } = useQuery({
    queryKey: ["order-detail", selectedOrderSn],
    queryFn: () => fetchOrderDetail(selectedOrderSn ?? ""),
    enabled: Boolean(selectedOrderSn),
  });

  const { mutate: mutateOrderAction, isPending: isOrderActionPending } = useMutation({
    mutationFn: ({ orderSn, action }: { orderSn: string; action: WmsAction }) =>
      postOrderAction(orderSn, action),
    onSuccess: (_payload, variables) => {
      toast.success(`Order ${toActionLabel(variables.action)} success.`, {
        position: "top-center",
      });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({
        queryKey: ["order-detail", variables.orderSn],
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update order status.";
      toast.error(message, {
        position: "top-center",
      });
    },
  });

  const { mutate: mutateOrderDetailSync, isPending: isOrderDetailSyncPending } = useMutation({
    mutationFn: (orderSn: string) => syncOrderDetail(orderSn),
    onSuccess: (payload, orderSn) => {
      toast.success(resolveMessage(payload?.message, "Order detail synchronized."), {
        position: "top-center",
      });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["order-detail", orderSn] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to sync order detail.";
      toast.error(message, {
        position: "top-center",
      });
    },
  });

  useEffect(() => {
    return () => {
      if (orderDetailSyncCooldownTimeoutRef.current) {
        clearTimeout(orderDetailSyncCooldownTimeoutRef.current);
      }
    };
  }, []);

  const handleSaveFilter = useCallback((key: FilterKey, nextValues: string[]) => {
    setFilters((current) => ({
      ...current,
      [key]: normalizeFilterSelection(nextValues),
    }));
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, []);

  const columns = useMemo<ColumnDef<WmsOrder>[]>(
    () => [
      {
        accessorKey: "order_sn",
        header: "Order SN",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.order_sn}</span>
        ),
      },
      {
        accessorKey: "marketplace_status",
        header: () => (
          <div className="inline-flex items-center gap-1">
            <span>Marketplace Status</span>
            <StatusFilterDropdown
              title="Marketplace Status"
              options={marketplaceStatusFilterOptions}
              value={filters.marketplace_status}
              onSave={(nextValues) => handleSaveFilter("marketplace_status", nextValues)}
            />
          </div>
        ),
        cell: ({ row }) => (
          <Badge variant={toMarketplaceStatusBadgeVariant(row.original.marketplace_status)}>
            {toMarketplaceStatusLabel(row.original.marketplace_status)}
          </Badge>
        ),
      },
      {
        accessorKey: "shipping_status",
        header: () => (
          <div className="inline-flex items-center gap-1">
            <span>Shipping Status</span>
            <StatusFilterDropdown
              title="Shipping Status"
              options={shippingStatusFilterOptions}
              value={filters.shipping_status}
              onSave={(nextValues) => handleSaveFilter("shipping_status", nextValues)}
            />
          </div>
        ),
        cell: ({ row }) => (
          <Badge variant={toShippingStatusBadgeVariant(row.original.shipping_status)}>
            {toShippingStatusLabel(row.original.shipping_status)}
          </Badge>
        ),
      },
      {
        accessorKey: "wms_status",
        header: () => (
          <div className="inline-flex items-center gap-1">
            <span>WMS Status</span>
            <StatusFilterDropdown
              title="WMS Status"
              options={wmsStatusFilterOptions}
              value={filters.wms_status}
              onSave={(nextValues) => handleSaveFilter("wms_status", nextValues)}
            />
          </div>
        ),
        cell: ({ row }) => (
          <Badge variant={toWmsStatusBadgeVariant(row.original.wms_status)}>
            {toWmsStatusLabel(row.original.wms_status)}
          </Badge>
        ),
      },
      {
        accessorKey: "tracking_number",
        header: "Tracking Number",
        cell: ({ row }) => {
          const trackingNumber = row.original.tracking_number;
          if (!trackingNumber) return "-";
          return truncateText(trackingNumber, 20);
        },
      },
      {
        accessorKey: "updated_at",
        enableSorting: true,
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-left"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            <span>Updated At</span>
            <span className="text-xs">
              {column.getIsSorted() === "asc" ? "↑" : column.getIsSorted() === "desc" ? "↓" : "↕"}
            </span>
          </button>
        ),
        cell: ({ row }) => formatDateTime(row.original.updated_at),
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setSelectedOrderSn(row.original.order_sn);
            }}
          >
            Detail
          </Button>
        ),
      },
    ],
    [filters.marketplace_status, filters.shipping_status, filters.wms_status, handleSaveFilter],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: ordersPage?.orders ?? [],
    columns,
    pageCount: ordersPage?.pagination.total_pages ?? 1,
    manualPagination: true,
    manualSorting: true,
    autoResetPageIndex: false,
    defaultColumn: {
      enableSorting: false,
    },
    state: {
      pagination,
      sorting,
    },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      setSorting((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        if (next.length === 0) {
          return [{ id: "updated_at", desc: true }];
        }
        return [next[0]];
      });
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
    getCoreRowModel: getCoreRowModel(),
  });

  useEffect(() => {
    const totalPagesFromServer = ordersPage?.pagination.total_pages;
    if (typeof totalPagesFromServer !== "number") {
      return;
    }
    const maxPageIndex = Math.max(0, totalPagesFromServer - 1);
    setPagination((current) =>
      current.pageIndex > maxPageIndex ? { ...current, pageIndex: maxPageIndex } : current,
    );
  }, [ordersPage?.pagination.total_pages]);

  const detailActionConfig = getWmsActionConfig(orderDetail?.wms_status ?? null);
  const orderItems = orderDetail?.items ?? [];
  const totalAmount = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemRows: Array<WmsOrderItem | null> =
    orderItems.length >= 2
      ? orderItems
      : [...orderItems, ...Array.from({ length: 2 - orderItems.length }, () => null)];

  const currentRows = table.getRowModel().rows;
  const totalOrders = ordersPage?.pagination.total ?? 0;
  const currentPage = pagination.pageIndex + 1;
  const totalPages = Math.max(1, ordersPage?.pagination.total_pages ?? 1);
  const showingFrom = totalOrders === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const showingTo = totalOrders === 0 ? 0 : showingFrom + currentRows.length - 1;

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5">
      <div className="mt-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading WMS orders...</p> : null}
        {isError ? (
          <p className="text-sm text-destructive">
            {(error as Error)?.message ?? "Failed to fetch WMS orders."}
          </p>
        ) : null}

        {!isLoading && !isError ? (
          <div className="min-h-100 overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="px-4 py-3 font-medium">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {currentRows.length === 0 ? (
                  <tr className="border-t border-border">
                    <td
                      colSpan={table.getAllLeafColumns().length}
                      className="px-4 py-6 text-center text-muted-foreground"
                    >
                      No orders found.
                    </td>
                  </tr>
                ) : (
                  currentRows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 text-foreground">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {!isLoading && !isError ? (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {showingFrom}-{showingTo} of {totalOrders}
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="orders-page-size" className="text-xs text-muted-foreground">
                Rows
              </label>
              <select
                id="orders-page-size"
                value={pagination.pageSize}
                onChange={(event) => {
                  const nextSize = Number(event.target.value);
                  table.setPageSize(nextSize);
                  table.setPageIndex(0);
                }}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Prev
              </Button>
              <p className="min-w-16 text-center text-xs text-muted-foreground">
                {currentPage}/{totalPages}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedOrderSn ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedOrderSn(null)}
        >
          <div
            className="w-115 max-w-[calc(100vw-2rem)] rounded-xl bg-background p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Detail</h2>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Sync order detail"
                onClick={() => {
                  if (!selectedOrderSn || isOrderDetailSyncPending || isOrderDetailSyncCooldown) {
                    return;
                  }

                  setIsOrderDetailSyncCooldown(true);
                  if (orderDetailSyncCooldownTimeoutRef.current) {
                    clearTimeout(orderDetailSyncCooldownTimeoutRef.current);
                  }
                  orderDetailSyncCooldownTimeoutRef.current = setTimeout(() => {
                    setIsOrderDetailSyncCooldown(false);
                    orderDetailSyncCooldownTimeoutRef.current = null;
                  }, 1000);

                  mutateOrderDetailSync(selectedOrderSn);
                }}
                disabled={!selectedOrderSn || isOrderDetailSyncPending || isOrderDetailSyncCooldown}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-4 w-4 ${isOrderDetailSyncPending ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {isDetailLoading ? (
              <p className="text-sm text-muted-foreground">Loading detail...</p>
            ) : null}
            {isDetailError ? (
              <p className="text-sm text-destructive">
                {(detailError as Error)?.message ?? "Failed to fetch order detail."}
              </p>
            ) : null}

            {!isDetailLoading && !isDetailError && orderDetail ? (
              <>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Order SN</p>
                      <p className="mt-2 text-sm text-foreground">{orderDetail.order_sn}</p>
                    </div>
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Updated At</p>
                      <p className="mt-2 text-sm text-foreground">
                        {formatDateTime(orderDetail.updated_at)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Marketplace Status
                      </p>
                      <div className="mt-2">
                        <Badge
                          variant={toMarketplaceStatusBadgeVariant(orderDetail.marketplace_status)}
                        >
                          {toMarketplaceStatusLabel(orderDetail.marketplace_status)}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Shipping Status</p>
                      <div className="mt-2">
                        <Badge variant={toShippingStatusBadgeVariant(orderDetail.shipping_status)}>
                          {toShippingStatusLabel(orderDetail.shipping_status)}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">WMS Status</p>
                      <div className="mt-2">
                        <Badge variant={toWmsStatusBadgeVariant(orderDetail.wms_status)}>
                          {toWmsStatusLabel(orderDetail.wms_status)}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Tracking Number</p>
                      <p className="mt-2 text-sm text-foreground">
                        {orderDetail.tracking_number ?? "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Total Amount</p>
                      <p className="mt-2 text-sm text-foreground">{formatCurrency(totalAmount)}</p>
                    </div>
                    <div className="rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground">Created At</p>
                      <p className="mt-2 text-sm text-foreground">
                        {formatDateTime(orderDetail.created_at)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border border-border">
                  <table className="min-w-full table-fixed border-collapse text-left text-sm">
                    <colgroup>
                      <col className="w-[46%]" />
                      <col className="w-[18%]" />
                      <col className="w-[36%]" />
                    </colgroup>
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">SKU</th>
                        <th className="px-4 py-3 font-medium">QTY</th>
                        <th className="px-4 py-3 font-medium">Price</th>
                      </tr>
                    </thead>
                  </table>
                  <div className={cn(orderItems.length > 2 ? "max-h-24 overflow-y-auto" : "")}>
                    <table className="min-w-full table-fixed border-collapse text-left text-sm">
                      <colgroup>
                        <col className="w-[46%]" />
                        <col className="w-[18%]" />
                        <col className="w-[36%]" />
                      </colgroup>
                      <tbody>
                        {itemRows.map((item, index) => (
                          <tr
                            key={`${item?.sku ?? "empty"}-${index}`}
                            className="border-t border-border"
                          >
                            <td className="px-4 py-3 text-foreground">{item?.sku ?? "-"}</td>
                            <td className="px-4 py-3 text-foreground">{item?.quantity ?? "-"}</td>
                            <td className="px-4 py-3 text-foreground">
                              {item ? formatCurrency(item.price) : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {detailActionConfig ? (
                  <div className="mt-4">
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => {
                        if (!selectedOrderSn || detailActionConfig.disabled) {
                          return;
                        }
                        mutateOrderAction({
                          orderSn: selectedOrderSn,
                          action: detailActionConfig.action,
                        });
                      }}
                      disabled={
                        detailActionConfig.disabled || isOrderActionPending || !selectedOrderSn
                      }
                    >
                      {isOrderActionPending && !detailActionConfig.disabled
                        ? `${detailActionConfig.label}...`
                        : detailActionConfig.label}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
