use anchor_lang::prelude::*;

use crate::constants::KEEPER_SEED;
use crate::errors::KeptError;
use crate::state::Keeper;

#[derive(Accounts)]
pub struct RecordOath<'info> {
    #[account(
        mut,
        seeds = [KEEPER_SEED, authority.key().as_ref()],
        bump = keeper.bump,
        has_one = authority
    )]
    pub keeper: Account<'info, Keeper>,
    pub authority: Signer<'info>,
}

/// Win/loss record for oaths. Touches only the two oath counters; never XP, Soul or the streak.
pub fn handle_record_oath(ctx: Context<RecordOath>, success: bool) -> Result<()> {
    let keeper = &mut ctx.accounts.keeper;
    let counter = if success { &mut keeper.oaths_completed } else { &mut keeper.oaths_failed };
    *counter = counter.checked_add(1).ok_or(KeptError::Overflow)?;
    Ok(())
}
