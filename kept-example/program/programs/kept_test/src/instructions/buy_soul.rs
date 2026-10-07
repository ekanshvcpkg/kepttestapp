use anchor_lang::prelude::*;

use crate::constants::KEEPER_SEED;
use crate::errors::KeptError;
use crate::events::SoulBought;
use crate::state::Keeper;

#[derive(Accounts)]
pub struct BuySoul<'info> {
    #[account(
        mut,
        seeds = [KEEPER_SEED, authority.key().as_ref()],
        bump = keeper.bump,
        has_one = authority
    )]
    pub keeper: Account<'info, Keeper>,
    pub authority: Signer<'info>,
}

/// Devnet stand-in for a purchase: no payment is taken. Touches `soul_bought` only;
/// never `soul_earned`, XP, or the streak.
pub fn handle_buy_soul(ctx: Context<BuySoul>, amount: u64) -> Result<()> {
    require!(amount > 0, KeptError::ZeroAmount);
    let keeper = &mut ctx.accounts.keeper;
    keeper.soul_bought = keeper.soul_bought.checked_add(amount).ok_or(KeptError::Overflow)?;
    emit!(SoulBought {
        keeper: keeper.key(),
        amount,
        soul_bought_after: keeper.soul_bought,
    });
    Ok(())
}
