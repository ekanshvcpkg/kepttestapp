use anchor_lang::prelude::*;

use crate::constants::{DAILY_XP_CAP, DECLARED_XP_DIVISOR, KEEPER_SEED, QUEST_SLOTS, SOUL_PER_XP};
use crate::day::local_day;
use crate::errors::KeptError;
use crate::events::CheckedIn;
use crate::state::{Keeper, Tier};

#[derive(Accounts)]
pub struct CheckIn<'info> {
    #[account(
        mut,
        seeds = [KEEPER_SEED, authority.key().as_ref()],
        bump = keeper.bump,
        has_one = authority
    )]
    pub keeper: Account<'info, Keeper>,
    pub authority: Signer<'info>,
}

/// One kept promise. The steps run in exactly the order of the spec; see step 5/6.
pub fn handle_check_in(
    ctx: Context<CheckIn>,
    quest_slot: u8,
    tier: Tier,
    proven: bool,
    proof_hash: [u8; 32],
) -> Result<()> {
    let keeper = &mut ctx.accounts.keeper;

    // 1. Today, in the Keeper's local time.
    let today = local_day(Clock::get()?.unix_timestamp, keeper.tz_offset_minutes);

    // 2. Roll the daily counters if the day changed.
    if keeper.xp_today_day != today {
        keeper.xp_today = 0;
        keeper.today_mask = 0;
        keeper.xp_today_day = today;
    }

    // 3. Slot must be valid and not already kept today.
    require!(quest_slot < QUEST_SLOTS, KeptError::InvalidSlot);
    let bit = 1u8 << quest_slot;
    require!(keeper.today_mask & bit == 0, KeptError::AlreadyKeptToday);

    // 4. Award, clamped to what is left of today's cap.
    let base = tier.base_xp();
    let gross = if proven { base } else { base / DECLARED_XP_DIVISOR };
    let remaining = DAILY_XP_CAP.saturating_sub(keeper.xp_today);
    let awarded = gross.min(remaining);

    // 5. STREAK: read the mask BEFORE writing to it. If step 6 ran first, first_today
    //    would always be false and the streak would never advance.
    let first_today = keeper.today_mask == 0;
    if first_today {
        if keeper.last_checkin_day == today.saturating_sub(1) {
            keeper.streak_current = keeper.streak_current.saturating_add(1);
        } else if keeper.last_checkin_day != today {
            keeper.streak_current = 1; // broken, or the first check-in ever
        }
        keeper.last_checkin_day = today;
        keeper.streak_best = keeper.streak_best.max(keeper.streak_current);
    }

    // 6. NOW set the bit.
    keeper.today_mask |= bit;

    // 7. Apply. quests_kept_total counts promises, so it increments even when awarded is 0.
    //    Soul comes from `awarded`, not `gross`, so the daily cap limits Soul too.
    keeper.xp_today = keeper.xp_today.checked_add(awarded).ok_or(KeptError::Overflow)?;
    keeper.xp_total = keeper
        .xp_total
        .checked_add(u64::from(awarded))
        .ok_or(KeptError::Overflow)?;
    keeper.quests_kept_total = keeper.quests_kept_total.saturating_add(1);
    keeper.soul_earned = keeper
        .soul_earned
        .checked_add(u64::from(awarded / SOUL_PER_XP))
        .ok_or(KeptError::Overflow)?;

    // 8. The permanent record, including the proof hash.
    emit!(CheckedIn {
        keeper: keeper.key(),
        day: today,
        quest_slot,
        tier: tier as u8,
        proven,
        xp_awarded: awarded,
        xp_total_after: keeper.xp_total,
        streak_after: keeper.streak_current,
        proof_hash,
    });
    Ok(())
}
