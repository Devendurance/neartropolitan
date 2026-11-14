import { Account, JsonRpcProvider, actions, type KeyPairString } from "near-api-js";

export type Good = "Wheat" | "Bread";

export type ContractAccount = {
  credit: string;
  wheat: string;
  bread: string;
  cart_capacity: number;
  harvest_ready_at: number;
  bake_ready_at: number;
  starter_granted: boolean;
};

export type ContractListing = {
  id: number;
  seller: string;
  good: Good;
  quantity: string;
  unit_price: string;
  expires_at: number;
  active: boolean;
};

export type ContractOrder = {
  id: number;
  bread_required: string;
  reward: string;
  status: "Open" | "Assigned" | "Completed" | "Cancelled";
  assignee: string | null;
  deadline: number;
};

export type ContractStats = {
  accounts: number;
  listings: number;
  orders: number;
  escrow: string;
  total_deposited: string;
  total_trade_volume: string;
  paused: boolean;
};

export const GAS = 30n * 10n ** 12n;

export function nearConfig() {
  const contractId = process.env.NEAR_ACCOUNT_ID;
  if (!contractId) {
    throw new Error("NEAR_ACCOUNT_ID is not set");
  }
  return {
    contractId,
    network: process.env.NEAR_NETWORK ?? "testnet",
    rpcUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  };
}

let providerInstance: JsonRpcProvider | null = null;

export function provider() {
  if (!providerInstance) {
    providerInstance = new JsonRpcProvider({ url: nearConfig().rpcUrl });
  }
  return providerInstance;
}

export async function view<T>(method: string, args: Record<string, unknown> = {}) {
  const { contractId } = nearConfig();
  return (await provider().callFunction({
    contractId,
    method,
    args,
  })) as T;
}

export async function getAccount(accountId: string) {
  return view<ContractAccount>("get_account", { account_id: accountId });
}

export async function getListings(limit = 50) {
  return view<ContractListing[]>("get_listings", { offset: 0, limit });
}

export async function getOrders(limit = 50) {
  return view<ContractOrder[]>("get_orders", { offset: 0, limit });
}

export async function getStats() {
  return view<ContractStats>("get_stats");
}

export type SubmitResult = {
  txHash: string;
  status: "success" | "failure";
  logs: string[];
  blockHeight: number | null;
  error: string | null;
};

export async function submit(options: {
  signerId: string;
  secretKey: string;
  method: string;
  args?: Record<string, unknown>;
  depositYocto?: bigint;
}): Promise<SubmitResult> {
  const { contractId } = nearConfig();
  const account = new Account(
    options.signerId,
    provider(),
    options.secretKey as KeyPairString,
  );
  const result = await account.signAndSendTransaction({
    receiverId: contractId,
    waitUntil: "FINAL",
    actions: [
      actions.functionCall(
        options.method,
        options.args ?? {},
        GAS,
        options.depositYocto ?? 0n,
      ),
    ],
  });

  const txHash =
    (result as unknown as { transaction_outcome?: { id: string } }).transaction_outcome?.id ?? "";
  const blockHash =
    (result as unknown as { transaction_outcome?: { block_hash: string } })
      .transaction_outcome?.block_hash ?? null;

  let blockHeight: number | null = null;
  if (blockHash) {
    try {
      const block = (await provider().sendJsonRpc("block", {
        block_id: blockHash,
      })) as { header?: { height?: number } };
      blockHeight = block.header?.height ?? null;
    } catch {
      blockHeight = null;
    }
  }

  const status = (result as unknown as { status?: unknown }).status;
  const failure = status && typeof status === "object" && "Failure" in status;
  const logs: string[] = [];
  for (const outcome of
    (result as unknown as { receipts_outcome?: Array<{ outcome?: { logs?: string[] } }> })
      .receipts_outcome ?? []) {
    logs.push(...(outcome.outcome?.logs ?? []));
  }

  return {
    txHash,
    status: failure ? "failure" : "success",
    logs,
    blockHeight,
    error: failure ? JSON.stringify(status) : null,
  };
}

export async function txStatus(txHash: string, signerId: string) {
  return (await provider().sendJsonRpc("tx", [txHash, signerId])) as {
    status?: unknown;
    transaction_outcome?: { block_hash: string; id: string };
    receipts_outcome?: Array<{
      id: string;
      outcome: { logs: string[]; status: unknown };
      receipt?: { receiver_id?: string };
    }>;
  };
}

export function isFailure(status: unknown): boolean {
  return Boolean(status && typeof status === "object" && "Failure" in status);
}
