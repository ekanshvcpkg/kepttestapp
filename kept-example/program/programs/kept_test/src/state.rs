use anchor_lang::prelude::*;

pub const MAX_MEMBERS: usize = 4;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub stake_mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Keeper {
    pub authority: Pubkey,
    pub current_streak: u16,
    pub best_streak: u16,
    pub oaths_kept: u32,
    pub oaths_missed: u32,
    pub last_kept_day: i64,
    pub bump: u8,
    pub version_tag: [u8; 8],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default, PartialEq, Eq)]
pub struct Member {
    pub authority: Pubkey,
    pub staked: bool,
    pub days_kept: u16,
    pub claimed: bool,
    pub payout: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum OathStatus { Open, Active, Settled, Cancelled }

#[account]
#[derive(InitSpace)]
pub struct Oath {
    pub creator: Pubkey,
    pub oath_id: u64,
    pub stake_amount: u64,
    pub mint: Pubkey,
    pub goal_hash: [u8; 32],
    pub object_id: u8,
    pub num_days: u8,
    pub day_seconds: u32,
    pub start_ts: i64,
    pub tz_offset_minutes: i16,
    pub status: OathStatus,
    pub is_solo: bool,
    pub member_count: u8,
    pub members: [Member; MAX_MEMBERS],
    pub bump: u8,
}
