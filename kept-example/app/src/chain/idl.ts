export const IDL =
{
  "address": "6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh",
  "metadata": {
    "name": "kept_test",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "kept backend test: Keeper XP, streak and Soul on Solana"
  },
  "instructions": [
    {
      "name": "buy_soul",
      "discriminator": [
        131,
        166,
        212,
        188,
        145,
        190,
        179,
        38
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "keeper"
          ]
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "check_in",
      "discriminator": [
        209,
        253,
        4,
        217,
        250,
        241,
        207,
        50
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "keeper"
          ]
        }
      ],
      "args": [
        {
          "name": "quest_slot",
          "type": "u8"
        },
        {
          "name": "tier",
          "type": {
            "defined": {
              "name": "Tier"
            }
          }
        },
        {
          "name": "proven",
          "type": "bool"
        },
        {
          "name": "proof_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "debug_shift_day",
      "discriminator": [
        240,
        220,
        241,
        236,
        116,
        155,
        161,
        204
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "keeper"
          ]
        }
      ],
      "args": [
        {
          "name": "days",
          "type": "i16"
        }
      ]
    },
    {
      "name": "init_keeper",
      "discriminator": [
        157,
        247,
        141,
        221,
        166,
        211,
        227,
        101
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "`init` fails if this Keeper already exists."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  101,
                  101,
                  112,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tz_offset_minutes",
          "type": "i16"
        }
      ]
    },
    {
      "name": "record_oath",
      "discriminator": [
        130,
        182,
        112,
        5,
        82,
        200,
        102,
        104
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "keeper"
          ]
        }
      ],
      "args": [
        {
          "name": "success",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Keeper",
      "discriminator": [
        127,
        221,
        194,
        46,
        120,
        73,
        144,
        77
      ]
    }
  ],
  "events": [
    {
      "name": "CheckedIn",
      "discriminator": [
        211,
        80,
        198,
        244,
        196,
        84,
        212,
        150
      ]
    },
    {
      "name": "DayShifted",
      "discriminator": [
        66,
        133,
        68,
        164,
        209,
        140,
        55,
        126
      ]
    },
    {
      "name": "OathRecorded",
      "discriminator": [
        146,
        160,
        248,
        46,
        205,
        171,
        191,
        45
      ]
    },
    {
      "name": "SoulBought",
      "discriminator": [
        169,
        228,
        80,
        202,
        92,
        153,
        50,
        168
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidSlot",
      "msg": "Quest slot must be 0-7"
    },
    {
      "code": 6001,
      "name": "AlreadyKeptToday",
      "msg": "This quest slot was already kept today"
    },
    {
      "code": 6002,
      "name": "InvalidTimezoneOffset",
      "msg": "Timezone offset must be between -720 and +840 minutes"
    },
    {
      "code": 6003,
      "name": "ZeroAmount",
      "msg": "Soul amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "Overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "CheckedIn",
      "docs": [
        "The permanent record of a kept promise. The proof hash lives here and in the",
        "instruction arguments, never in account state."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "day",
            "type": "i64"
          },
          {
            "name": "quest_slot",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "proven",
            "type": "bool"
          },
          {
            "name": "xp_awarded",
            "type": "u16"
          },
          {
            "name": "xp_total_after",
            "type": "u64"
          },
          {
            "name": "streak_after",
            "type": "u16"
          },
          {
            "name": "proof_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "DayShifted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "days",
            "type": "i16"
          },
          {
            "name": "tz_offset_minutes_after",
            "type": "i16"
          }
        ]
      }
    },
    {
      "name": "Keeper",
      "docs": [
        "One per wallet. PDA: `[b\"keeper\", authority]`.",
        "",
        "Stores only what cannot be recomputed. Level and Rank are pure functions of `xp_total`",
        "computed in the app (`app/src/progress/curve.ts`). Photos, comments and proof hashes are",
        "never stored."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "xp_total",
            "type": "u64"
          },
          {
            "name": "quests_kept_total",
            "type": "u32"
          },
          {
            "name": "streak_current",
            "type": "u16"
          },
          {
            "name": "streak_best",
            "type": "u16"
          },
          {
            "name": "last_checkin_day",
            "type": "i64"
          },
          {
            "name": "today_mask",
            "type": "u8"
          },
          {
            "name": "xp_today",
            "type": "u16"
          },
          {
            "name": "xp_today_day",
            "type": "i64"
          },
          {
            "name": "soul_earned",
            "type": "u64"
          },
          {
            "name": "soul_bought",
            "type": "u64"
          },
          {
            "name": "tz_offset_minutes",
            "type": "i16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "oaths_completed",
            "type": "u16"
          },
          {
            "name": "oaths_failed",
            "type": "u16"
          },
          {
            "name": "_reserved",
            "type": {
              "array": [
                "u8",
                28
              ]
            }
          }
        ]
      }
    },
    {
      "name": "OathRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "success",
            "type": "bool"
          },
          {
            "name": "oaths_completed",
            "type": "u16"
          },
          {
            "name": "oaths_failed",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "SoulBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "soul_bought_after",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Tier",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Easy"
          },
          {
            "name": "Normal"
          },
          {
            "name": "Hard"
          },
          {
            "name": "Epic"
          }
        ]
      }
    }
  ]
} as const;
