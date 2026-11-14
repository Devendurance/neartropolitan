use near_sdk::store::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};
use near_sdk::serde_json::{json, Value};

/// Credit is denominated in yoctoNEAR so contract accounting never drifts
/// from the funds actually held by the account.
const STARTER_CREDIT: u128 = 50_000_000_000_000_000_000_000; // 0.05 NEAR
const STARTER_WHEAT: u128 = 4;
const WHEAT_PER_HARVEST: u128 = 6;
const HARVEST_COOLDOWN_MS: u64 = 90_000;
const WHEAT_PER_BREAD: u128 = 2;
const BAKE_COOLDOWN_MS: u64 = 30_000;
const CART_COST: u128 = 25_000_000_000_000_000_000_000; // 0.025 NEAR
const CART_CAPACITY: u32 = 3;
const MS_PER_SECOND: u64 = 1_000;

/// u128 values are serialised as decimal strings so JavaScript clients keep
/// exact integers instead of losing precision above 2^53.
mod u128_str {
    use near_sdk::serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &u128, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u128, D::Error> {
        let raw = String::deserialize(deserializer)?;
        raw.parse().map_err(near_sdk::serde::de::Error::custom)
    }
}

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Accounts,
    Listings,
    Orders,
    Ops,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Good {
    Wheat,
    Bread,
}

impl Good {
    fn name(self) -> &'static str {
        match self {
            Good::Wheat => "wheat",
            Good::Bread => "bread",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Account {
    #[serde(with = "u128_str")]
    pub credit: u128,
    #[serde(with = "u128_str")]
    pub wheat: u128,
    #[serde(with = "u128_str")]
    pub bread: u128,
    pub cart_capacity: u32,
    pub harvest_ready_at: u64,
    pub bake_ready_at: u64,
    pub starter_granted: bool,
}

impl Account {
    fn new() -> Self {
        Self {
            credit: 0,
            wheat: 0,
            bread: 0,
            cart_capacity: 1,
            harvest_ready_at: 0,
            bake_ready_at: 0,
            starter_granted: false,
        }
    }

    fn balance_of(&self, good: Good) -> u128 {
        match good {
            Good::Wheat => self.wheat,
            Good::Bread => self.bread,
        }
    }

    fn add(&mut self, good: Good, quantity: u128) {
        match good {
            Good::Wheat => self.wheat = self.wheat.checked_add(quantity).unwrap_or_else(|| env::panic_str("overflow")),
            Good::Bread => self.bread = self.bread.checked_add(quantity).unwrap_or_else(|| env::panic_str("overflow")),
        }
    }

    fn subtract(&mut self, good: Good, quantity: u128) {
        let current = self.balance_of(good);
        near_sdk::require!(current >= quantity, "insufficient goods");
        match good {
            Good::Wheat => self.wheat = current - quantity,
            Good::Bread => self.bread = current - quantity,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub id: u64,
    pub seller: AccountId,
    pub good: Good,
    #[serde(with = "u128_str")]
    pub quantity: u128,
    #[serde(with = "u128_str")]
    pub unit_price: u128,
    pub expires_at: u64,
    pub active: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderStatus {
    Open,
    Assigned,
    Completed,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u64,
    #[serde(with = "u128_str")]
    pub bread_required: u128,
    #[serde(with = "u128_str")]
    pub reward: u128,
    pub status: OrderStatus,
    pub assignee: Option<AccountId>,
    pub deadline: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct OpRecord {
    pub kind: String,
    #[serde(with = "u128_str")]
    pub amount: u128,
    pub at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Stats {
    pub accounts: u64,
    pub listings: u64,
    pub orders: u64,
    #[serde(with = "u128_str")]
    pub escrow: u128,
    #[serde(with = "u128_str")]
    pub total_deposited: u128,
    #[serde(with = "u128_str")]
    pub total_trade_volume: u128,
    pub paused: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    accounts: LookupMap<AccountId, Account>,
    account_count: u64,
    listings: LookupMap<u64, Listing>,
    next_listing_id: u64,
    orders: LookupMap<u64, Order>,
    next_order_id: u64,
    ops: LookupMap<String, OpRecord>,
    escrow: u128,
    total_deposited: u128,
    total_trade_volume: u128,
    paused: bool,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            accounts: LookupMap::new(StorageKey::Accounts),
            account_count: 0,
            listings: LookupMap::new(StorageKey::Listings),
            next_listing_id: 1,
            orders: LookupMap::new(StorageKey::Orders),
            next_order_id: 1,
            ops: LookupMap::new(StorageKey::Ops),
            escrow: 0,
            total_deposited: 0,
            total_trade_volume: 0,
            paused: false,
        }
    }

    // ---------------------------------------------------------------------
    // Funding and administration
    // ---------------------------------------------------------------------

    #[payable]
    pub fn deposit(&mut self) -> U128 {
        self.assert_running();
        let amount = env::attached_deposit().as_yoctonear();
        near_sdk::require!(amount > 0, "deposit must be positive");
        let account_id = env::predecessor_account_id();
        let mut account = self.load_or_create(&account_id);
        account.credit = account.credit.checked_add(amount).unwrap_or_else(|| env::panic_str("overflow"));
        self.accounts.insert(account_id.clone(), account);
        self.total_deposited = self.total_deposited.checked_add(amount).unwrap_or_else(|| env::panic_str("overflow"));
        emit(
            "deposit",
            json!({ "account": account_id, "amount": amount.to_string() }),
        );
        U128(amount)
    }

    pub fn grant_starter(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.assert_running();
        let mut account = self.load_or_create(&account_id);
        near_sdk::require!(!account.starter_granted, "starter already granted");
        account.starter_granted = true;
        account.credit = account
            .credit
            .checked_add(STARTER_CREDIT)
            .unwrap_or_else(|| env::panic_str("overflow"));
        account.wheat = account.wheat.checked_add(STARTER_WHEAT).unwrap_or_else(|| env::panic_str("overflow"));
        self.accounts.insert(account_id.clone(), account);
        emit(
            "starter",
            json!({
                "account": account_id,
                "credit": STARTER_CREDIT.to_string(),
                "wheat": STARTER_WHEAT.to_string(),
            }),
        );
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        emit("paused", json!({ "paused": paused }));
    }

    // ---------------------------------------------------------------------
    // Production
    // ---------------------------------------------------------------------

    pub fn harvest(&mut self, op_id: String) -> U128 {
        self.assert_running();
        let account_id = env::predecessor_account_id();
        let key = op_key("harvest", &account_id, &op_id);
        if let Some(record) = self.ops.get(&key) {
            return U128(record.amount);
        }
        let now = now_ms();
        let mut account = self.load_or_create(&account_id);
        near_sdk::require!(
            now >= account.harvest_ready_at,
            format!(
                "harvest cooldown active until {}",
                account.harvest_ready_at
            )
        );
        account.wheat = account
            .wheat
            .checked_add(WHEAT_PER_HARVEST)
            .unwrap_or_else(|| env::panic_str("overflow"));
        account.harvest_ready_at = now + HARVEST_COOLDOWN_MS;
        self.accounts.insert(account_id.clone(), account);
        self.record_op(key, "harvest", WHEAT_PER_HARVEST, now);
        emit(
            "harvest",
            json!({ "account": account_id, "wheat": WHEAT_PER_HARVEST.to_string() }),
        );
        U128(WHEAT_PER_HARVEST)
    }

    pub fn bake(&mut self, quantity: U128, op_id: String) -> U128 {
        self.assert_running();
        let quantity = quantity.0;
        near_sdk::require!(quantity > 0, "quantity must be positive");
        let account_id = env::predecessor_account_id();
        let key = op_key("bake", &account_id, &op_id);
        if let Some(record) = self.ops.get(&key) {
            return U128(record.amount);
        }
        let now = now_ms();
        let mut account = self.load_or_create(&account_id);
        near_sdk::require!(
            now >= account.bake_ready_at,
            format!("bake cooldown active until {}", account.bake_ready_at)
        );
        let wheat_cost = quantity.checked_mul(WHEAT_PER_BREAD).unwrap_or_else(|| env::panic_str("overflow"));
        account.subtract(Good::Wheat, wheat_cost);
        account.add(Good::Bread, quantity);
        account.bake_ready_at = now + BAKE_COOLDOWN_MS;
        self.accounts.insert(account_id.clone(), account);
        self.record_op(key, "bake", quantity, now);
        emit(
            "bake",
            json!({
                "account": account_id,
                "wheat_spent": wheat_cost.to_string(),
                "bread": quantity.to_string(),
            }),
        );
        U128(quantity)
    }

    pub fn upgrade_cart(&mut self, op_id: String) -> u32 {
        self.assert_running();
        let account_id = env::predecessor_account_id();
        let key = op_key("upgrade", &account_id, &op_id);
        if let Some(record) = self.ops.get(&key) {
            return record.amount as u32;
        }
        let now = now_ms();
        let mut account = self.load_or_create(&account_id);
        near_sdk::require!(
            account.cart_capacity < CART_CAPACITY,
            "cart already upgraded"
        );
        near_sdk::require!(account.credit >= CART_COST, "insufficient credit for cart");
        account.credit -= CART_COST;
        account.cart_capacity = CART_CAPACITY;
        self.accounts.insert(account_id.clone(), account);
        self.escrow = self.escrow.checked_add(CART_COST).unwrap_or_else(|| env::panic_str("overflow"));
        self.record_op(key, "upgrade", CART_CAPACITY as u128, now);
        emit(
            "upgrade",
            json!({
                "account": account_id,
                "cart_capacity": CART_CAPACITY,
                "cost": CART_COST.to_string(),
            }),
        );
        CART_CAPACITY
    }

    // ---------------------------------------------------------------------
    // Market
    // ---------------------------------------------------------------------

    pub fn create_listing(
        &mut self,
        good: Good,
        quantity: U128,
        unit_price: U128,
        ttl_secs: u64,
    ) -> u64 {
        self.assert_running();
        let quantity = quantity.0;
        let unit_price = unit_price.0;
        near_sdk::require!(quantity > 0, "quantity must be positive");
        near_sdk::require!(unit_price > 0, "price must be positive");
        near_sdk::require!(ttl_secs > 0, "ttl must be positive");
        let seller_id = env::predecessor_account_id();
        let mut seller = self.load_or_create(&seller_id);
        seller.subtract(good, quantity);
        self.accounts.insert(seller_id.clone(), seller);

        let id = self.next_listing_id;
        self.next_listing_id += 1;
        let expires_at = now_ms() + ttl_secs * MS_PER_SECOND;
        self.listings.insert(
            id,
            Listing {
                id,
                seller: seller_id.clone(),
                good,
                quantity,
                unit_price,
                expires_at,
                active: true,
            },
        );
        emit(
            "listing_created",
            json!({
                "listing_id": id,
                "seller": seller_id,
                "good": good.name(),
                "quantity": quantity.to_string(),
                "unit_price": unit_price.to_string(),
                "expires_at": expires_at,
            }),
        );
        id
    }

    pub fn cancel_listing(&mut self, listing_id: u64) {
        self.assert_running();
        let caller = env::predecessor_account_id();
        let mut listing = self
            .listings
            .get(&listing_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("listing not found"));
        near_sdk::require!(listing.active, "listing inactive");
        near_sdk::require!(listing.seller == caller, "only seller can cancel");
        let remaining = listing.quantity;
        listing.quantity = 0;
        listing.active = false;
        self.listings.insert(listing_id, listing.clone());
        let mut seller = self.load_or_create(&caller);
        seller.add(listing.good, remaining);
        self.accounts.insert(caller.clone(), seller);
        emit(
            "listing_cancelled",
            json!({
                "listing_id": listing_id,
                "seller": caller,
                "returned": remaining.to_string(),
            }),
        );
    }

    pub fn buy(
        &mut self,
        listing_id: u64,
        quantity: U128,
        max_unit_price: U128,
        op_id: String,
    ) -> U128 {
        self.assert_running();
        let quantity = quantity.0;
        let max_unit_price = max_unit_price.0;
        near_sdk::require!(quantity > 0, "quantity must be positive");
        let buyer_id = env::predecessor_account_id();
        let key = op_key("buy", &buyer_id, &op_id);
        if let Some(record) = self.ops.get(&key) {
            return U128(record.amount);
        }
        let now = now_ms();
        let mut listing = self
            .listings
            .get(&listing_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("listing not found"));
        near_sdk::require!(listing.active, "listing inactive");
        near_sdk::require!(now <= listing.expires_at, "listing expired");
        near_sdk::require!(quantity <= listing.quantity, "quantity exceeds listing");
        near_sdk::require!(
            listing.unit_price <= max_unit_price,
            "price moved above limit"
        );
        near_sdk::require!(listing.seller != buyer_id, "cannot buy own listing");

        let total = listing.unit_price.checked_mul(quantity).unwrap_or_else(|| env::panic_str("overflow"));
        let mut buyer = self.load_or_create(&buyer_id);
        near_sdk::require!(buyer.credit >= total, "insufficient credit");
        buyer.credit -= total;
        buyer.add(listing.good, quantity);
        self.accounts.insert(buyer_id.clone(), buyer);

        let seller_id = listing.seller.clone();
        let mut seller = self.load_or_create(&seller_id);
        seller.credit = seller.credit.checked_add(total).unwrap_or_else(|| env::panic_str("overflow"));
        self.accounts.insert(seller_id.clone(), seller);

        listing.quantity -= quantity;
        if listing.quantity == 0 {
            listing.active = false;
        }
        self.listings.insert(listing_id, listing.clone());
        self.total_trade_volume = self
            .total_trade_volume
            .checked_add(total)
            .unwrap_or_else(|| env::panic_str("overflow"));
        self.record_op(key, "buy", total, now);
        emit(
            "trade",
            json!({
                "listing_id": listing_id,
                "buyer": buyer_id,
                "seller": seller_id,
                "good": listing.good.name(),
                "quantity": quantity.to_string(),
                "unit_price": listing.unit_price.to_string(),
                "total": total.to_string(),
            }),
        );
        U128(total)
    }

    // ---------------------------------------------------------------------
    // Deliveries
    // ---------------------------------------------------------------------

    pub fn create_order(&mut self, bread_required: U128, reward: U128, ttl_secs: u64) -> u64 {
        self.assert_owner();
        self.assert_running();
        let bread_required = bread_required.0;
        let reward = reward.0;
        near_sdk::require!(bread_required > 0, "bread_required must be positive");
        near_sdk::require!(reward > 0, "reward must be positive");
        near_sdk::require!(ttl_secs > 0, "ttl must be positive");
        near_sdk::require!(self.escrow >= reward, "escrow cannot fund reward");
        let id = self.next_order_id;
        self.next_order_id += 1;
        let deadline = now_ms() + ttl_secs * MS_PER_SECOND;
        self.orders.insert(
            id,
            Order {
                id,
                bread_required,
                reward,
                status: OrderStatus::Open,
                assignee: None,
                deadline,
            },
        );
        emit(
            "order_created",
            json!({
                "order_id": id,
                "bread_required": bread_required.to_string(),
                "reward": reward.to_string(),
                "deadline": deadline,
            }),
        );
        id
    }

    pub fn accept_order(&mut self, order_id: u64) {
        self.assert_running();
        let caller = env::predecessor_account_id();
        let mut order = self.orders.get(&order_id).cloned().unwrap_or_else(|| env::panic_str("order not found"));
        near_sdk::require!(order.status == OrderStatus::Open, "order not open");
        near_sdk::require!(now_ms() <= order.deadline, "order deadline passed");
        order.status = OrderStatus::Assigned;
        order.assignee = Some(caller.clone());
        self.orders.insert(order_id, order);
        emit(
            "order_accepted",
            json!({ "order_id": order_id, "assignee": caller }),
        );
    }

    pub fn complete_order(&mut self, order_id: u64, op_id: String) -> U128 {
        self.assert_running();
        let caller = env::predecessor_account_id();
        let key = op_key("deliver", &caller, &op_id);
        if let Some(record) = self.ops.get(&key) {
            return U128(record.amount);
        }
        let now = now_ms();
        let mut order = self.orders.get(&order_id).cloned().unwrap_or_else(|| env::panic_str("order not found"));
        near_sdk::require!(order.status == OrderStatus::Assigned, "order not assigned");
        near_sdk::require!(
            order.assignee.clone().unwrap_or_else(|| env::panic_str("assignee missing")) == caller,
            "not the assignee"
        );
        near_sdk::require!(now <= order.deadline, "order deadline passed");
        near_sdk::require!(self.escrow >= order.reward, "escrow cannot fund reward");

        let mut account = self.load_or_create(&caller);
        near_sdk::require!(
            order.bread_required <= u128::from(account.cart_capacity),
            "delivery exceeds cart capacity"
        );
        account.subtract(Good::Bread, order.bread_required);
        account.credit = account.credit.checked_add(order.reward).unwrap_or_else(|| env::panic_str("overflow"));
        self.accounts.insert(caller.clone(), account);
        self.escrow -= order.reward;

        order.status = OrderStatus::Completed;
        let reward = order.reward;
        let bread_required = order.bread_required;
        self.orders.insert(order_id, order);
        self.record_op(key, "deliver", reward, now);
        emit(
            "order_completed",
            json!({
                "order_id": order_id,
                "assignee": caller,
                "bread": bread_required.to_string(),
                "reward": reward.to_string(),
            }),
        );
        U128(reward)
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    pub fn get_account(&self, account_id: AccountId) -> Account {
        self.accounts
            .get(&account_id)
            .cloned()
            .unwrap_or_else(Account::new)
    }

    pub fn get_listing(&self, listing_id: u64) -> Option<Listing> {
        self.listings.get(&listing_id).cloned()
    }

    pub fn get_listings(&self, offset: u64, limit: u64) -> Vec<Listing> {
        let mut out = Vec::new();
        let mut skipped = 0;
        let mut id = self.next_listing_id.saturating_sub(1);
        while id > 0 && out.len() < limit as usize {
            if let Some(listing) = self.listings.get(&id) {
                if listing.active {
                    if skipped < offset {
                        skipped += 1;
                    } else {
                        out.push(listing.clone());
                    }
                }
            }
            id -= 1;
        }
        out
    }

    pub fn get_order(&self, order_id: u64) -> Option<Order> {
        self.orders.get(&order_id).cloned()
    }

    pub fn get_orders(&self, offset: u64, limit: u64) -> Vec<Order> {
        let mut out = Vec::new();
        let mut skipped = 0;
        let mut id = self.next_order_id.saturating_sub(1);
        while id > 0 && out.len() < limit as usize {
            if let Some(order) = self.orders.get(&id) {
                if skipped < offset {
                    skipped += 1;
                } else {
                    out.push(order.clone());
                }
            }
            id -= 1;
        }
        out
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            accounts: self.account_count,
            listings: self.next_listing_id - 1,
            orders: self.next_order_id - 1,
            escrow: self.escrow,
            total_deposited: self.total_deposited,
            total_trade_volume: self.total_trade_volume,
            paused: self.paused,
        }
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    fn load_or_create(&mut self, account_id: &AccountId) -> Account {
        match self.accounts.get(account_id) {
            Some(account) => account.clone(),
            None => {
                self.account_count += 1;
                Account::new()
            }
        }
    }

    fn record_op(&mut self, key: String, kind: &str, amount: u128, at: u64) {
        self.ops.insert(
            key,
            OpRecord {
                kind: kind.to_string(),
                amount,
                at,
            },
        );
    }

    fn assert_owner(&self) {
        near_sdk::require!(
            env::predecessor_account_id() == self.owner,
            "owner only method"
        );
    }

    fn assert_running(&self) {
        near_sdk::require!(!self.paused, "contract paused");
    }
}

fn now_ms() -> u64 {
    env::block_timestamp() / 1_000_000
}

fn op_key(kind: &str, account: &AccountId, op_id: &str) -> String {
    format!("{}:{}:{}", kind, account, op_id)
}

fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "city",
        "version": "1.0.0",
        "event": event,
        "data": data,
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}
