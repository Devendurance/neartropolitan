import { NextResponse } from "next/server";
import {
  COMMAND_ACTIONS,
  planCommand,
  CommandError,
  type CommandAction,
} from "@/server/commands/plan";
import { errorResponse, rateLimit, requireSession } from "@/server/http/guard";
import {
  getAccount,
  getListings,
  getOrders,
  nearConfig,
} from "@/server/near/client";


function asAction(value: unknown): CommandAction {
  if (typeof value === "string" && (COMMAND_ACTIONS as readonly string[]).includes(value)) {
    return value as CommandAction;
  }
  throw new CommandError(400, "unknown_action", "unknown action");
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    rateLimit(`command:${session.accountId}`, 60, 60_000);

    const body = (await request.json()) as {
      action?: unknown;
      params?: Record<string, unknown>;
      opId?: string;
    };

    const action = asAction(body.action);
    const config = nearConfig();

    // Live contract state is authoritative, the read model may lag.
    const [account, listings, orders] = await Promise.all([
      getAccount(session.accountId),
      getListings(100),
      getOrders(100),
    ]);

    const call = planCommand(
      { action, params: body.params ?? {}, opId: body.opId },
      {
        accountId: session.accountId,
        contractId: config.contractId,
        now: Date.now(),
        account,
        listings,
        orders,
      },
    );

    return NextResponse.json({
      call: {
        contractId: call.contractId,
        method: call.method,
        args: call.args,
        gas: call.gas,
        deposit: call.deposit,
      },
      operationId: call.operationId,
      summary: call.summary,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
