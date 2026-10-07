use anchor_lang::prelude::*;

/// The permanent record of a kept promise. The proof hash lives here and in the
/// instruction arguments, never in account state.
#[event]
pub struct CheckedIn {
    pub keeper: Pubkey,
    pub day: i64,
    pub quest_slot: u8,
    pub tier: u8,
    pub proven: bool,
    pub xp_awarded: u16,
    pub xp_total_after: u64,
    pub streak_after: u16,
    pub proof_hash: [u8; 32],
}

#[event]
pub struct SoulBought {
    pub keeper: Pubkey,
    pub amount: u64,
    pub soul_bought_after: u64,
}

#[event]
pub struct DayShifted {
    pub keeper: Pubkey,
    pub days: i16,
    pub tz_offset_minutes_after: i16,
}
