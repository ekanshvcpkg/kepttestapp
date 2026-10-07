use anchor_lang::prelude::*;

use crate::constants::{KEEPER_SEED, MINUTES_PER_DAY};
use crate::errors::KeptError;
use crate::events::DayShifted;
use crate::state::Keeper;

#[derive(Accounts)]
pub struct DebugShiftDay<'info> {
    #[account(
        mut,
        seeds = [KEEPER_SEED, authority.key().as_ref()],
        bump = keeper.bump,
        has_one = authority
    )]
    pub keeper: Account<'info, Keeper>,
    pub authority: Signer<'info>,
}

/// DEBUG ONLY (feature `debug-tools`). Moves the Keeper's local day by `days` by shifting
/// `tz_offset_minutes` by `days * 1440`, so a day boundary can be crossed on a real device.
/// Never ship this: a user-settable offset lets anyone farm streaks and the daily cap.
pub fn handle_debug_shift_day(ctx: Context<DebugShiftDay>, days: i16) -> Result<()> {
    let keeper = &mut ctx.accounts.keeper;
    let delta = days.checked_mul(MINUTES_PER_DAY).ok_or(KeptError::Overflow)?;
    keeper.tz_offset_minutes = keeper
        .tz_offset_minutes
        .checked_add(delta)
        .ok_or(KeptError::Overflow)?;
    emit!(DayShifted {
        keeper: keeper.key(),
        days,
        tz_offset_minutes_after: keeper.tz_offset_minutes,
    });
    Ok(())
}
