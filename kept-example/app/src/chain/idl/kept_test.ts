/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kept_test.json`.
 */
export type KeptTest = {
  "address": "6iXXBqsdiCnUTSVf8CW3Uuw8c7iYvZSj5haz64QMuMUh",
  "metadata": {
    "name": "keptTest",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "kept backend test: Keeper XP, streak and Soul on Solana"
  },
  "instructions": [
    {
      "name": "cancelOath",
      "discriminator": [
        221,
        106,
        221,
        70,
        20,
        240,
        219,
        24
      ],
      "accounts": [
        {
          "name": "oath",
          "writable": true
        },
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "oath"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "oath",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "oath"
              }
            ]
          }
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "member",
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createOath",
      "discriminator": [
        18,
        53,
        143,
        138,
        106,
        66,
        255,
        195
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "oath",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  97,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "oathId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "oath"
              }
            ]
          }
        },
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
                "path": "creator"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "treasury"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "oathId",
          "type": "u64"
        },
        {
          "name": "goalHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "objectId",
          "type": "u8"
        },
        {
          "name": "numDays",
          "type": "u8"
        },
        {
          "name": "daySeconds",
          "type": "u32"
        },
        {
          "name": "tzOffsetMinutes",
          "type": "i16"
        },
        {
          "name": "stakeAmount",
          "type": "u64"
        },
        {
          "name": "isSolo",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  237,
                  193,
                  229,
                  43,
                  49,
                  50,
                  194,
                  159,
                  15,
                  109,
                  76,
                  51,
                  160,
                  166,
                  94,
                  45,
                  125,
                  204,
                  239,
                  48,
                  52,
                  53,
                  111,
                  49,
                  226,
                  172,
                  20,
                  149,
                  115,
                  142,
                  22
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                2,
                168,
                246,
                145,
                78,
                136,
                161,
                176,
                226,
                16,
                21,
                62,
                247,
                99,
                174,
                43,
                0,
                194,
                185,
                61,
                22,
                193,
                36,
                210,
                192,
                83,
                122,
                16,
                4,
                128,
                0,
                0
              ]
            }
          }
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "verifier",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "joinOath",
      "discriminator": [
        108,
        162,
        4,
        168,
        242,
        190,
        203,
        191
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "oath",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "oath"
              }
            ]
          }
        },
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
                "path": "member"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "signer": true
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "memberToken",
          "writable": true
        },
        {
          "name": "treasury"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "migrateKeeper",
      "docs": [
        "Converts a pre-V4 Keeper account in place; its old XP/Soul fields are no longer used."
      ],
      "discriminator": [
        132,
        129,
        186,
        90,
        209,
        51,
        144,
        167
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
      "args": []
    },
    {
      "name": "recordCheckin",
      "discriminator": [
        118,
        204,
        183,
        163,
        118,
        202,
        223,
        127
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "oath",
          "writable": true
        },
        {
          "name": "verifier",
          "signer": true
        },
        {
          "name": "member"
        }
      ],
      "args": [
        {
          "name": "dayIndex",
          "type": "u8"
        },
        {
          "name": "proofHash",
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
      "name": "settleOath",
      "discriminator": [
        130,
        224,
        126,
        34,
        251,
        193,
        4,
        15
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "oath",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "oath"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "startOath",
      "discriminator": [
        57,
        92,
        72,
        166,
        98,
        62,
        238,
        44
      ],
      "accounts": [
        {
          "name": "oath",
          "writable": true
        },
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "oath"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateTreasury",
      "docs": [
        "Move future protocol fees and rounding dust to a new Token or Token-2022 account.",
        "The configured admin must authorize the change; the mint cannot change here."
      ],
      "discriminator": [
        60,
        16,
        243,
        66,
        96,
        59,
        254,
        131
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "stakeMint"
        },
        {
          "name": "treasury"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "keeper",
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
    },
    {
      "name": "oath",
      "discriminator": [
        222,
        97,
        48,
        50,
        185,
        60,
        175,
        24
      ]
    }
  ],
  "events": [
    {
      "name": "checkinRecorded",
      "discriminator": [
        85,
        10,
        179,
        25,
        115,
        87,
        108,
        127
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "oathCancelled",
      "discriminator": [
        95,
        188,
        253,
        104,
        86,
        243,
        228,
        77
      ]
    },
    {
      "name": "oathCreated",
      "discriminator": [
        165,
        157,
        51,
        209,
        94,
        123,
        115,
        117
      ]
    },
    {
      "name": "oathJoined",
      "discriminator": [
        128,
        108,
        65,
        75,
        60,
        224,
        197,
        138
      ]
    },
    {
      "name": "oathSettled",
      "discriminator": [
        23,
        34,
        180,
        114,
        77,
        200,
        168,
        138
      ]
    },
    {
      "name": "oathStarted",
      "discriminator": [
        66,
        37,
        42,
        239,
        71,
        76,
        98,
        25
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidFee",
      "msg": "Fee basis points must be at most 10000"
    },
    {
      "code": 6001,
      "name": "wrongAdmin",
      "msg": "Only the program upgrade authority may initialize Config"
    },
    {
      "code": 6002,
      "name": "invalidDays",
      "msg": "Invalid oath duration"
    },
    {
      "code": 6003,
      "name": "invalidObject",
      "msg": "Object id is not in the supported object list"
    },
    {
      "code": 6004,
      "name": "invalidTimezoneOffset",
      "msg": "Timezone offset must be UTC-12 through UTC+14"
    },
    {
      "code": 6005,
      "name": "invalidDayLength",
      "msg": "Day length must be positive"
    },
    {
      "code": 6006,
      "name": "wrongMint",
      "msg": "Stake mint does not match config or oath"
    },
    {
      "code": 6007,
      "name": "wrongTreasury",
      "msg": "Treasury token account does not match config"
    },
    {
      "code": 6008,
      "name": "invalidStake",
      "msg": "Invalid solo or group stake configuration"
    },
    {
      "code": 6009,
      "name": "notOpen",
      "msg": "Oath is not open"
    },
    {
      "code": 6010,
      "name": "soloOath",
      "msg": "Oath is solo and cannot be joined"
    },
    {
      "code": 6011,
      "name": "full",
      "msg": "Oath has four members already"
    },
    {
      "code": 6012,
      "name": "alreadyMember",
      "msg": "Wallet is already a member"
    },
    {
      "code": 6013,
      "name": "needsMember",
      "msg": "Group Oath needs at least one other member"
    },
    {
      "code": 6014,
      "name": "wrongVerifier",
      "msg": "Only configured verifier can record check-ins"
    },
    {
      "code": 6015,
      "name": "notActive",
      "msg": "Oath is not active"
    },
    {
      "code": 6016,
      "name": "invalidDay",
      "msg": "Day index outside oath duration"
    },
    {
      "code": 6017,
      "name": "dayNotStarted",
      "msg": "Check-in day has not started"
    },
    {
      "code": 6018,
      "name": "dayEnded",
      "msg": "Check-in day has ended"
    },
    {
      "code": 6019,
      "name": "notMember",
      "msg": "Wallet is not an Oath member"
    },
    {
      "code": 6020,
      "name": "duplicateCheckin",
      "msg": "Check-in already recorded"
    },
    {
      "code": 6021,
      "name": "tooEarly",
      "msg": "Oath cannot settle yet"
    },
    {
      "code": 6022,
      "name": "keeperAccountsMissing",
      "msg": "Missing Keeper account for a member"
    },
    {
      "code": 6023,
      "name": "badKeeper",
      "msg": "Bad Keeper account supplied"
    },
    {
      "code": 6024,
      "name": "vaultUnderfunded",
      "msg": "Vault does not cover calculated payouts"
    },
    {
      "code": 6025,
      "name": "badVault",
      "msg": "Vault authority or mint is invalid"
    },
    {
      "code": 6026,
      "name": "badOath",
      "msg": "Oath account data is invalid"
    },
    {
      "code": 6027,
      "name": "notSettled",
      "msg": "Oath is not settled or cancelled"
    },
    {
      "code": 6028,
      "name": "alreadyClaimed",
      "msg": "Payout already claimed"
    },
    {
      "code": 6029,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "checkinRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          },
          {
            "name": "member",
            "type": "pubkey"
          },
          {
            "name": "dayIndex",
            "type": "u8"
          },
          {
            "name": "proofHash",
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
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          },
          {
            "name": "member",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "stakeMint",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "keeper",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "currentStreak",
            "type": "u16"
          },
          {
            "name": "bestStreak",
            "type": "u16"
          },
          {
            "name": "oathsKept",
            "type": "u32"
          },
          {
            "name": "oathsMissed",
            "type": "u32"
          },
          {
            "name": "lastKeptDay",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "versionTag",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    },
    {
      "name": "member",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "staked",
            "type": "bool"
          },
          {
            "name": "daysKept",
            "type": "u16"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "oath",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "oathId",
            "type": "u64"
          },
          {
            "name": "stakeAmount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "goalHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "objectId",
            "type": "u8"
          },
          {
            "name": "numDays",
            "type": "u8"
          },
          {
            "name": "daySeconds",
            "type": "u32"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "tzOffsetMinutes",
            "type": "i16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "oathStatus"
              }
            }
          },
          {
            "name": "isSolo",
            "type": "bool"
          },
          {
            "name": "memberCount",
            "type": "u8"
          },
          {
            "name": "members",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "member"
                  }
                },
                4
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "oathCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "oathCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "oathId",
            "type": "u64"
          },
          {
            "name": "isSolo",
            "type": "bool"
          },
          {
            "name": "stakeAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "oathJoined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          },
          {
            "name": "member",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "oathSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "oathStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oath",
            "type": "pubkey"
          },
          {
            "name": "startTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "oathStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "active"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    }
  ]
};
