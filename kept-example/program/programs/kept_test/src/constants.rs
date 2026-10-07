//! Every tunable number in the program. No number appears anywhere else.

/// PDA seed for a Keeper: `[KEEPER_SEED, authority]`.
pub const KEEPER_SEED: &[u8] = b"keeper";

/// Quest slots per Keeper, one bit each in `today_mask` (u8).
pub const QUEST_SLOTS: u8 = 8;

/// Base XP per tier, indexed by `Tier as usize`: Easy, Normal, Hard, Epic.
pub const TIER_XP: [u16; 4] = [50, 100, 150, 250];

/// Declared (unproven) check-ins earn base XP divided by this.
pub const DECLARED_XP_DIVISOR: u16 = 2;

/// Most XP a Keeper can earn in one local day.
pub const DAILY_XP_CAP: u16 = 600;

/// XP per 1 Soul earned.
pub const SOUL_PER_XP: u16 = 10;

/// Sentinel day index meaning "never".
pub const NEVER_DAY: i64 = i64::MIN;

pub const SECONDS_PER_MINUTE: i64 = 60;
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Real-world timezone range accepted by `init_keeper`: UTC-12:00 .. UTC+14:00.
pub const MIN_TZ_OFFSET_MINUTES: i16 = -720;
pub const MAX_TZ_OFFSET_MINUTES: i16 = 840;

/// Minutes in one day; `debug_shift_day` moves the offset by this per day shifted.
pub const MINUTES_PER_DAY: i16 = 1_440;

/// Bytes reserved at the end of the Keeper for future fields.
pub const KEEPER_RESERVED_BYTES: usize = 28;
