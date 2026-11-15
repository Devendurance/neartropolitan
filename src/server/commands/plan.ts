import { randomUUID } from "node:crypto";
import type { ContractAccount, ContractListing, ContractOrder } from "../near/client";

export class CommandError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const COMMAND_ACTIONS = [
  "harvest",
  "bake",
  "list",
  "buy",
  "upgrade",
  "accept_order",
  "complete_order",
] as const;

export type CommandAction = (typeof COMMAND_ACTIONS)[number];

export type PlanInput = {
  action: CommandAction;
  params?: Record<string, unknown>;
  opId?: string;
};

export type PlanContext = {
  accountId: string;
  contractId: string;
  now: number;
  account: ContractAccount;
  listings: ContractListing[];
  orders: ContractOrder[];
};

export type PreparedCall = {
  contractId: string;
  method: string;
  args: Record<string, string | number>;
  gas: string;
  deposit: string;
  operationId: string;
  summary: string;
};

const WHEAT_PER_BREAD = 2n;
const CART_COST = 25_000_000_000_000_000_000_000n;
const CART_LIMIT = 3n;
const MIN_TTL_SECONDS = 60n;
const MAX_TTL_SECONDS = 86_400n;
const GAS = "30000000000000";

function u128(value: unknown, field: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new CommandError(400, "invalid_number", `${field} must be a non-negative integer`);
}

function goodOf(value: unknown): "Wheat" | "Bread" {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "wheat") return "Wheat";
  if (normalized === "bread") return "Bread";
  throw new CommandError(400, "invalid_good", "good must be wheat or bread");
}

function operationId(input: PlanInput): string {
  if (!input.opId) return randomUUID();
  if (!/^[A-Za-z0-9:_-]{8,84}$/.test(input.opId)) {
    throw new CommandError(400, "invalid_operation_id", "operation id has an invalid format");
  }
  return input.opId;
}

export function planCommand(input: PlanInput, context: PlanContext): PreparedCall {
  const params = input.params ?? {};
  const opId = operationId(input);
  const { account, now } = context;

  const base = {
    contractId: context.contractId,
    gas: GAS,
    deposit: "0",
    operationId: opId,
  };

  switch (input.action) {
    case "harvest": {
      if (now < account.harvest_ready_at) {
        throw new CommandError(409, "cooldown", "harvest is still cooling down");
      }
      return { ...base, method: "harvest", args: { op_id: opId }, summary: "Harvest 6 wheat" };
    }

    case "bake": {
      const quantity = u128(params.quantity ?? 1, "quantity");
      if (quantity < 1n) {
        throw new CommandError(400, "invalid_quantity", "bake quantity must be at least 1");
      }
      const wheatNeeded = quantity * WHEAT_PER_BREAD;
      if (BigInt(account.wheat) < wheatNeeded) {
        throw new CommandError(409, "insufficient_goods", "not enough wheat to bake");
      }
      if (now < account.bake_ready_at) {
        throw new CommandError(409, "cooldown", "the oven is still cooling down");
      }
      return {
        ...base,
        method: "bake",
        args: { quantity: quantity.toString(), op_id: opId },
        summary: `Bake ${quantity} bread from ${wheatNeeded} wheat`,
      };
    }

    case "list": {
      const good = goodOf(params.good);
      const quantity = u128(params.quantity, "quantity");
      const unitPrice = u128(params.unit_price, "unit_price");
      const ttl = u128(params.ttl_secs ?? 3_600, "ttl_secs");
      if (quantity < 1n) {
        throw new CommandError(400, "invalid_quantity", "listing quantity must be at least 1");
      }
      if (unitPrice < 1n) {
        throw new CommandError(400, "invalid_price", "unit price must be positive");
      }
      if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
        throw new CommandError(400, "invalid_ttl", "listing lifetime must be between 1 and 24 hours");
      }
      const held = good === "Wheat" ? BigInt(account.wheat) : BigInt(account.bread);
      if (held < quantity) {
        throw new CommandError(409, "insufficient_goods", "you do not hold that many goods");
      }
      return {
        ...base,
        method: "create_listing",
        args: {
          good,
          quantity: quantity.toString(),
          unit_price: unitPrice.toString(),
          ttl_secs: Number(ttl),
        },
        summary: `List ${quantity} ${good.toLowerCase()} at ${unitPrice} yocto each`,
      };
    }

    case "buy": {
      const listingId = u128(params.listing_id, "listing_id");
      const quantity = u128(params.quantity, "quantity");
      const maxPrice = u128(params.max_unit_price, "max_unit_price");
      const listing = context.listings.find((item) => BigInt(item.id) === listingId);
      if (!listing || !listing.active) {
        throw new CommandError(404, "listing_unavailable", "that listing is no longer open");
      }
      if (listing.expires_at <= now) {
        throw new CommandError(409, "listing_expired", "that listing has expired");
      }
      if (quantity < 1n || quantity > BigInt(listing.quantity)) {
        throw new CommandError(409, "insufficient_listing", "the listing does not have that quantity");
      }
      if (BigInt(listing.unit_price) > maxPrice) {
        throw new CommandError(409, "price_above_limit", "the price moved above your limit");
      }
      if (listing.seller === context.accountId) {
        throw new CommandError(409, "self_trade", "you cannot buy your own listing");
      }
      const total = BigInt(listing.unit_price) * quantity;
      if (BigInt(account.credit) < total) {
        throw new CommandError(409, "insufficient_credit", "not enough credit for this purchase");
      }
      return {
        ...base,
        method: "buy",
        args: {
          listing_id: Number(listingId),
          quantity: quantity.toString(),
          max_unit_price: maxPrice.toString(),
          op_id: opId,
        },
        summary: `Buy ${quantity} ${listing.good.toLowerCase()} for ${total} yocto`,
      };
    }

    case "upgrade": {
      if (BigInt(account.cart_capacity) >= CART_LIMIT) {
        throw new CommandError(409, "already_upgraded", "the cart is already at full capacity");
      }
      if (BigInt(account.credit) < CART_COST) {
        throw new CommandError(409, "insufficient_credit", "not enough credit for a cart");
      }
      return {
        ...base,
        method: "upgrade_cart",
        args: { op_id: opId },
        summary: "Upgrade the cart to capacity 3",
      };
    }

    case "accept_order": {
      const orderId = u128(params.order_id, "order_id");
      const order = context.orders.find((item) => BigInt(item.id) === orderId);
      if (!order || order.status !== "Open") {
        throw new CommandError(404, "order_unavailable", "that order is not open");
      }
      if (order.deadline <= now) {
        throw new CommandError(409, "order_expired", "that order has expired");
      }
      return {
        ...base,
        method: "accept_order",
        args: { order_id: Number(orderId) },
        summary: `Accept delivery order ${orderId}`,
      };
    }

    case "complete_order": {
      const orderId = u128(params.order_id, "order_id");
      const order = context.orders.find((item) => BigInt(item.id) === orderId);
      if (!order || order.status !== "Assigned") {
        throw new CommandError(404, "order_unavailable", "that order is not assigned");
      }
      if (order.assignee !== context.accountId) {
        throw new CommandError(409, "not_assignee", "that order is assigned to another player");
      }
      if (order.deadline <= now) {
        throw new CommandError(409, "order_expired", "that order has expired");
      }
      const required = BigInt(order.bread_required);
      if (BigInt(account.bread) < required) {
        throw new CommandError(409, "insufficient_goods", "not enough bread for this delivery");
      }
      if (BigInt(account.cart_capacity) < required) {
        throw new CommandError(409, "capacity_exceeded", "this delivery needs a bigger cart");
      }
      return {
        ...base,
        method: "complete_order",
        args: { order_id: Number(orderId), op_id: opId },
        summary: `Deliver ${required} bread for ${order.reward} yocto`,
      };
    }

    default:
      throw new CommandError(400, "unknown_action", "unknown action");
  }
}
