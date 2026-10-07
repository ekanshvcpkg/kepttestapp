use crate::constants::{SECONDS_PER_DAY, SECONDS_PER_MINUTE};

/// The ONLY way a day index is computed anywhere in this program.
///
/// `div_euclid`, not `/`: plain integer division rounds toward zero and is wrong for
/// negative values (e.g. -1s would land on day 0 instead of day -1).
pub fn local_day(now_unix: i64, tz_offset_minutes: i16) -> i64 {
    (now_unix + (tz_offset_minutes as i64) * SECONDS_PER_MINUTE).div_euclid(SECONDS_PER_DAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_timestamps_round_down() {
        assert_eq!(local_day(-1, 0), -1);
        assert_eq!(local_day(-SECONDS_PER_DAY, 0), -1);
        assert_eq!(local_day(-SECONDS_PER_DAY - 1, 0), -2);
        assert_eq!(local_day(0, 0), 0);
        assert_eq!(local_day(0, -60), -1);
    }

    #[test]
    fn midnight_at_plus_330() {
        // Local midnight at UTC+5:30 is 18:30 UTC the previous UTC day.
        let midnight = 10 * SECONDS_PER_DAY - 330 * SECONDS_PER_MINUTE;
        assert_eq!(local_day(midnight - 1, 330), 9);
        assert_eq!(local_day(midnight, 330), 10);
        // 05:29 UTC is still local day 10; the day does not roll at 05:30 local.
        assert_eq!(local_day(10 * SECONDS_PER_DAY + 5 * 3_600 + 29 * 60, 330), 10);
    }
}
