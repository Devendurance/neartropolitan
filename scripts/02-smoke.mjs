import { Account, actions } from "near-api-js";
import {
  call,
  env,
  provider,
  expectFailure,
  fmt,
  near,
  ownerAccount,
  randomImplicitAccount,
  view,
  CONTRACT_ID,
} from "./lib/near.mjs";

const log = (label, value) => console.log(`${label}: ${value}`);

async function fund(accountId, amountNear = 0.3) {
  const funder =
    env.NEAR_DEPLOYER_ID && env.NEAR_DEPLOYER_PRIVATE_KEY
      ? new Account(env.NEAR_DEPLOYER_ID, provider, env.NEAR_DEPLOYER_PRIVATE_KEY)
      : ownerAccount();
  await funder.signAndSendTransaction({
    receiverId: accountId,
    waitUntil: "FINAL",
    actions: [actions.transfer(near(amountNear))],
  });
}

async function main() {
  const owner = ownerAccount();
  const statsBefore = await view("get_stats");
  log("contract", "npt-city");
  log("stats before", JSON.stringify(statsBefore));

  const alice = randomImplicitAccount();
  const bob = randomImplicitAccount();
  console.log(`alice ${alice.accountId}`);
  console.log(`bob   ${bob.accountId}`);

  await fund(alice.accountId);
  await fund(bob.accountId);
  await call(owner, "grant_starter", { account_id: alice.accountId });
  await call(owner, "grant_starter", { account_id: bob.accountId });

  const aliceStart = await view("get_account", { account_id: alice.accountId });
  const bobStart = await view("get_account", { account_id: bob.accountId });
  log("alice after starter", JSON.stringify(aliceStart));
  log("bob after starter", JSON.stringify(bobStart));

  // Wheat production
  const harvest = await call(alice.account, "harvest", { op_id: `h-${Date.now()}` });
  log("alice harvest tx", harvest.transaction_outcome?.id);

  // Alice lists 6 wheat at 0.001 NEAR each
  const listTx = await call(alice.account, "create_listing", {
    good: "Wheat",
    quantity: "6",
    unit_price: near(0.001).toString(),
    ttl_secs: 3600,
  });
  log("alice listing tx", listTx.transaction_outcome?.id);
  const listings = await view("get_listings", { offset: 0, limit: 10 });
  log("open listings", JSON.stringify(listings));
  if (listings.length === 0) throw new Error("listing was not created");
  const listingId = listings[0].id;

  // Bob cannot oversell
  await expectFailure(
    "oversell",
    () =>
      call(bob.account, "buy", {
        listing_id: listingId,
        quantity: "99",
        max_unit_price: near(0.001).toString(),
        op_id: `over-${Date.now()}`,
      }),
    "quantity exceeds listing",
  );

  // Bob cannot buy above his price ceiling
  await expectFailure(
    "price ceiling",
    () =>
      call(bob.account, "buy", {
        listing_id: listingId,
        quantity: "1",
        max_unit_price: near(0.0005).toString(),
        op_id: `ceiling-${Date.now()}`,
      }),
    "price moved above limit",
  );

  // Bob buys 4 wheat atomically
  const buyOp = `buy-${Date.now()}`;
  const buyTx = await call(bob.account, "buy", {
    listing_id: listingId,
    quantity: "4",
    max_unit_price: near(0.001).toString(),
    op_id: buyOp,
  });
  log("bob buy tx", buyTx.transaction_outcome?.id);

  const aliceAfterSale = await view("get_account", { account_id: alice.accountId });
  const bobAfterSale = await view("get_account", { account_id: bob.accountId });
  log("alice after sale", JSON.stringify(aliceAfterSale));
  log("bob after sale", JSON.stringify(bobAfterSale));

  // Bob bakes 2 bread from 4 wheat
  const bakeTx = await call(bob.account, "bake", {
    quantity: "2",
    op_id: `bake-${Date.now()}`,
  });
  log("bob bake tx", bakeTx.transaction_outcome?.id);

  // Cart upgrade
  const cartTx = await call(bob.account, "upgrade_cart", { op_id: `cart-${Date.now()}` });
  log("bob cart tx", cartTx.transaction_outcome?.id);

  // Owner funds escrow for delivery rewards
  const depositTx = await call(owner, "deposit", {}, { deposit: near(0.05) });
  log("owner deposit tx", depositTx.transaction_outcome?.id);

  const orderTx = await call(owner, "create_order", {
    bread_required: "2",
    reward: near(0.001).toString(),
    ttl_secs: 3600,
  });
  log("order create tx", orderTx.transaction_outcome?.id);

  const orders = await view("get_orders", { offset: 0, limit: 10 });
  log("open orders", JSON.stringify(orders));
  const orderId = orders[0].id;

  await call(bob.account, "accept_order", { order_id: orderId });
  const deliverOp = `deliver-${Date.now()}`;
  const deliverTx = await call(bob.account, "complete_order", {
    order_id: orderId,
    op_id: deliverOp,
  });
  log("bob delivery tx", deliverTx.transaction_outcome?.id);

  const bobAfterDelivery = await view("get_account", { account_id: bob.accountId });
  log("bob after delivery", JSON.stringify(bobAfterDelivery));

  // Duplicate completion must not pay twice
  await call(bob.account, "complete_order", {
    order_id: orderId,
    op_id: deliverOp,
  });
  const bobAfterReplay = await view("get_account", { account_id: bob.accountId });
  if (bobAfterReplay.credit !== bobAfterDelivery.credit) {
    throw new Error("duplicate delivery changed credit");
  }
  log("duplicate delivery", "no additional payout");

  // Duplicate buy with the same op id must not charge twice
  const beforeReplayBuy = await view("get_account", { account_id: bob.accountId });
  await call(bob.account, "buy", {
    listing_id: listingId,
    quantity: "4",
    max_unit_price: near(0.001).toString(),
    op_id: buyOp,
  });
  const afterReplayBuy = await view("get_account", { account_id: bob.accountId });
  if (afterReplayBuy.credit !== beforeReplayBuy.credit) {
    throw new Error("duplicate buy charged twice");
  }
  log("duplicate buy", "no additional charge");

  const statsAfter = await view("get_stats");
  log("stats after", JSON.stringify(statsAfter));

  const aliceEnd = await view("get_account", { account_id: alice.accountId });
  const ownerEnd = await view("get_account", { account_id: CONTRACT_ID });
  const creditTotal =
    BigInt(aliceEnd.credit) +
    BigInt(bobAfterReplay.credit) +
    BigInt(ownerEnd.credit) +
    BigInt(statsAfter.escrow);
  const expectedTotal = BigInt(statsAfter.total_deposited) + 2n * near(0.05);
  if (creditTotal !== expectedTotal) {
    throw new Error(`conservation mismatch ${creditTotal} != ${expectedTotal}`);
  }
  log("credit + escrow", fmt(creditTotal));
  log("deposited + starter", fmt(expectedTotal));
  log("wheat alice", aliceEnd.wheat);
  log("wheat bob", bobAfterReplay.wheat);
  log("bread bob", bobAfterReplay.bread);
  log("cart bob", bobAfterReplay.cart_capacity);

  console.log("\nSMOKE PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
