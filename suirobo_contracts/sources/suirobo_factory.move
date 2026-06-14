module suirobo_contracts::suirobo_factory {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use std::string::String;
    use std::vector;
    use sui::random::Random;

    // --- Errors ---
    const EInsufficientPayment: u64 = 0;
    const EInvalidFeePercentage: u64 = 1;
    const EInvalidFeeAmount: u64 = 2;
    const ENoCreators: u64 = 3;
    const ENotCreator: u64 = 4;

    // --- Core Data Structures ---

    /// The Marketplace global object that holds the Treasury and config
    public struct Marketplace has key {
        id: UID,
        treasury: Balance<SUI>,
        platform_fee_percent: u8, // e.g., 20 for 20%
    }

    /// Admin capability to manage the marketplace
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Represents a Skill published by a Creator
    public struct Skill has key, store {
        id: UID,
        name: String,
        description: String,
        blob_id: String,
        version: String,
        creator: address,
        price: u64, // Price in MIST
    }

    /// A receipt proving that a user has purchased a specific Skill
    public struct SkillReceipt has key, store {
        id: UID,
        skill_id: ID,
    }

    // --- Events ---
    public struct SkillPublished has copy, drop {
        skill_id: ID,
        creator: address,
        name: String,
        price: u64,
        blob_id: String,
    }

    public struct SkillPurchased has copy, drop {
        skill_id: ID,
        buyer: address,
        price: u64,
        creator_revenue: u64,
        platform_revenue: u64,
    }

    public struct ExecutionFeePaid has copy, drop {
        payer: address,
        total_fee: u64,
        platform_share: u64,
        creator_reward: u64,
        rewarded_creator: address,
        num_creators: u64,
    }

    public struct SkillPriceUpdated has copy, drop {
        skill_id: ID,
        new_price: u64,
    }

    // --- Initialization ---
    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::transfer(admin_cap, tx_context::sender(ctx));

        let marketplace = Marketplace {
            id: object::new(ctx),
            treasury: balance::zero(),
            platform_fee_percent: 20, // 20% default fee
        };
        transfer::share_object(marketplace);
    }

    // --- Public Functions ---

    /// Publish a new Skill to the marketplace
    public fun publish_skill(
        name: String,
        description: String,
        blob_id: String,
        version: String,
        price: u64,
        ctx: &mut TxContext
    ) {
        let skill_uid = object::new(ctx);
        let skill_id = object::uid_to_inner(&skill_uid);
        let creator = tx_context::sender(ctx);

        let skill = Skill {
            id: skill_uid,
            name,
            description,
            blob_id,
            version,
            creator,
            price,
        };

        event::emit(SkillPublished {
            skill_id,
            creator,
            name,
            price,
            blob_id,
        });

        // Share the skill object so anyone can buy it
        transfer::share_object(skill);
    }

    /// Buy a Skill using SUI coins
    public fun buy_skill(
        marketplace: &mut Marketplace,
        skill: &Skill,
        payment: Coin<SUI>,
        ctx: &mut TxContext
    ) {
        let payment_val = coin::value(&payment);
        assert!(payment_val >= skill.price, EInsufficientPayment);

        let buyer = tx_context::sender(ctx);

        let platform_revenue_val = (payment_val * (marketplace.platform_fee_percent as u64)) / 100;
        let creator_revenue_val = payment_val - platform_revenue_val;

        let mut payment_mut = payment;
        
        // Take platform fee
        let platform_coin = coin::split(&mut payment_mut, platform_revenue_val, ctx);
        balance::join(&mut marketplace.treasury, coin::into_balance(platform_coin));

        // Transfer remainder to creator
        transfer::public_transfer(payment_mut, skill.creator);

        // Issue receipt to buyer
        let receipt = SkillReceipt {
            id: object::new(ctx),
            skill_id: object::id(skill),
        };
        transfer::public_transfer(receipt, buyer);

        event::emit(SkillPurchased {
            skill_id: object::id(skill),
            buyer,
            price: skill.price,
            creator_revenue: creator_revenue_val,
            platform_revenue: platform_revenue_val,
        });
    }

    /// Update the price of an existing Skill
    public fun update_skill_price(
        skill: &mut Skill,
        new_price: u64,
        ctx: &mut TxContext
    ) {
        assert!(skill.creator == tx_context::sender(ctx), ENotCreator);
        skill.price = new_price;
        event::emit(SkillPriceUpdated {
            skill_id: object::id(skill),
            new_price,
        });
    }

    /// Pay the per-OPEN bot-skill fee (0.01 SUI), split deterministically:
    /// 0.005 SUI → Marketplace Treasury, 0.005 SUI → the skill author (creators[0]).
    /// If no creators provided, the full 0.01 SUI goes to the Treasury.
    /// `_r` (Random) is retained only to preserve the upgrade-compatible signature;
    /// the split is deterministic now — the fee always goes to the skill in use.
    entry fun pay_execution_fee(
        marketplace: &mut Marketplace,
        payment: Coin<SUI>,
        creators: vector<address>,
        _r: &Random,
        ctx: &mut TxContext
    ) {
        let payment_val = coin::value(&payment);
        assert!(payment_val == 10000000, EInvalidFeeAmount); // 0.01 SUI = 10,000,000 MIST

        let payer = tx_context::sender(ctx);
        let mut payment_mut = payment;

        if (vector::is_empty(&creators)) {
            // No creators → full amount to treasury
            balance::join(&mut marketplace.treasury, coin::into_balance(payment_mut));
            event::emit(ExecutionFeePaid {
                payer,
                total_fee: 10000000,
                platform_share: 10000000,
                creator_reward: 0,
                rewarded_creator: @0x0,
                num_creators: 0,
            });
        } else {
            // Split 0.005 SUI (5,000,000 MIST) for the marketplace
            let platform_coin = coin::split(&mut payment_mut, 5000000, ctx);
            balance::join(&mut marketplace.treasury, coin::into_balance(platform_coin));

            // Deterministic: pay the FIRST creator — the author of the skill in use.
            // No randomness: whoever's skill opened the trade earns the 0.005 SUI.
            let selected_creator = *vector::borrow(&creators, 0);

            // Transfer the remaining 0.005 SUI to that creator
            transfer::public_transfer(payment_mut, selected_creator);

            event::emit(ExecutionFeePaid {
                payer,
                total_fee: 10000000,
                platform_share: 5000000,
                creator_reward: 5000000,
                rewarded_creator: selected_creator,
                num_creators: vector::length(&creators),
            });
        };
    }

    // --- Admin Functions ---

    /// Admin can withdraw SUI from the treasury
    public fun withdraw_treasury(
        _: &AdminCap,
        marketplace: &mut Marketplace,
        amount: u64,
        ctx: &mut TxContext
    ) {
        let withdrawn = balance::split(&mut marketplace.treasury, amount);
        let coin = coin::from_balance(withdrawn, ctx);
        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

    /// Admin can update the platform fee percentage
    public fun update_platform_fee(
        _: &AdminCap,
        marketplace: &mut Marketplace,
        new_fee_percent: u8,
        _ctx: &mut TxContext
    ) {
        assert!(new_fee_percent <= 100, EInvalidFeePercentage);
        marketplace.platform_fee_percent = new_fee_percent;
    }
}
