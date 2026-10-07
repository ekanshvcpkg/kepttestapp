use anchor_lang::prelude::*;

use crate::constants::{
    KEEPER_RESERVED_BYTES, KEEPER_SEED, MAX_TZ_OFFSET_MINUTES, MIN_TZ_OFFSET_MINUTES, NEVER_DAY,
};
use crate::errors::KeptError;
use crate::state::Keeper;

#[derive(Accounts)]
pub struct InitKeeper<'info> {
    /// `init` fails if this Keeper already exists.
    #[account(
        init,
        payer = authority,
        space = 8 + Keeper::INIT_SPACE,
        seeds = [KEEPER_SEED, authority.key().as_ref()],
        bump
    )]
    pub keeper: Account<'info, Keeper>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Creates the signer's Keeper. Everything zero except the timezone, the bump, and the
/// "never" day sentinels.
pub fn handle_init_keeper(ctx: Context<InitKeeper>, tz_offset_minutes: i16) -> Result<()> {
    require!(
        (MIN_TZ_OFFSET_MINUTES..=MAX_TZ_OFFSET_MINUTES).contains(&tz_offset_minutes),
        KeptError::InvalidTimezoneOffset
    );

    ctx.accounts.keeper.set_inner(Keeper {
        authority: ctx.accounts.authority.key(),
        xp_total: 0,
        quests_kept_total: 0,
        streak_current: 0,
        streak_best: 0,
        last_checkin_day: NEVER_DAY,
        today_mask: 0,
        xp_today: 0,
        // Also "never", so the first check-in always rolls the daily counters.
        xp_today_day: NEVER_DAY,
        soul_earned: 0,
        soul_bought: 0,
        tz_offset_minutes,
        bump: ctx.bumps.keeper,
        oaths_completed: 0,
        oaths_failed: 0,
        _reserved: [0; KEEPER_RESERVED_BYTES],
    });
    Ok(())
}
