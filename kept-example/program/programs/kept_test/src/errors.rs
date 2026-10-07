use anchor_lang::prelude::*;

#[error_code]
pub enum KeptError {
    #[msg("Quest slot must be 0-7")]
    InvalidSlot,
    #[msg("This quest slot was already kept today")]
    AlreadyKeptToday,
    #[msg("Timezone offset must be between -720 and +840 minutes")]
    InvalidTimezoneOffset,
    #[msg("Soul amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
}
