-- Canonical payload v5: one-time conversion, archive, then canonical-only writes.
-- Self-contained deployment; canonical JSON Schema source: opportunity_schema_v5.json.
begin;
set local lock_timeout='10s';
set local statement_timeout='180s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('opportunity-search-catalogue-v1',0));
lock table public.opportunities, public.opportunity_search_runs, public.opportunity_reviews, public.applications in share mode;

do $$ begin
 if exists(select 1 from public.opportunity_search_runs where status='running') then raise exception 'Finish active search runs before canonical migration.'; end if;
 if (select active_protocol_version from private.opportunity_search_settings where singleton)<>'opportunity-search-v1-merge-4' then raise exception 'Expected the reviewed v4 installation.'; end if;
end $$;

create table private.opportunity_payload_releases (
 release text primary key,
 previous_protocol text not null,
 scale_confirmation text not null,
 before_functions jsonb not null,
 before_checks jsonb not null,
 before_defaults jsonb not null,
 before_identities jsonb not null,
 after_identities jsonb,
 dependent_context_checksum text not null,
 before_checksum text not null,
 after_checksum text,
 record_count integer not null,
 migrated_at timestamptz not null default clock_timestamp(),
 rolled_back_at timestamptz
);
create table private.opportunity_payload_archive (
 release text not null references private.opportunity_payload_releases(release) on delete restrict,
 opportunity_id uuid not null references public.opportunities(id) on delete restrict,
 before_snapshot jsonb not null,
 after_snapshot jsonb,
 before_state jsonb,
 after_state jsonb,
 primary key(release,opportunity_id)
);
create index opportunity_payload_archive_opportunity on private.opportunity_payload_archive(opportunity_id);
alter table private.opportunity_payload_releases enable row level security;
alter table private.opportunity_payload_archive enable row level security;
revoke all on private.opportunity_payload_releases,private.opportunity_payload_archive from public,anon,authenticated;

create function private.opportunity_context_checksum() returns text language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
   'reviews',(select coalesce(jsonb_agg(to_jsonb(r) order by user_id,opportunity_id),'[]') from public.opportunity_reviews r),
   'applications',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.applications a))::text,'UTF8')),'hex')
$$;

insert into private.opportunity_payload_releases(release,previous_protocol,scale_confirmation,before_functions,before_checks,before_defaults,before_identities,dependent_context_checksum,before_checksum,record_count)
select 'canonical-opportunity-v5',active_protocol_version,'The workspace owner confirmed that all existing ratings use a 0–10 scale (2026-10-28).',
 (select jsonb_agg(jsonb_build_object('name',p.proname,'signature',format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),'definition',pg_get_functiondef(p.oid),
   'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantable',a.is_grantable)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where privilege_type='EXECUTE'))
   order by case when p.proname='opportunity_merge_input_schema_v3' then 0 when p.proname='opportunity_search_result_schema' then 1 else 2 end,p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and (p.proname like 'opportunity_merge_%' or p.proname like '%opportunity%search%')) or (n.nspname='public' and p.proname='opportunity_search_readiness')),
 (select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid))),'[]') from pg_constraint where conrelid='public.opportunities'::regclass and contype='c' and pg_get_constraintdef(oid)~'(personal_fit|rd_career_potential|research_career_potential)'),
 (select jsonb_agg(jsonb_build_object('name',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid))) from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.opportunities'::regclass and a.attname=any(array['metadata_schema_version','personal_fit','rd_career_potential','research_career_potential'])),
 (select coalesce(jsonb_agg(to_jsonb(i) order by identity_key),'[]') from private.opportunity_search_identities i),
 private.opportunity_context_checksum(),
 (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.opportunities o),
 (select count(*) from public.opportunities)
from private.opportunity_search_settings where singleton;
insert into private.opportunity_payload_archive(release,opportunity_id,before_snapshot,before_state)
 select 'canonical-opportunity-v5',o.id,to_jsonb(o),s.fields from public.opportunities o left join private.opportunity_search_merge_state s on s.opportunity_id=o.id;

create function private.opportunity_storage_schema() returns jsonb language sql immutable set search_path='' as $body$ select $schema${
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Canonical opportunity payload v5",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "vacancy_id": {
      "type": [
        "string",
        "null"
      ]
    },
    "institution": {
      "type": [
        "string",
        "null"
      ]
    },
    "unit": {
      "type": [
        "string",
        "null"
      ]
    },
    "city": {
      "type": [
        "string",
        "null"
      ]
    },
    "country": {
      "type": [
        "string",
        "null"
      ]
    },
    "position_type": {
      "type": [
        "string",
        "null"
      ]
    },
    "availability": {
      "type": [
        "string",
        "null"
      ]
    },
    "deadline_original_text": {
      "type": [
        "string",
        "null"
      ]
    },
    "research_summary": {
      "type": [
        "string",
        "null"
      ]
    },
    "duration_details": {
      "type": [
        "string",
        "null"
      ]
    },
    "particularly_suitable_reason": {
      "type": [
        "string",
        "null"
      ]
    },
    "source_context": {
      "type": [
        "string",
        "null"
      ]
    },
    "opportunity_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    },
    "verification_level": {
      "type": "string"
    },
    "official_url": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^https?://[^\\s]+$"
    },
    "source_url": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^https?://[^\\s]+$"
    },
    "application_url": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^(https?://[^\\s]+|mailto:[^\\s@?]+@[^\\s@?]+(?:\\?[^\\s]*)?)$"
    },
    "deadline": {
      "type": [
        "string",
        "null"
      ],
      "format": "date"
    },
    "start_date": {
      "type": [
        "string",
        "null"
      ],
      "format": "date"
    },
    "deadline_time_local": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"
    },
    "deadline_timezone": {
      "type": [
        "string",
        "null"
      ],
      "format": "opportunity-timezone"
    },
    "topics": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "special_features": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "open_questions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "supervisors": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/person"
      }
    },
    "contacts": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/person"
      }
    },
    "requirements": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/checklist"
      }
    },
    "required_documents": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/checklist"
      }
    },
    "supervisor_research_focus": {
      "$ref": "#/$defs/focus"
    },
    "supervisor_top_papers": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/paper"
      }
    },
    "salary": {
      "$ref": "#/$defs/salary"
    },
    "supervisor_reputation": {
      "$ref": "#/$defs/background"
    },
    "hardware_software_balance": {
      "$ref": "#/$defs/balance"
    },
    "personal_fit": {
      "$ref": "#/$defs/assessment"
    },
    "rd_career_potential": {
      "$ref": "#/$defs/assessment"
    },
    "research_career_potential": {
      "$ref": "#/$defs/assessment"
    },
    "particularly_suitable": {
      "type": [
        "boolean",
        "null"
      ]
    },
    "data": {
      "$ref": "#/$defs/data"
    },
    "last_checked_at": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "sources": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/source"
      }
    }
  },
  "required": [
    "opportunity_key",
    "title",
    "last_checked_at",
    "sources"
  ],
  "$defs": {
    "fact": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "label": {
          "type": "string",
          "minLength": 1
        },
        "text": {
          "type": "string",
          "minLength": 1
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        }
      },
      "required": [
        "label",
        "text"
      ]
    },
    "verification": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "identity_verified": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "role_verified": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "supervision_confirmed": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      }
    },
    "person": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entity_id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": [
            "string",
            "null"
          ]
        },
        "email": {
          "type": [
            "string",
            "null"
          ]
        },
        "orcid": {
          "type": [
            "string",
            "null"
          ]
        },
        "phone": {
          "type": [
            "string",
            "null"
          ]
        },
        "institution": {
          "type": [
            "string",
            "null"
          ]
        },
        "roles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "verification": {
          "$ref": "#/$defs/verification"
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "entity_id",
        "roles"
      ]
    },
    "checklist": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entity_id": {
          "type": "string",
          "minLength": 1
        },
        "text": {
          "type": "string",
          "minLength": 1
        },
        "status": {
          "type": "string",
          "enum": [
            "required",
            "optional",
            "conditional",
            "preferred",
            "recommended",
            "desired",
            "advantageous",
            "unspecified"
          ]
        },
        "stage": {
          "type": "string",
          "enum": [
            "unspecified",
            "recruitment",
            "doctoral_admission",
            "after_selection",
            "interview",
            "offer",
            "enrolment",
            "other"
          ]
        },
        "conditions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "max_pages": {
          "type": [
            "number",
            "null"
          ]
        },
        "max_words": {
          "type": [
            "number",
            "null"
          ]
        },
        "file_formats": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "entity_id",
        "text",
        "status",
        "stage"
      ]
    },
    "paper": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entity_id": {
          "type": "string",
          "minLength": 1
        },
        "title": {
          "type": [
            "string",
            "null"
          ]
        },
        "doi": {
          "type": [
            "string",
            "null"
          ]
        },
        "url": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^https?://[^\\s]+$"
        },
        "year": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 1000,
          "maximum": 2200
        },
        "venue": {
          "type": [
            "string",
            "null"
          ]
        },
        "authors": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "supervisors": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "selection_basis": {
          "type": [
            "string",
            "null"
          ]
        },
        "relevance": {
          "type": [
            "string",
            "null"
          ]
        },
        "checked_at": {
          "type": [
            "string",
            "null"
          ]
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "entity_id"
      ]
    },
    "focus_profile": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entity_id": {
          "type": "string",
          "minLength": 1
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "researcher_id": {
          "type": [
            "string",
            "null"
          ]
        },
        "summary": {
          "type": [
            "string",
            "null"
          ]
        },
        "topics": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "methods": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "checked_at": {
          "type": [
            "string",
            "null"
          ]
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "entity_id",
        "name"
      ]
    },
    "focus": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "profiles": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/focus_profile"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      }
    },
    "money_component": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entity_id": {
          "type": "string",
          "minLength": 1
        },
        "label": {
          "type": "string",
          "minLength": 1
        },
        "amount": {
          "type": [
            "number",
            "null"
          ]
        },
        "min": {
          "type": [
            "number",
            "null"
          ]
        },
        "max": {
          "type": [
            "number",
            "null"
          ]
        },
        "currency": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Z]{3}$"
        },
        "period": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "hour",
            "day",
            "week",
            "month",
            "year",
            "contract",
            null
          ]
        },
        "gross": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "model": {
          "type": [
            "string",
            "null"
          ]
        },
        "condition": {
          "type": [
            "string",
            "null"
          ]
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "entity_id",
        "label"
      ]
    },
    "salary": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "amount": {
          "type": [
            "number",
            "null"
          ]
        },
        "min": {
          "type": [
            "number",
            "null"
          ]
        },
        "max": {
          "type": [
            "number",
            "null"
          ]
        },
        "currency": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Z]{3}$"
        },
        "period": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "hour",
            "day",
            "week",
            "month",
            "year",
            "contract",
            null
          ]
        },
        "gross": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "model": {
          "type": [
            "string",
            "null"
          ]
        },
        "details": {
          "type": [
            "string",
            "null"
          ]
        },
        "components": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/money_component"
          }
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      }
    },
    "assessment": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "score": {
          "type": [
            "number",
            "null"
          ],
          "minimum": 0,
          "maximum": 10
        },
        "scale_min": {
          "type": "number",
          "const": 0
        },
        "scale_max": {
          "type": "number",
          "const": 10
        },
        "summary": {
          "type": [
            "string",
            "null"
          ]
        },
        "subscores": {
          "type": "object",
          "additionalProperties": {
            "type": "number",
            "minimum": 0,
            "maximum": 10
          }
        },
        "gaps": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "score",
        "scale_min",
        "scale_max",
        "summary"
      ],
      "anyOf": [
        {
          "properties": {
            "score": {
              "type": "number"
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "pattern": "\\S"
            }
          }
        },
        {
          "properties": {
            "score": {
              "const": null
            }
          }
        }
      ]
    },
    "background": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "summary": {
          "type": [
            "string",
            "null"
          ]
        },
        "evidence": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "limitations": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "source_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://[^\\s]+$"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      }
    },
    "balance": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "classification": {
          "type": [
            "string",
            "null"
          ]
        },
        "summary": {
          "type": [
            "string",
            "null"
          ]
        },
        "details": {
          "type": [
            "string",
            "null"
          ]
        },
        "hardware": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "software": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      }
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "source_id": {
          "type": "string",
          "minLength": 1
        },
        "url": {
          "type": "string",
          "pattern": "^https?://[^\\s]+$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "official",
            "official_listing",
            "institution",
            "graduate_school",
            "discovery",
            "unknown"
          ]
        },
        "checked_at": {
          "type": [
            "string",
            "null"
          ]
        },
        "precision": {
          "type": "string",
          "enum": [
            "instant",
            "date",
            "unknown"
          ]
        },
        "supports": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "source_id",
        "url",
        "kind",
        "checked_at",
        "precision",
        "supports"
      ],
      "anyOf": [
        {
          "properties": {
            "precision": {
              "const": "instant"
            },
            "checked_at": {
              "type": "string",
              "format": "date-time"
            }
          }
        },
        {
          "properties": {
            "precision": {
              "const": "date"
            },
            "checked_at": {
              "type": "string",
              "format": "date"
            }
          }
        },
        {
          "properties": {
            "precision": {
              "const": "unknown"
            },
            "checked_at": {
              "const": null
            }
          }
        }
      ]
    },
    "living_standard": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "version": {
          "const": 1
        },
        "housing_baseline": {
          "type": "string",
          "enum": [
            "shared_flat",
            "private_apartment"
          ]
        },
        "assessed_at": {
          "type": "string",
          "format": "date"
        },
        "confidence": {
          "type": "string",
          "enum": [
            "low",
            "medium",
            "high"
          ]
        },
        "summary": {
          "type": "string"
        },
        "salary_basis": {
          "type": "string"
        },
        "budget_basis": {
          "type": "string"
        },
        "funding_note": {
          "type": "string"
        },
        "factors": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "affordability": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "score": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "minimum": 0,
                  "maximum": 10
                },
                "reason": {
                  "type": "string"
                }
              },
              "required": [
                "score",
                "reason"
              ]
            },
            "housing": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "score": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "minimum": 0,
                  "maximum": 10
                },
                "reason": {
                  "type": "string"
                }
              },
              "required": [
                "score",
                "reason"
              ]
            },
            "culture": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "score": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "minimum": 0,
                  "maximum": 10
                },
                "reason": {
                  "type": "string"
                }
              },
              "required": [
                "score",
                "reason"
              ]
            },
            "nature": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "score": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "minimum": 0,
                  "maximum": 10
                },
                "reason": {
                  "type": "string"
                }
              },
              "required": [
                "score",
                "reason"
              ]
            },
            "student_life": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "score": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "minimum": 0,
                  "maximum": 10
                },
                "reason": {
                  "type": "string"
                }
              },
              "required": [
                "score",
                "reason"
              ]
            },
            "climate": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "score": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "minimum": 0,
                  "maximum": 10
                },
                "reason": {
                  "type": "string"
                }
              },
              "required": [
                "score",
                "reason"
              ]
            }
          },
          "required": [
            "affordability",
            "housing",
            "culture",
            "nature",
            "student_life",
            "climate"
          ]
        },
        "sources": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "title": {
                "type": "string"
              },
              "url": {
                "type": "string",
                "pattern": "^https?://[^\\s]+$"
              }
            },
            "required": [
              "title",
              "url"
            ]
          }
        }
      },
      "required": [
        "version",
        "housing_baseline",
        "assessed_at",
        "confidence",
        "summary",
        "salary_basis",
        "budget_basis",
        "factors",
        "sources"
      ]
    },
    "teaching": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "specified",
            "not_specified",
            "unknown"
          ]
        },
        "details": {
          "type": [
            "string",
            "null"
          ]
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      },
      "required": [
        "status"
      ]
    },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "research_methods": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "teaching_load": {
          "$ref": "#/$defs/teaching"
        },
        "living_standard": {
          "$ref": "#/$defs/living_standard"
        },
        "url_roles": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "official_url": {
              "type": "string",
              "enum": [
                "vacancy",
                "listing",
                "application_portal",
                "context",
                "unknown"
              ]
            },
            "source_url": {
              "type": "string",
              "enum": [
                "vacancy",
                "listing",
                "application_portal",
                "context",
                "unknown"
              ]
            },
            "application_url": {
              "type": "string",
              "enum": [
                "vacancy",
                "listing",
                "application_portal",
                "context",
                "unknown"
              ]
            }
          }
        },
        "research_context": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        },
        "application_process": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        },
        "funding": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        },
        "start_details": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        },
        "provenance": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/fact"
          }
        }
      }
    }
  },
  "x-canonical-version": 5,
  "x-server-generated": [
    "entity_id",
    "source_id"
  ]
}$schema$::jsonb $body$;

create function private.opportunity_payload_schema_valid(v jsonb,s jsonb,root_schema jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare k text; child jsonb; expected jsonb; kind text:=jsonb_typeof(v); value text:=v#>>'{}'; valid boolean; path text[];
begin
 if s?'$ref' then
   if s->>'$ref' not like '#/%' then return false; end if;
   path:=string_to_array(substring(s->>'$ref' from 3),'/'); s:=root_schema#>path;
   if s is null then return false; end if;
 end if;
 if s='true' then return true; end if;
 if s='false' or v is null then return false; end if;
 if s?'anyOf' then
   valid:=false;
   for child in select x from jsonb_array_elements(s->'anyOf') t(x) loop
     if private.opportunity_payload_schema_valid(v,child,root_schema) then valid:=true; exit; end if;
   end loop;
   if not valid then return false; end if;
 end if;
 if s?'type' then
   expected:=case when jsonb_typeof(s->'type')='array' then s->'type' else jsonb_build_array(s->'type') end;
   if not expected?kind then return false; end if;
 end if;
 if s?'const' and v<>s->'const' then return false; end if;
 if s?'enum' and not (s->'enum' @> jsonb_build_array(v)) then return false; end if;
 if kind='object' then
   if s?'minProperties' and (select count(*) from jsonb_object_keys(v))<(s->>'minProperties')::integer then return false; end if;
   for k in select jsonb_array_elements_text(coalesce(s->'required','[]')) loop if not v?k then return false; end if; end loop;
   for k,child in select * from jsonb_each(v) loop
     if (s->'properties')?k then expected:=s->'properties'->k;
     else expected:=coalesce(s->'additionalProperties','true'); end if;
     if not private.opportunity_payload_schema_valid(child,expected,root_schema) then return false; end if;
   end loop;
 elsif kind='array' then
   if s?'minItems' and jsonb_array_length(v)<(s->>'minItems')::integer then return false; end if;
   if s?'items' then for child in select x from jsonb_array_elements(v) t(x) loop
     if not private.opportunity_payload_schema_valid(child,s->'items',root_schema) then return false; end if;
   end loop; end if;
 elsif kind='number' then
   if s?'minimum' and value::numeric<(s->>'minimum')::numeric then return false; end if;
   if s?'maximum' and value::numeric>(s->>'maximum')::numeric then return false; end if;
 elsif kind='string' then
   if s?'minLength' and length(value)<(s->>'minLength')::integer then return false; end if;
   if s?'maxLength' and length(value)>(s->>'maxLength')::integer then return false; end if;
   if s?'pattern' and value!~(s->>'pattern') then return false; end if;
   if s->>'format'='date' then
     if value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if; perform value::date;
   elsif s->>'format'='date-time' then
     if private.opportunity_merge_precise_time(value) is null then return false; end if;
   elsif s->>'format'='opportunity-timezone' then
     if value!~'^UTC[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$' and not exists(select 1 from pg_timezone_names where name=value and (name in ('UTC','GMT') or name like '%/%')) then return false; end if;
   end if;
 end if;
 return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

create function private.opportunity_canonical_set_key(p_path text,v text) returns text
language sql immutable set search_path='' as $$
 select case when p_path like '%/source_urls' then private.opportunity_merge_url(v) else private.opportunity_merge_key(v) end
$$;

create function private.opportunity_canonical_set(p_path text,v jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(x order by identity,x),'[]') from (
   select distinct on (private.opportunity_canonical_set_key(p_path,a#>>'{}')) a x,private.opportunity_canonical_set_key(p_path,a#>>'{}') identity
   from jsonb_array_elements(v) t(a) order by private.opportunity_canonical_set_key(p_path,a#>>'{}'),a
 ) q
$$;

create temporary table canonical_v5_stage(opportunity_id uuid primary key,payload jsonb not null) on commit drop;

create function pg_temp.v5_notes(v jsonb,label text default 'Information') returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb:='[]'; k text; a jsonb; n integer:=0;
begin
 if v is null or v in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) then return r; end if;
 if jsonb_typeof(v)='object' then
   for k,a in select * from jsonb_each(v) order by key loop r:=r||pg_temp.v5_notes(a,label||' / '||replace(k,'_',' ')); end loop;
 elsif jsonb_typeof(v)='array' then
   for a in select value from jsonb_array_elements(v) loop n:=n+1; r:=r||pg_temp.v5_notes(a,label||' / '||n); end loop;
 else r:=jsonb_build_array(jsonb_build_object('label',label,'text',v#>>'{}')); end if;
 return r;
end $$;

create function pg_temp.v5_leaves(v jsonb,path text default '') returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; k text; a jsonb; n integer:=0;
begin
 if v is null or v in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) then return r; end if;
 if jsonb_typeof(v)='object' then
   for k,a in select * from jsonb_each(v) order by key loop r:=r||pg_temp.v5_leaves(a,case when path='' then k else path||'.'||k end); end loop;
 elsif jsonb_typeof(v)='array' then
   for a in select value from jsonb_array_elements(v) loop r:=r||pg_temp.v5_leaves(a,path||'.'||n); n:=n+1; end loop;
 else r:=jsonb_build_array(jsonb_build_object('path',path,'text',v#>>'{}')); end if;
 return r;
end $$;

create function pg_temp.v5_preserve_facts(original jsonb,current_value jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:=current_value; seen jsonb; leaf jsonb; field text; notes jsonb; label text;
begin
 select coalesce(jsonb_agg(private.opportunity_merge_key(a->>'text')),'[]') into seen from jsonb_array_elements(pg_temp.v5_leaves(r)) a;
 for leaf in select value from jsonb_array_elements(pg_temp.v5_leaves(original)) loop
   field:=split_part(leaf->>'path','.',1);
   if field in ('id','metadata_schema_version','created_at','updated_at') or leaf->>'path'~'^sources[.][0-9]+[.](id|checked_at)$' then continue; end if;
   if seen ? private.opportunity_merge_key(leaf->>'text') then continue; end if;
   label:=replace(replace(leaf->>'path','_',' '),'.',' / ');
   notes:=jsonb_build_array(jsonb_build_object('label',label,'text',leaf->>'text'));
   if field in ('salary','personal_fit','rd_career_potential','research_career_potential','supervisor_reputation','hardware_software_balance') then
     r:=jsonb_set(r,array[field,'notes'],coalesce(r#>array[field,'notes'],'[]')||notes);
   else r:=jsonb_set(r,'{data,provenance}',coalesce(r#>'{data,provenance}','[]')||notes); end if;
   seen:=seen||jsonb_build_array(private.opportunity_merge_key(leaf->>'text'));
 end loop;
 return r;
end $$;

create function pg_temp.v5_extra(v jsonb,consumed text[]) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; k text; a jsonb;
begin
 if jsonb_typeof(v)<>'object' then return pg_temp.v5_notes(v); end if;
 for k,a in select * from jsonb_each(v) order by key loop
   if k=any(consumed) or k='legacy' or k like 'legacy_%' then continue; end if;
   r:=r||pg_temp.v5_notes(a,replace(k,'_',' '));
 end loop;
 return r;
end $$;

create function pg_temp.v5_strings(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; a jsonb;
begin
 if v is null or v='null' then return r; end if;
 if jsonb_typeof(v)='array' then for a in select value from jsonb_array_elements(v) loop r:=r||pg_temp.v5_strings(a); end loop;
 elsif jsonb_typeof(v)='string' and btrim(v#>>'{}')<>'' then r:=jsonb_build_array(v); end if;
 return private.opportunity_merge_set(r);
end $$;

create function pg_temp.v5_urls(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; a jsonb;
begin
 if jsonb_typeof(v)='object' then for a in select value from jsonb_each(v) loop r:=r||pg_temp.v5_urls(a); end loop;
 elsif jsonb_typeof(v)='array' then for a in select value from jsonb_array_elements(v) loop r:=r||pg_temp.v5_urls(a); end loop;
 elsif jsonb_typeof(v)='string' and v#>>'{}'~'^https?://[^[:space:]]+$' then r:=jsonb_build_array(v); end if;
 return private.opportunity_canonical_set('/source_urls',r);
end $$;

create function pg_temp.v5_project(v jsonb,s jsonb) returns jsonb language plpgsql set search_path='' as $$
declare doc jsonb:=private.opportunity_storage_schema(); k text; a jsonb; child jsonb; r jsonb:='{}'; notes jsonb:='[]';
begin
 if s?'$ref' then s:=doc#>string_to_array(substring(s->>'$ref' from 3),'/'); end if;
 if private.opportunity_payload_schema_valid(v,s,doc) then return v; end if;
 if jsonb_typeof(v)='object' and s->>'type'='object' then
   for k,a in select * from jsonb_each(v) loop
     if (s->'properties')?k then
       child:=pg_temp.v5_project(a,s->'properties'->k);
       if child is not null then r:=r||jsonb_build_object(k,child); else notes:=notes||pg_temp.v5_notes(a,replace(k,'_',' ')); end if;
     elsif k<>'legacy' and k not like 'legacy_%' then notes:=notes||pg_temp.v5_notes(a,replace(k,'_',' ')); end if;
   end loop;
   if notes<>'[]' and (s->'properties')?'notes' then r:=r||jsonb_build_object('notes',coalesce(r->'notes','[]')||notes); end if;
   return r;
 elsif s->>'type'='array' then
   r:='[]';
   for a in select value from jsonb_array_elements(case when jsonb_typeof(v)='array' then v else jsonb_build_array(v) end) loop
     child:=pg_temp.v5_project(a,s->'items'); if child is not null then r:=r||jsonb_build_array(child); end if;
   end loop;
   return r;
 elsif (s->'type'='"number"' or s->'type'?'number') and jsonb_typeof(v)='string' and v#>>'{}'~'^[0-9]+([.][0-9]+)?$' then
   child:=to_jsonb((v#>>'{}')::numeric); if private.opportunity_payload_schema_valid(child,s,doc) then return child; end if;
 elsif (s->'type'='"string"' or s->'type'?'string') and jsonb_typeof(v) in ('number','boolean') then
   child:=to_jsonb(v#>>'{}'); if private.opportunity_payload_schema_valid(child,s,doc) then return child; end if;
 end if;
 return null;
end $$;

create function pg_temp.v5_people(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; a jsonb; normalized jsonb; x jsonb; alt jsonb; k text; notes jsonb; roles jsonb;
begin
 -- The installed v4 converter is used only inside this one-time transaction.
 normalized:=private.opportunity_merge_entities('contacts',v);
 for a in select value from jsonb_array_elements(normalized) loop
   roles:=private.opportunity_merge_set(coalesce(a->'roles','[]')||pg_temp.v5_strings(a->'role'));
   notes:=pg_temp.v5_extra(a,array['entity_id','name','email','orcid','phone','institution','affiliation','role','roles','verified','verified_role','supervision_confirmed']);
   for alt in select value from jsonb_array_elements(coalesce(a->'legacy_variants','[]')) loop
     for k in select unnest(array['name','email','phone','institution','orcid']) loop
       if alt->k is not null and alt->k is distinct from a->k then notes:=notes||pg_temp.v5_notes(alt->k,'Alternate '||k); end if;
     end loop;
   end loop;
   x:=jsonb_build_object('entity_id',a->'entity_id','name',a->'name','email',a->'email','orcid',a->'orcid','phone',a->'phone','institution',coalesce(a->'institution',a->'affiliation'),'roles',roles,
     'verification',jsonb_build_object('identity_verified',case when jsonb_typeof(a->'verified')='boolean' then a->'verified' else 'null'::jsonb end,
       'role_verified',case when jsonb_typeof(a->'verified_role')='boolean' then a->'verified_role' else 'null'::jsonb end,
       'supervision_confirmed',case when jsonb_typeof(a->'supervision_confirmed')='boolean' then a->'supervision_confirmed' else 'null'::jsonb end),
     'source_urls',pg_temp.v5_urls(a-array['legacy_variants','legacy']),'notes',notes);
   r:=r||jsonb_build_array(pg_temp.v5_project(x,'{"$ref":"#/$defs/person"}'));
 end loop;
 return r;
end $$;

create function pg_temp.v5_status(v text) returns text language sql immutable set search_path='' as $$
 select case
 when lower(v) in ('required','mandatory','essential','required_for_project','required_for_funding','required_by_project','required_by_cdtnet') then 'required'
 when lower(v) like '%conditional%' or lower(v) like '%if_available%' or lower(v) like '%if_applicable%' or lower(v) like '%where_relevant%' then 'conditional'
 when lower(v) in ('optional','not_required','not_required_initially','desirable_not_required','helpful_not_required') then 'optional'
 when lower(v) in ('preferred','preferred_background') then 'preferred'
 when lower(v) in ('recommended') then 'recommended'
 when lower(v) in ('desired','desirable','highly_desirable') then 'desired'
 when lower(v) in ('advantage','advantageous','plus','beneficial','highly_valued','valued') then 'advantageous'
 else 'unspecified' end
$$;

create function pg_temp.v5_checklist(v jsonb,p_field text,p_status text default 'unspecified',p_stage text default 'unspecified',p_group text default null) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb:='[]'; a jsonb; x jsonb; k text; status text; stage text; content text; raw_status text; notes jsonb; conditions jsonb;
begin
 if v is null or v in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) then return r; end if;
 if jsonb_typeof(v)='array' then
   for a in select value from jsonb_array_elements(v) loop r:=r||pg_temp.v5_checklist(a,p_field,p_status,p_stage,p_group); end loop;
 elsif jsonb_typeof(v)='object' and not (v ?| array['text','name','document','item','label','requirement']) then
   for k,a in select * from jsonb_each(v) order by key loop
     status:=pg_temp.v5_status(k); if status='unspecified' then status:=p_status; end if;
     stage:=case when k in ('university_admission','doctoral_admission','university_admission_documents','doctoral_admission_after_selection') then 'doctoral_admission' else p_stage end;
     r:=r||pg_temp.v5_checklist(a,p_field,status,stage,k);
   end loop;
 else
   x:=case when jsonb_typeof(v)='object' then v else jsonb_build_object('text',v#>>'{}') end;
   content:=case when p_field='required_documents' then coalesce(x->>'text',x->>'document',x->>'name',x->>'item',x->>'label',x->>'requirement')
     else coalesce(x->>'text',x->>'name',x->>'requirement',x->>'item',x->>'label',x->>'document') end;
   if nullif(btrim(content),'') is null then return r; end if;
   raw_status:=coalesce(x->>'status',x->>'importance',case when pg_temp.v5_status(x->>'type')<>'unspecified' then x->>'type' end,
     case when p_field='required_documents' and pg_temp.v5_status(x->>'requirement')<>'unspecified' then x->>'requirement' end,
     case when x->'required'='true' then 'required' when x->'required'='false' then 'optional' end,p_status);
   status:=pg_temp.v5_status(raw_status);
   stage:=case private.opportunity_merge_stage(coalesce(x->>'stage',p_stage))
     when 'doctoral_admission' then 'doctoral_admission' when 'recruitment' then 'recruitment' when 'after_selection' then 'after_selection'
     when 'interview' then 'interview' when 'offer' then 'offer' when 'enrolment' then 'enrolment' when 'unspecified' then 'unspecified' else 'other' end;
   notes:=pg_temp.v5_extra(x,array['entity_id','text','name','requirement','document','item','label','status','importance','type','required','stage','max_pages','max_words','file_format','conditions']);
   if raw_status<>status and raw_status<>'unspecified' then notes:=notes||pg_temp.v5_notes(to_jsonb(raw_status),'Requirement wording'); end if;
   if p_group is not null and pg_temp.v5_status(p_group)='unspecified' and p_group not in ('university_admission','doctoral_admission') then notes:=notes||pg_temp.v5_notes(to_jsonb(p_group),'Category'); end if;
   if stage='other' then notes:=notes||pg_temp.v5_notes(x->'stage','Application stage'); end if;
   conditions:=coalesce(x->'conditions','[]');
   if status='conditional' then conditions:=conditions||jsonb_build_array(coalesce(x->>'condition',raw_status)); end if;
   r:=jsonb_build_array(jsonb_build_object('entity_id','item:'||md5(p_field||':'||private.opportunity_merge_key(content)||':'||stage),
     'text',content,'status',status,'stage',stage,'conditions',pg_temp.v5_strings(conditions),
     'max_pages',case when jsonb_typeof(x->'max_pages')='number' then x->'max_pages' else 'null'::jsonb end,
     'max_words',case when jsonb_typeof(x->'max_words')='number' then x->'max_words' else 'null'::jsonb end,
     'file_formats',pg_temp.v5_strings(x->'file_format'),'source_urls',pg_temp.v5_urls(x),'notes',notes));
 end if;
 return r;
end $$;

create function pg_temp.v5_sources(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; a jsonb; x jsonb; claims jsonb; supports jsonb; notes jsonb; claim text; field text; stamp text; precision text;
begin
 for a in select value from jsonb_array_elements(v) loop
   supports:='[]'; notes:=pg_temp.v5_extra(a,array['id','url','kind','type','checked_at','supports','supported_fields','fields']);
   claims:=coalesce(a->'supports','[]')||coalesce(a->'supported_fields','[]')||coalesce(a->'fields','[]');
   for claim in select jsonb_array_elements_text(claims) loop
     field:=private.opportunity_search_support_field(claim);
     if field is null then notes:=notes||pg_temp.v5_notes(to_jsonb(claim),'Unmapped coverage'); else supports:=supports||jsonb_build_array(field); end if;
   end loop;
   stamp:=a->>'checked_at'; precision:=case when private.opportunity_merge_precise_time(stamp) is not null then 'instant'
     when stamp~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then 'date' else 'unknown' end;
   if precision='unknown' then notes:=notes||pg_temp.v5_notes(a->'checked_at','Check time wording'); stamp:=null; end if;
   if a?'type' then notes:=notes||pg_temp.v5_notes(a->'type','Source category'); end if;
   x:=jsonb_build_object('source_id','source:'||md5(private.opportunity_merge_url(a->>'url')||':'||coalesce(stamp,'unknown')||':'||private.opportunity_search_source_kind(a)),
     'url',a->'url','kind',private.opportunity_search_source_kind(a),'checked_at',stamp,'precision',precision,'supports',private.opportunity_merge_set(supports),'notes',notes);
   r:=r||jsonb_build_array(x);
 end loop;
 return r;
end $$;

create function pg_temp.v5_assessment(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; verified boolean:=true; notes jsonb; subs jsonb;
begin
 notes:=pg_temp.v5_extra(v,array['score','scale_min','scale_max','summary','subscores','gaps','gaps_to_verify']);
 select coalesce(jsonb_object_agg(key,value),'{}') into subs from jsonb_each(coalesce(v->'subscores','{}'))
   where jsonb_typeof(value)='number' and (value#>>'{}')::numeric between 0 and 10;
 r:=jsonb_build_object('score',case when jsonb_typeof(v->'score')='number' then v->'score' else 'null'::jsonb end,
   'scale_min',0,'scale_max',10,
   'summary',v->'summary','subscores',subs,'gaps',pg_temp.v5_strings(coalesce(v->'gaps','[]')||coalesce(v->'gaps_to_verify','[]')),'notes',notes);
 return r;
end $$;

create function pg_temp.v5_salary(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; a jsonb; k text; currency text; period text; amount jsonb; minimum jsonb; maximum jsonb; notes jsonb; components jsonb:='[]'; c jsonb; p text; cur text;
begin
 currency:=upper(btrim(v->>'currency')); if currency='€' then currency:='EUR'; elsif currency='£' then currency:='GBP'; end if;
 if currency!~'^[A-Z]{3}$' then currency:=null; end if;
 period:=case lower(v->>'period') when 'monthly' then 'month' when 'annually' then 'year' when 'annual' then 'year' when 'yearly' then 'year' when 'hourly' then 'hour' when 'weekly' then 'week' else lower(v->>'period') end;
 if period<>all(array['hour','day','week','month','year','contract']) then period:=null; end if;
 amount:=pg_temp.v5_project(coalesce(v->'amount',v->'salary_amount'),' {"type":["number","null"]}');
 minimum:=pg_temp.v5_project(coalesce(v->'min',v->'amount_min'),' {"type":["number","null"]}');
 maximum:=pg_temp.v5_project(coalesce(v->'max',v->'amount_max'),' {"type":["number","null"]}');
 if v->'minimum'='true' then minimum:=amount; amount:='null'; end if;
 notes:=pg_temp.v5_extra(v,array['amount','min','max','amount_min','amount_max','currency','period','gross','model','kind','details','display','text','summary','salary_text']);
 if jsonb_typeof(v->'amount')='string' then notes:=notes||pg_temp.v5_notes(v->'amount','Amount wording'); end if;
 for k,a in select * from jsonb_each(v) loop
   if jsonb_typeof(a)<>'number' or not (k~'(gross_(monthly|annual|per_year)|annual_stipend|stipend_aud_per_year|living_allowance_eur_month|mobility_allowance_eur_month|family_allowance_eur_month|^starting$|^final_year$|^year[0-9]$)') then continue; end if;
   p:=case when k~'(annual|per_year)' then 'year' when k~'(monthly|eur_month)' then 'month' else period end;
   cur:=case when k~'(_eur)' then 'EUR' when k~'(_sek)' then 'SEK' when k~'(_aud)' then 'AUD' else currency end;
   c:=jsonb_build_object('entity_id','money:'||md5(k),'label',replace(k,'_',' '),'amount',a,'min',null,'max',null,'currency',cur,'period',p,
     'gross',case when k like 'gross_%' then 'true'::jsonb else coalesce(v->'gross','null') end,'model',null,'condition',null,'notes','[]'::jsonb);
   components:=components||jsonb_build_array(c);
 end loop;
 r:=jsonb_build_object('amount',coalesce(amount,'null'),'min',coalesce(minimum,'null'),'max',coalesce(maximum,'null'),'currency',currency,'period',period,
   'gross',case when jsonb_typeof(v->'gross')='boolean' then v->'gross' else 'null'::jsonb end,'model',coalesce(v->'model',v->'kind'),
   'details',coalesce(v->'details',v->'display',v->'text',v->'summary',v->'salary_text'),'components',components,'source_urls',pg_temp.v5_urls(v),'notes',notes);
 return pg_temp.v5_project(r,'{"$ref":"#/$defs/salary"}');
end $$;

create function pg_temp.v5_papers(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='[]'; a jsonb; x jsonb;
begin
 for a in select value from jsonb_array_elements(private.opportunity_merge_entities('supervisor_top_papers',v)) loop
   x:=a-array['legacy_variants','legacy','why_relevant','relevance','supervisor','supervisor_name','name'];
   x:=x||jsonb_build_object('title',coalesce(a->'title',a->'name'),'relevance',coalesce(a->'relevance',a->'why_relevant'),
     'supervisors',private.opportunity_merge_set(coalesce(a->'supervisors','[]')||pg_temp.v5_strings(a->'supervisor')||pg_temp.v5_strings(a->'supervisor_name')),
     'source_urls',pg_temp.v5_urls(a-array['legacy_variants','legacy']));
   r:=r||jsonb_build_array(pg_temp.v5_project(x,'{"$ref":"#/$defs/paper"}'));
 end loop;
 return r;
end $$;

create function pg_temp.v5_focus(v jsonb,people jsonb) returns jsonb language plpgsql set search_path='' as $$
declare profiles jsonb:='[]'; name text; a jsonb; person_id text; x jsonb;
begin
 for name,a in select * from jsonb_each(v) order by key loop
   select p->>'entity_id' into person_id from jsonb_array_elements(people) p where private.opportunity_merge_key(p->>'name')=private.opportunity_merge_key(name) limit 1;
   x:=jsonb_build_object('entity_id','focus:'||md5(private.opportunity_merge_key(name)),'name',name,'researcher_id',person_id,
     'summary',coalesce(a->'summary',a->'focus',a->'description'),'topics',private.opportunity_merge_set(coalesce(a->'topics','[]')||coalesce(a->'keywords','[]')),
     'methods',pg_temp.v5_strings(a->'methods'),'checked_at',a->'checked_at','source_urls',pg_temp.v5_urls(a),
     'notes',pg_temp.v5_extra(a,array['person','summary','focus','description','topics','keywords','methods','checked_at']));
   profiles:=profiles||jsonb_build_array(pg_temp.v5_project(x,'{"$ref":"#/$defs/focus_profile"}'));
 end loop;
 return jsonb_build_object('profiles',profiles,'notes','[]'::jsonb);
end $$;

create function pg_temp.v5_data(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:='{}'; k text; a jsonb; bucket text; methods jsonb:='[]'; teaching jsonb:='[]'; status text:='unknown'; details text; notes jsonb:='[]';
begin
 for k,a in select * from jsonb_each(v) order by key loop
   if k in ('methods','methodology','advertised_methods','research_methods') then methods:=methods||pg_temp.v5_strings(a);
   elsif k in ('teaching','teaching_text','teaching_and_departmental_duties','teaching_load') then
     if jsonb_typeof(a)='string' and btrim(a#>>'{}')<>'' then teaching:=teaching||jsonb_build_array(a);
     elsif jsonb_typeof(a)='object' then
       if a->>'status' in ('specified','not_specified','unknown') then status:=a->>'status'; end if;
       teaching:=teaching||pg_temp.v5_strings(coalesce(a->'details',a->'summary',a->'text')); notes:=notes||pg_temp.v5_extra(a,array['status','details','summary','text']);
     end if;
   elsif k in ('living_standard','url_roles') then r:=r||jsonb_build_object(k,a);
   else
     bucket:=case when k~'(funding|grant|salary)' then 'funding'
       when k~'(^start|_start|preferred_start|expected_start)' then 'start_details'
       when k~'(application|admission|interview|eligibility)' then 'application_process'
       when k~'(checked|verification|assessment|published|posting|source|last_search)' then 'provenance'
       when k~'(research|project|lab|programme|consortium|track|collaborator|partner|subject)' then 'research_context' else 'notes' end;
     r:=jsonb_set(r,array[bucket],coalesce(r->bucket,'[]')||pg_temp.v5_notes(a,replace(k,'_',' ')));
   end if;
 end loop;
 select string_agg(t#>>'{}',E'\n' order by t) into details from (select distinct t from jsonb_array_elements(teaching) x(t)) q;
 r:=r||jsonb_build_object('research_methods',private.opportunity_merge_set(methods),'teaching_load',jsonb_build_object('status',status,'details',details,'notes',notes));
 return pg_temp.v5_project(r,'{"$ref":"#/$defs/data"}');
end $$;

create function pg_temp.v5_row(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb:=v; people jsonb; field text; x jsonb; notes jsonb;
begin
 foreach field in array array['contacts','supervisors'] loop r:=jsonb_set(r,array[field],pg_temp.v5_people(v->field)); end loop;
 foreach field in array array['requirements','required_documents'] loop r:=jsonb_set(r,array[field],pg_temp.v5_checklist(v->field,field)); end loop;
 r:=jsonb_set(r,'{sources}',pg_temp.v5_sources(v->'sources'));
 r:=jsonb_set(r,'{salary}',pg_temp.v5_salary(v->'salary'));
 foreach field in array array['personal_fit','rd_career_potential','research_career_potential'] loop r:=jsonb_set(r,array[field],pg_temp.v5_assessment(v->field)); end loop;
 r:=jsonb_set(r,'{supervisor_top_papers}',pg_temp.v5_papers(v->'supervisor_top_papers'));
 r:=jsonb_set(r,'{supervisor_research_focus}',pg_temp.v5_focus(v->'supervisor_research_focus',r->'supervisors'));
 x:=v->'supervisor_reputation';
 r:=jsonb_set(r,'{supervisor_reputation}',jsonb_build_object('summary',coalesce(x->'summary',x->'assessment',x->'reason'),'evidence',pg_temp.v5_strings(x->'evidence'),
   'limitations',pg_temp.v5_strings(coalesce(x->'limitations',x->'limitation')),'source_urls',pg_temp.v5_urls(x),'notes',pg_temp.v5_extra(x,array['summary','assessment','reason','evidence','limitations','limitation'])));
 x:=v->'hardware_software_balance';
 r:=jsonb_set(r,'{hardware_software_balance}',jsonb_build_object('classification',coalesce(x->'classification',x->'label',x->'assessment'),'summary',coalesce(x->'summary',x->'reason'),
   'details',x->'details','hardware',pg_temp.v5_strings(x->'hardware'),'software',pg_temp.v5_strings(x->'software'),'notes',pg_temp.v5_extra(x,array['classification','label','assessment','summary','reason','details','hardware','software'])));
 r:=jsonb_set(r,'{data}',pg_temp.v5_data(v->'data'));
 if v#>'{data,deadline_time_is_assumed}'='true' then
   r:=jsonb_set(r,'{deadline_time_local}','null');
   r:=jsonb_set(r,'{open_questions}',coalesce(r->'open_questions','[]')||jsonb_build_array('The official deadline time is unconfirmed; the prior 00:00 value was a calculation assumption.'));
 end if;
 if r->>'deadline_timezone' in ('EEST','AoE') then r:=jsonb_set(r,'{deadline_timezone}',to_jsonb(case r->>'deadline_timezone' when 'EEST' then 'UTC+03:00' else 'UTC-12:00' end)); end if;
 r:=jsonb_set(r,'{metadata_schema_version}','5');
 return pg_temp.v5_preserve_facts(v,r);
end $$;

insert into canonical_v5_stage select id,pg_temp.v5_row(to_jsonb(o)) from public.opportunities o;


create or replace function private.opportunity_search_schema_valid(v jsonb,s jsonb) returns boolean
language sql stable set search_path='' as $$ select private.opportunity_payload_schema_valid(v,s,case when s ? '$defs' then s else private.opportunity_search_result_schema() end) $$;

create or replace function private.opportunity_search_result_schema() returns jsonb
language plpgsql immutable set search_path='' as $$
declare d jsonb:=private.opportunity_storage_schema(); name text; required jsonb;
begin
 d:=jsonb_set(d,'{properties,last_checked_at,type}','"string"');
 d:=jsonb_set(d,'{properties,sources,minItems}','1');
 foreach name in array array['person','checklist','paper','focus_profile','money_component','source'] loop
   select coalesce(jsonb_agg(v),'[]') into required from jsonb_array_elements(d#>array['$defs',name,'required']) t(v)
     where v not in ('"entity_id"'::jsonb,'"source_id"'::jsonb) and not (name='person' and v='"roles"'::jsonb);
   d:=jsonb_set(d,array['$defs',name,'required'],required);
 end loop;
 d:=jsonb_set(d,'{properties,merge_control}',
   '{"type":"object","additionalProperties":false,"properties":{"corrections":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["path","expected","reason"],"properties":{"path":{"type":"string","pattern":"^/","minLength":2},"expected":true,"reason":{"type":"string","minLength":1,"maxLength":4000}}}}}}');
 return d;
end $$;

create or replace function private.opportunity_search_support_field(p_field text) returns text
language sql immutable set search_path='' as $$
 select case when (private.opportunity_storage_schema()->'properties')?root then
   case when p_field like '/%/%' then p_field else root end else null end
 from (select split_part(ltrim(p_field,'/'),'/',1) root) s
$$;

create or replace function private.opportunity_search_source_kind(s jsonb) returns text
language sql immutable set search_path='' as $$ select s->>'kind' $$;

create function private.opportunity_canonical_input(v jsonb,s jsonb,p_path text default '') returns jsonb
language plpgsql stable set search_path='' as $$
declare d jsonb:=private.opportunity_storage_schema(); k text; a jsonb; x jsonb; r jsonb; type_name text; id text;
begin
 type_name:=split_part(s->>'$ref','/',3);
 if s?'$ref' then s:=d#>string_to_array(substring(s->>'$ref' from 3),'/'); end if;
 if jsonb_typeof(v)='object' then
   r:='{}';
   for k,a in select * from jsonb_each(v) order by key loop
     if k='merge_control' then r:=r||jsonb_build_object(k,a); continue; end if;
     x:=private.opportunity_canonical_input(a,coalesce(s->'properties'->k,s->'additionalProperties','true'),p_path||'/'||private.opportunity_merge_pointer(k));
     r:=r||jsonb_build_object(k,x);
   end loop;
   if type_name='person' then
     if not r?'roles' then r:=r||'{"roles":[]}'::jsonb; end if;
     if jsonb_typeof(r->'email')='string' then r:=jsonb_set(r,'{email}',to_jsonb(lower(btrim(r->>'email')))); end if;
   end if;
   if type_name in ('person','checklist','paper','focus_profile','money_component') and not r?'entity_id' then
     id:=case type_name when 'person' then coalesce(nullif(lower(btrim(r->>'email')),''),nullif(r->>'orcid',''),nullif(private.opportunity_merge_key(r->>'name'),''),r::text)
       when 'checklist' then private.opportunity_merge_key(r->>'text')||':'||(r->>'stage')
       when 'paper' then coalesce(nullif(lower(r->>'doi'),''),nullif(private.opportunity_merge_url(r->>'url'),''),private.opportunity_merge_key(r->>'title'),r::text)
       when 'focus_profile' then private.opportunity_merge_key(r->>'name') else private.opportunity_merge_key(r->>'label')||':'||coalesce(r->>'currency','')||':'||coalesce(r->>'period','') end;
     r:=r||jsonb_build_object('entity_id','generated:'||md5(type_name||':'||id));
   elsif type_name='source' and not r?'source_id' then
     r:=r||jsonb_build_object('source_id','source:'||md5(private.opportunity_merge_url(r->>'url')||':'||coalesce(r->>'checked_at','unknown')||':'||(r->>'kind')));
   end if;
   return r;
 elsif jsonb_typeof(v)='array' then
   r:='[]';
   for a in select value from jsonb_array_elements(v) loop r:=r||jsonb_build_array(private.opportunity_canonical_input(a,coalesce(s->'items','true'),p_path)); end loop;
   if s#>>'{items,type}'='string' then return private.opportunity_canonical_set(p_path,r); end if;
   return r;
 end if;
 return v;
end $$;

create or replace function private.opportunity_search_normalize_source(s jsonb) returns jsonb
language sql stable set search_path='' as $$
 select private.opportunity_canonical_input(s,'{"$ref":"#/$defs/source"}')
$$;

create or replace function private.opportunity_merge_stage(v text) returns text
language sql immutable set search_path='' as $$ select v $$;

create or replace function private.opportunity_merge_entity_key(p_field text,v jsonb) returns text
language sql immutable set search_path='' as $$
 select coalesce('id:'||nullif(v->>'entity_id',''),
   case when p_field in ('contacts','supervisors') then coalesce('email:'||nullif(lower(btrim(v->>'email')),''),'orcid:'||nullif(v->>'orcid',''),'name:'||private.opportunity_merge_key(v->>'name'))
     when p_field='supervisor_top_papers' then coalesce('doi:'||nullif(lower(v->>'doi'),''),'url:'||nullif(private.opportunity_merge_url(v->>'url'),''),'title:'||private.opportunity_merge_key(v->>'title'))
     else 'fact:'||md5(private.opportunity_merge_key(v->>'label')||':'||private.opportunity_merge_key(v->>'text')) end)
$$;

create or replace function private.opportunity_merge_entities(p_field text,v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if jsonb_typeof(v)<>'array' then raise exception 'Canonical entity arrays are required.' using errcode='22023'; end if;
 return (select coalesce(jsonb_agg(x order by private.opportunity_merge_entity_key(p_field,x),x),'[]') from (select distinct a x from jsonb_array_elements(v) t(a)) q);
end $$;

create or replace function private.opportunity_merge_sources(v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb:='[]'; a jsonb; old jsonb; id text; idx integer; notes jsonb;
begin
 if jsonb_typeof(v)<>'array' then raise exception 'Canonical source arrays are required.' using errcode='22023'; end if;
 for a in select value from jsonb_array_elements(v) order by value loop
   a:=private.opportunity_search_normalize_source(a);
   id:=private.opportunity_merge_url(a->>'url')||':'||coalesce(private.opportunity_merge_precise_time(a->>'checked_at')::text,a->>'checked_at','unknown')||':'||(a->>'kind');
   select (n-1)::integer,x into idx,old from jsonb_array_elements(r) with ordinality t(x,n)
     where private.opportunity_merge_url(x->>'url')||':'||coalesce(private.opportunity_merge_precise_time(x->>'checked_at')::text,x->>'checked_at','unknown')||':'||(x->>'kind')=id limit 1;
   if idx is null then r:=r||jsonb_build_array(a);
   else
     select coalesce(jsonb_agg(x order by x),'[]') into notes from (select distinct x from jsonb_array_elements(coalesce(old->'notes','[]')||coalesce(a->'notes','[]')) t(x)) q;
     old:=old||jsonb_build_object('supports',private.opportunity_merge_set(coalesce(old->'supports','[]')||coalesce(a->'supports','[]')),'notes',notes);
     r:=jsonb_set(r,array[idx::text],old);
   end if;
 end loop;
 return (select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements(r) t(x));
end $$;

create or replace function private.opportunity_merge_canonical(p_field text,v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if p_field='sources' then return private.opportunity_merge_sources(v); end if;
 if p_field in ('contacts','supervisors','requirements','required_documents','supervisor_top_papers') then return private.opportunity_merge_entities(p_field,v); end if;
 if p_field in ('topics','special_features','open_questions','research_methods','roles') then return private.opportunity_merge_set(v); end if;
 return v;
end $$;

create or replace function private.validate_opportunity_search_result(p jsonb) returns void
language plpgsql stable set search_path='' as $$
declare s jsonb; f text; c jsonb; schema jsonb:=private.opportunity_search_result_schema();
begin
 if p is null or octet_length(p::text)>262144 or not private.opportunity_search_schema_valid(p,schema) then
   raise exception 'Payload must follow canonical opportunity schema v5; alternate/unknown fields and legacy shapes are not accepted.' using errcode='22023';
 end if;
 if btrim(p->>'opportunity_key')='' or btrim(p->>'title')='' or (p->>'last_checked_at')::timestamptz>clock_timestamp()+interval '5 minutes' then
   raise exception 'Nonblank identity/title and a non-future check time are required.' using errcode='22023';
 end if;
 for s in select value from jsonb_array_elements(p->'sources') loop
   if (s->>'precision'='instant' and (s->>'checked_at')::timestamptz>clock_timestamp()+interval '5 minutes')
     or (s->>'precision'='date' and (s->>'checked_at')::date>(clock_timestamp() at time zone 'UTC')::date) then
     raise exception 'Future source timestamps are forbidden.' using errcode='22023'; end if;
   for f in select jsonb_array_elements_text(s->'supports') loop
     if private.opportunity_search_support_field(f) is null then raise exception 'Unknown evidence field: %',f using errcode='22023'; end if;
   end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(p#>'{merge_control,corrections}','[]')) t(a) group by a->>'path' having count(*)>1) then
   raise exception 'Each correction path must be unique.' using errcode='22023'; end if;
 for c in select value from jsonb_array_elements(coalesce(p#>'{merge_control,corrections}','[]')) loop
   if private.opportunity_search_support_field(c->>'path') is null or btrim(c->>'reason')='' then raise exception 'Invalid correction path/reason.' using errcode='22023'; end if;
 end loop;
 perform jsonb_populate_record(null::public.opportunities,p-'merge_control');
end $$;

create or replace function private.opportunity_merge_policy(p_path text) returns text
language sql immutable set search_path='' as $$
 select case
 when p_path in ('/personal_fit','/rd_career_potential','/research_career_potential','/supervisor_reputation','/hardware_software_balance','/data/living_standard') then 'assessment'
 when p_path='/salary' then 'salary'
 when p_path in ('/contacts','/supervisors','/requirements','/required_documents','/supervisor_top_papers') then 'entities'
 when p_path in ('/topics','/special_features','/open_questions','/data/research_methods') or p_path like '%/roles'
   or p_path like '/supervisor_top_papers/%/supervisors' then 'set'
 when p_path='/salary/@quote' then 'assessment'
 when p_path like '/salary/components/@%' then 'assessment'
 when p_path in ('/salary/components','/supervisor_research_focus/profiles','/data/research_context','/data/application_process','/data/funding','/data/start_details','/data/provenance','/data/notes') or p_path like '%/notes' then 'entities'
 when p_path like '%/source_urls' or p_path like '%/topics' or p_path like '%/methods' or p_path like '%/conditions' or p_path like '%/file_formats' or p_path like '%/authors' or p_path like '%/gaps' or p_path like '%/limitations' or p_path like '%/evidence' then 'set'
 when p_path='/opportunity_key' or p_path like '%/entity_id' then 'identity'
 when p_path='/last_checked_at' then 'clock'
 else 'recursive' end
$$;

create or replace function private.opportunity_merge_node(p_path text,p_old jsonb,p_new jsonb,p_state jsonb,p_old_sources jsonb,p_new_sources jsonb,p_control jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare policy text:=private.opportunity_merge_policy(p_path); r jsonb:=p_old; state jsonb:=p_state; decisions jsonb:='[]';
  k text; v jsonb; child jsonb; path text; old_e jsonb; new_e jsonb; correction jsonb; verdict text; entry jsonb;
  old_entry jsonb; idx integer; matches integer[]; canonical_field text:=split_part(p_path,'/',2); added jsonb;
  quote_keys text[]:=array['amount','min','max','currency','period','gross','model']; old_quote jsonb; new_quote jsonb;
  ancestor record; bound boolean:=false; effective_absence boolean:=false; old_t timestamptz; new_t timestamptz;
begin
 select c into correction from jsonb_array_elements(coalesce(p_control->'corrections','[]')) t(c) where c->>'path'=p_path;
 if p_new is null then return jsonb_build_object('value',coalesce(p_old,'null'),'state',state,'decisions',decisions); end if;
 -- An explicit correction replaces a collection atomically; absent members are otherwise retained.
 if correction is null and policy='entities' then
   r:=coalesce(p_old,'[]');
   for v in select value from jsonb_array_elements(p_new) order by private.opportunity_merge_entity_key(canonical_field,value),value loop
     select array_agg(n::integer) into matches from jsonb_array_elements(r) with ordinality t(a,n)
       where case when canonical_field in ('contacts','supervisors') then private.opportunity_merge_person_match(a,v)
         when canonical_field='supervisor_top_papers' then private.opportunity_merge_paper_match(a,v)
         else private.opportunity_merge_entity_key(canonical_field,a)=private.opportunity_merge_entity_key(canonical_field,v) end;
     if cardinality(matches)>1 then
       decisions:=decisions||jsonb_build_array(jsonb_build_object('path',p_path,'status','conflicting','reason','ambiguous_entity','before',r,'after',r,'proposed',v));
       continue;
     end if;
     idx:=case when cardinality(matches)=1 then matches[1]-1 else jsonb_array_length(r) end;
     old_entry:=r->idx;
     if old_entry?'entity_id' and v->>'entity_id' like 'generated:%' then v:=jsonb_set(v,'{entity_id}',old_entry->'entity_id'); end if;
     path:=p_path||'/@'||private.opportunity_merge_pointer(private.opportunity_merge_entity_key(canonical_field,coalesce(old_entry,v)));
     child:=private.opportunity_merge_node(path,old_entry,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if private.opportunity_merge_present(child->'value') then r:=jsonb_set(r,array[idx::text],child->'value'); end if;
   end loop;
   select coalesce(jsonb_agg(a order by private.opportunity_merge_entity_key(canonical_field,a),a),'[]') into r from jsonb_array_elements(r) t(a);
 elsif correction is null and policy='salary' and jsonb_typeof(p_new)='object' then
   r:=case when jsonb_typeof(p_old)='object' then p_old else '{}' end;
   select coalesce(jsonb_object_agg(key,value),'{}') into old_quote from jsonb_each(r) where key=any(quote_keys);
   select coalesce(jsonb_object_agg(key,value),'{}') into new_quote from jsonb_each(p_new) where key=any(quote_keys);
   if new_quote<>'{}' then
     if ((new_quote ?| array['amount','min','max','currency','period']) and not (new_quote ?& array['currency','period']))
       or exists(select 1 from jsonb_object_keys(old_quote) t(qk) where not new_quote?qk or (private.opportunity_merge_present(old_quote->qk) and not private.opportunity_merge_present(new_quote->qk))) then
       decisions:=decisions||jsonb_build_array(jsonb_build_object('path','/salary/@quote','policy','assessment','status','conflicting','reason','incomplete_salary_quote',
         'before',old_quote,'after',old_quote,'proposed',new_quote));
     else
       child:=private.opportunity_merge_node('/salary/@quote',old_quote,new_quote,state,p_old_sources,p_new_sources,p_control);
       state:=child->'state'; decisions:=decisions||(child->'decisions');
       if jsonb_typeof(child->'value')='object' then r:=(r-quote_keys)||(child->'value'); end if;
     end if;
   end if;
   for k,v in select * from jsonb_each(p_new-quote_keys) order by key loop
     child:=private.opportunity_merge_node(p_path||'/'||private.opportunity_merge_pointer(k),r->k,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if child->'value'<>'null' or r?k then r:=jsonb_set(r,array[k],child->'value'); end if;
   end loop;
 elsif correction is null and policy='set' then
   r:=coalesce(p_old,'[]');
   for v in select value from jsonb_array_elements(p_new) order by value loop
     path:=p_path||'/@'||private.opportunity_merge_pointer(private.opportunity_canonical_set_key(p_path,v#>>'{}'));
     select a into old_entry from jsonb_array_elements(r) t(a) where private.opportunity_canonical_set_key(p_path,a#>>'{}')=private.opportunity_canonical_set_key(p_path,v#>>'{}');
     child:=private.opportunity_merge_node(path,old_entry,coalesce(old_entry,v),state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if old_entry is null and private.opportunity_merge_present(child->'value') then r:=r||jsonb_build_array(child->'value'); end if;
   end loop;
   r:=private.opportunity_canonical_set(p_path,r);
 elsif correction is null and policy='recursive' and jsonb_typeof(p_new)='object'
   and (not private.opportunity_merge_present(p_old) or jsonb_typeof(p_old)='object') then
   r:=case when jsonb_typeof(p_old)='object' then p_old else '{}' end;
   for k,v in select * from jsonb_each(p_new) order by key loop
     child:=private.opportunity_merge_node(p_path||'/'||private.opportunity_merge_pointer(k),r->k,v,state,p_old_sources,p_new_sources,p_control);
     state:=child->'state'; decisions:=decisions||(child->'decisions');
     if child->'value'<>'null' or r?k then r:=jsonb_set(r,array[k],child->'value'); end if;
   end loop;
 else
   entry:=state->p_path;
   -- Atomic parent corrections/revalidations supersede their old child bindings.
   if entry is null then
     for ancestor in select key,value from jsonb_each(state) where left(p_path,length(key)+1)=key||'/' order by length(key) desc loop
       if coalesce(private.opportunity_merge_value_at(ancestor.value->'value',substring(p_path from length(ancestor.key)+2),canonical_field),'null')
         is not distinct from coalesce(p_old,'null') then
         entry:=jsonb_build_object('value',coalesce(p_old,'null'),'evidence',ancestor.value->'evidence');
         bound:=true; exit;
       end if;
     end loop;
   else bound:=true; end if;
   -- Detect out-of-band edits rather than blessing the stale state's evidence.
   if entry is not null and entry->'value' is distinct from coalesce(p_old,'null') then
     old_e:='[]'::jsonb;
   else old_e:=coalesce(entry->'evidence','[]'::jsonb); end if;
   new_e:=private.opportunity_merge_evidence(p_new_sources,p_path);
   -- A whole-container correction must respect every effective descendant fact.
   if correction is not null and jsonb_typeof(p_old) in ('array','object') then
     select coalesce(jsonb_agg(distinct evidence),'[]') into old_e from (
       select evidence from jsonb_array_elements(old_e) t(evidence)
       union all select e from jsonb_each(state) t(sk,sv) cross join lateral jsonb_array_elements(coalesce(sv->'evidence','[]')) x(e)
         where left(sk,length(p_path)+1)=p_path||'/'
     ) all_evidence;
   end if;
   effective_absence:=bound and not private.opportunity_merge_present(p_old) and private.opportunity_merge_present(p_new);
   if effective_absence then
     select max(private.opportunity_search_evidence_time(s)) into old_t from jsonb_array_elements(old_e) t(s);
     select max(private.opportunity_merge_precise_time(s->>'checked_at')) into new_t from jsonb_array_elements(new_e) t(s)
       where private.opportunity_search_source_kind(s) in ('official','official_listing','institution','graduate_school');
   end if;
   if policy='identity' then
     verdict:=case when not private.opportunity_merge_present(p_old) then 'accepted:new_canonical_identity' when p_old=p_new then 'unchanged' else 'conflicting:immutable_canonical_key' end;
   elsif p_path in ('/official_url','/source_url','/application_url') and private.opportunity_merge_url(p_old#>>'{}')=private.opportunity_merge_url(p_new#>>'{}') then
     verdict:='unchanged:equivalent_url';
   elsif policy='clock' then
     verdict:=case when not private.opportunity_merge_present(p_old) or (p_new#>>'{}')::timestamptz>(p_old#>>'{}')::timestamptz then 'accepted:monotonic_check_time'
       when (p_new#>>'{}')::timestamptz=(p_old#>>'{}')::timestamptz then 'unchanged' else 'rejected:older_check_time' end;
   else
     verdict:=private.opportunity_merge_authorize(p_old,p_new,old_e,new_e,correction);
   end if;
   if effective_absence and new_t<=old_t then
     if new_t<old_t then verdict:='rejected:stale_evidence_for_cleared_value';
     elsif correction is null or correction->'expected' is distinct from coalesce(p_old,'null')
       or not private.opportunity_merge_same_evidence(old_e,new_e) then
       verdict:='conflicting:cleared_value_requires_correction';
     end if;
   end if;
   if verdict like 'accepted:%' then
     r:=p_new;
     state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',new_e));
   else
     r:=coalesce(p_old,'null');
     if entry is null then state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',old_e,'verification','unknown')); end if;
     if verdict like 'unchanged%' and private.opportunity_merge_present(r) and private.opportunity_merge_can_revalidate(old_e,new_e) then
       state:=jsonb_set(state,array[p_path],jsonb_build_object('value',r,'evidence',new_e));
       verdict:='unchanged:same_value_revalidated';
     end if;
   end if;
   if jsonb_typeof(r) in ('object','array') and (verdict like 'accepted:%' or verdict='unchanged:same_value_revalidated') then
     select coalesce(jsonb_object_agg(key,value),'{}') into state from jsonb_each(state) where left(key,length(p_path)+1)<>p_path||'/';
   end if;
   decisions:=jsonb_build_array(jsonb_build_object('path',p_path,'policy',policy,'status',split_part(verdict,':',1),
     'reason',coalesce(nullif(split_part(verdict,':',2),''),'same_value'),'before',coalesce(p_old,'null'),'after',r,'proposed',p_new,
     'before_evidence',old_e,'after_evidence',coalesce(state#>array[p_path,'evidence'],old_e),'proposed_evidence',new_e,
     'correction_reason',correction->>'reason'));
 end if;
 return jsonb_build_object('value',coalesce(r,'null'),'state',state,'decisions',decisions);
end $$;

create or replace function private.opportunity_merge_plan(p_before jsonb,p_payload jsonb,p_state jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare old jsonb:=coalesce(nullif(p_before,'null'::jsonb),'{}'); incoming jsonb; merged jsonb:=old;
 state jsonb:=coalesce(nullif(p_state,'null'::jsonb),'{}'); decisions jsonb:='[]'; k text; v jsonb; child jsonb; old_state jsonb;
 deadline_bad boolean:=false; clock_fields text[]:=array['deadline','deadline_time_local','deadline_timezone','deadline_original_text'];
 normalized_payload jsonb; normalization jsonb:='[]';
begin
 if old<>'{}' and p_state is null then raise exception 'Effective field state is required for an existing canonical record.' using errcode='23514'; end if;
 if old?'metadata_schema_version' and old->'metadata_schema_version'<>'5' then raise exception 'Only canonical v5 records may be merged.' using errcode='22023'; end if;
 perform private.validate_opportunity_search_result(p_payload);
 incoming:=private.opportunity_canonical_input(p_payload,private.opportunity_search_result_schema());
 normalized_payload:=incoming;
 -- Run the tuple against one state snapshot; one rejected member rejects the tuple.
 old_state:=state;
 foreach k in array clock_fields loop
   if not incoming?k then continue; end if;
   child:=private.opportunity_merge_node('/'||k,old->k,incoming->k,state,'[]'::jsonb,incoming->'sources',incoming->'merge_control');
   state:=child->'state'; decisions:=decisions||(child->'decisions'); merged:=jsonb_set(merged,array[k],child->'value');
   if exists(select 1 from jsonb_array_elements(child->'decisions') t(a) where a->>'status' in ('rejected','conflicting')) then deadline_bad:=true; end if;
 end loop;
 if incoming?'deadline' and incoming->'deadline' is distinct from old->'deadline' and private.opportunity_merge_present(old->'deadline_time_local')
   and not (incoming ?& array['deadline','deadline_time_local','deadline_timezone']) then deadline_bad:=true; end if;
 if deadline_bad then
   select coalesce(jsonb_agg(case when a->>'status'='accepted' then a||jsonb_build_object('status','conflicting','reason','deadline_tuple_rejected','after',a->'before','after_evidence',a->'before_evidence') else a end),'[]') into decisions from jsonb_array_elements(decisions) t(a);
   state:=old_state;
   foreach k in array clock_fields loop
     if old?k then merged:=jsonb_set(merged,array[k],old->k); else merged:=merged-k; end if;
   end loop;
 end if;
 for k,v in select * from jsonb_each(incoming) order by key loop
   if k=any(clock_fields) or k in ('sources','merge_control') then continue; end if;
   child:=private.opportunity_merge_node('/'||k,old->k,v,state,'[]'::jsonb,incoming->'sources',incoming->'merge_control');
   state:=child->'state'; decisions:=decisions||(child->'decisions');
   if child->'value'<>'null' or old?k then merged:=jsonb_set(merged,array[k],child->'value'); end if;
 end loop;
 -- The historical source log is lossless, but is never consulted as effective state.
 merged:=merged||jsonb_build_object('sources',private.opportunity_merge_canonical('sources',coalesce(old->'sources','[]')||(incoming->'sources')));
 decisions:=decisions||jsonb_build_array(jsonb_build_object('path','/sources','policy','source_log','status',
   case when merged->'sources' is not distinct from old->'sources' then 'unchanged' else 'accepted' end,
   'reason','historical_claims_only_not_effective_evidence','before',old->'sources','after',merged->'sources','proposed',incoming->'sources'));

 return jsonb_build_object('value',merged,'state',state,'decisions',decisions,'normalization',normalization,'normalized_payload',normalized_payload);
end $$;

create or replace function private.submit_opportunity_search_result(p_run_id uuid,p_item_id uuid,p_opportunity jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare run public.opportunity_search_runs; prior public.opportunity_search_receipts; candidates uuid[]; oid uuid;
  before_row jsonb; after_row jsonb; before_state jsonb; plan jsonb; merged jsonb; receipt jsonb;
  before_ids jsonb; after_ids jsonb; identity text; cols text; assignments text; conflicts jsonb; outcome text;
begin
 if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
 if p_item_id is null then raise exception 'A stable item UUID is required.' using errcode='22023'; end if;
 select * into run from public.opportunity_search_runs where id=p_run_id for update;
 if not found then raise exception 'Search run not found.' using errcode='P0002'; end if;
 select * into prior from public.opportunity_search_receipts where run_id=p_run_id and item_id=p_item_id;
 if found then
   if prior.payload is distinct from p_opportunity then raise exception 'An item UUID cannot be reused for changed evidence.' using errcode='23505'; end if;
   return prior.result||jsonb_build_object('verified',prior.verified_at is not null);
 end if;
 if run.status<>'running' or run.queries is null then raise exception 'An active run with saved queries is required.' using errcode='22023'; end if;
 if run.protocol_version<>'opportunity-search-v1-canonical-5' then raise exception 'Refresh to the canonical v5 protocol before submitting.' using errcode='22023'; end if;
 perform private.validate_opportunity_search_result(p_opportunity);
 -- The canonical input contract is checked before identity matching or writes.
 if jsonb_typeof(p_opportunity) is distinct from 'object' or octet_length(p_opportunity::text)>262144 or exists(
   select 1 from jsonb_object_keys(p_opportunity) t(k) where not (private.opportunity_search_result_schema()->'properties')?k
   ) then
   raise exception 'Unknown/protected opportunity fields or oversized payload.' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('opportunity-search-catalogue-v1',0));
 candidates:=private.opportunity_search_matches(p_opportunity);
 if cardinality(candidates)>1 then raise exception 'Ambiguous opportunity identity; review without merging.' using errcode='23505'; end if;
 oid:=candidates[1];
 if oid is not null then
   select to_jsonb(o) into before_row from public.opportunities o where id=oid for update;
   select fields into before_state from private.opportunity_search_merge_state where opportunity_id=oid;
   if nullif(btrim(before_row->>'vacancy_id'),'') is not null and nullif(btrim(p_opportunity->>'vacancy_id'),'') is not null
     and lower(btrim(before_row->>'vacancy_id'))<>lower(btrim(p_opportunity->>'vacancy_id'))
     and not (before_row->>'opportunity_key'=p_opportunity->>'opportunity_key' and exists(
       select 1 from jsonb_array_elements(coalesce(p_opportunity#>'{merge_control,corrections}','[]')) t(c)
       where c->>'path'='/vacancy_id' and c->'expected'=before_row->'vacancy_id' and btrim(c->>'reason')<>'')) then
     raise exception 'Conflicting vacancy IDs require review.' using errcode='23505';
   end if;
 end if;
 select coalesce(jsonb_agg(identity_key order by identity_key),'[]') into before_ids from private.opportunity_search_identities where opportunity_id=oid;
 plan:=private.opportunity_merge_plan(before_row,p_opportunity,before_state); merged:=plan->'value';
 if not private.opportunity_merge_present(merged->'title') or not private.opportunity_merge_present(merged->'opportunity_key') then
   raise exception 'Identity and title need accepted official evidence for a new record.' using errcode='23514';
 end if;
 -- The submitted allowlist plus normalization changes are the only writable columns.
 -- Protected values from before_row cannot become assignments.
 select string_agg(format('%I',k),',' order by k),
   string_agg(format('%1$I=(jsonb_populate_record(null::public.opportunities,$1)).%1$I',k),',' order by k)
 into cols,assignments from jsonb_object_keys(merged) t(k)
 where (private.opportunity_search_result_schema()->'properties')?k and k<>'merge_control'
   and (before_row is null or merged->k is distinct from before_row->k);
 if oid is null then
   execute format('insert into public.opportunities(%1$s) select %1$s from jsonb_populate_record(null::public.opportunities,$1) returning to_jsonb(opportunities)',cols) into after_row using merged;
   oid:=(after_row->>'id')::uuid; outcome:='new';
 elsif assignments is not null then
   execute 'update public.opportunities set '||assignments||',updated_at=clock_timestamp() where id=$2 returning to_jsonb(opportunities)' into after_row using merged,oid;
   outcome:=case when exists(select 1 from jsonb_array_elements(plan->'decisions') t(d)
     where d->>'status'='accepted' and d->'before' is distinct from d->'after' and d->>'path' not in ('/last_checked_at','/sources'))
       or plan->'normalization'<>'[]' then 'updated' else 'unchanged' end;
 else after_row:=before_row; outcome:='unchanged'; end if;
 insert into private.opportunity_search_merge_state values(oid,plan->'state') on conflict(opportunity_id) do update set fields=excluded.fields;
 -- Only an explicit evidenced vacancy-ID correction retires its erroneous alias.
 if before_row->'vacancy_id' is distinct from after_row->'vacancy_id' and exists(
   select 1 from jsonb_array_elements(coalesce(p_opportunity#>'{merge_control,corrections}','[]')) t(c) where c->>'path'='/vacancy_id') then
   delete from private.opportunity_search_identities where opportunity_id=oid and identity_key='vacancy:'||lower(btrim(before_row->>'institution'))||':'||lower(btrim(before_row->>'vacancy_id'));
 end if;
 foreach identity in array (private.opportunity_search_identity_keys(after_row)||array['key:'||(p_opportunity->>'opportunity_key')]) loop
   insert into private.opportunity_search_identities values(identity,oid) on conflict(identity_key) do nothing;
   if not exists(select 1 from private.opportunity_search_identities where identity_key=identity and opportunity_id=oid) then
     raise exception 'Identity claimed concurrently; review canonical records.' using errcode='40001';
   end if;
 end loop;
 select coalesce(jsonb_agg(identity_key order by identity_key),'[]') into after_ids from private.opportunity_search_identities where opportunity_id=oid;
 select coalesce(jsonb_agg(distinct split_part(d->>'path','/',2)),'[]') into conflicts from jsonb_array_elements(plan->'decisions') t(d) where d->>'status' in ('rejected','conflicting');
 receipt:=jsonb_build_object('merge_version',5,'run_id',p_run_id,'item_id',p_item_id,'opportunity_id',oid,'opportunity_key',after_row->>'opportunity_key',
   'outcome',outcome,'before_snapshot',before_row,'snapshot',after_row,'conflicts',conflicts,'field_decisions',plan->'decisions',
   'normalization',plan->'normalization','normalized_payload',plan->'normalized_payload','previous_assessments',
     (select coalesce(jsonb_object_agg(f,before_row->f),'{}') from unnest(array['personal_fit','rd_career_potential','research_career_potential']) f
      where before_row->f is not null and before_row->f is distinct from after_row->f),'verified',false);
 insert into private.opportunity_search_merge_audit(run_id,item_id,opportunity_id,before_snapshot,after_snapshot,before_state,after_state,before_identities,after_identities,decisions)
   values(p_run_id,p_item_id,oid,before_row,after_row,before_state,plan->'state',before_ids,after_ids,plan->'decisions');
 insert into public.opportunity_search_receipts(run_id,item_id,user_id,opportunity_id,payload,result) values(p_run_id,p_item_id,run.user_id,oid,p_opportunity,receipt);
 return receipt;
end $$;

CREATE OR REPLACE FUNCTION private.inspect_opportunity_search_result(p_run_id uuid, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare entry record; candidates uuid[]; snapshot jsonb;
begin
  if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
  if not exists(select 1 from public.opportunity_search_runs where id=p_run_id and status='running') then
    raise exception 'An active search run is required.' using errcode='22023';
  end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object' or octet_length(p_identity::text)>16384 then
    raise exception 'Supply only opportunity identity fields.' using errcode='22023';
  end if;
  if (p_identity-array['opportunity_key','institution','vacancy_id','official_url','source_url','application_url','data'])<>'{}'::jsonb then
    raise exception 'Supply only opportunity identity fields.' using errcode='22023';
  end if;
  for entry in select * from jsonb_each(p_identity) loop
    if entry.key='data' then
      if jsonb_typeof(entry.value)<>'object' or (entry.value-'url_roles')<>'{}'::jsonb
        or not private.opportunity_search_schema_valid(entry.value,private.opportunity_search_result_schema()#>'{properties,data}') then
        raise exception 'Inspection data accepts only valid url_roles.' using errcode='22023';
      end if;
      continue;
    end if;
    if jsonb_typeof(entry.value)<>'string' or char_length(btrim(entry.value#>>'{}')) not between 1 and 2000 then
      raise exception 'Identity fields must be nonempty strings.' using errcode='22023';
    end if;
  end loop;
  if cardinality(private.opportunity_search_identity_keys(p_identity))=0 then
    raise exception 'Supply a canonical key, institution-scoped vacancy ID or vacancy-specific URL.' using errcode='22023';
  end if;
  candidates:=private.opportunity_search_matches(p_identity);
  if cardinality(candidates)>1 then raise exception 'Ambiguous opportunity identity; preserve both records for review.' using errcode='23505'; end if;
  select to_jsonb(o) into snapshot from public.opportunities o where id=candidates[1];
  return jsonb_build_object('match_count',cardinality(candidates),'opportunity_id',candidates[1],'snapshot',snapshot,
    'effective_fields',coalesce((select fields from private.opportunity_search_merge_state where opportunity_id=candidates[1]),'{}'::jsonb));
end;
$function$
;

create function private.opportunity_payload_storage_valid(p jsonb) returns boolean
language sql stable set search_path='' as $$
 select private.opportunity_payload_schema_valid(
   (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p) where (private.opportunity_storage_schema()->'properties')?key),
   private.opportunity_storage_schema(),private.opportunity_storage_schema())
$$;

create or replace function public.opportunity_search_readiness() returns jsonb language plpgsql stable set search_path='' as $$
declare protocol private.opportunity_search_protocols; schema_ready boolean; d jsonb:=private.opportunity_search_result_schema();
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then raise exception 'A non-anonymous signed-in owner is required.' using errcode='42501'; end if;
 select p.* into protocol from private.opportunity_search_protocols p join private.opportunity_search_settings s on s.active_protocol_version=p.version;
 select bool_and(to_regprocedure(signature) is not null) into schema_ready from unnest(array[
 'private.begin_opportunity_search(uuid,uuid)','private.refresh_opportunity_search_protocol(uuid)','private.save_opportunity_search_queries(uuid,jsonb)',
 'private.inspect_opportunity_search_result(uuid,jsonb)','private.submit_opportunity_search_result(uuid,uuid,jsonb)','private.verify_opportunity_search_result(uuid,uuid)',
 'private.complete_opportunity_search(uuid,jsonb)','private.read_opportunity_search_run(uuid)','private.opportunity_canonical_input(jsonb,jsonb,text)',
 'private.opportunity_payload_storage_valid(jsonb)']) signature;
 return jsonb_build_object('ready',schema_ready and protocol.contract_version=1 and protocol.result_schema=d and d->'x-canonical-version'='5',
   'bootstrap_version',1,'protocol_version',protocol.version,'protocol_hash',protocol.protocol_hash,
   'reason',case when not schema_ready or protocol.result_schema is distinct from d then 'Install the complete canonical opportunity v5 protocol.' else null end);
end $$;


create function pg_temp.v5_evidence(oid uuid,field text,sources jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb:='[]'; s jsonb;
begin
 for s in select value from jsonb_array_elements(sources) loop
   if not (s->'supports')?field and not exists(select 1 from jsonb_array_elements_text(s->'supports') f where left(f,length(field)+2)='/'||field||'/') then continue; end if;
   -- Old receipts sometimes claimed success while the typed merge retained the old
   -- value. Those attempted source claims must not become effective provenance.
   if exists(select 1 from public.opportunity_search_receipts r
     where r.opportunity_id=oid and r.payload?field and private.opportunity_merge_present(r.payload->field)
       and ((r.result->'conflicts')?field or not coalesce((r.result#>array['snapshot',field]) @> (r.payload->field),false))
       and exists(select 1 from jsonb_array_elements(r.payload->'sources') proposed
         where private.opportunity_merge_url(proposed->>'url')=private.opportunity_merge_url(s->>'url')
         and coalesce(private.opportunity_merge_precise_time(proposed->>'checked_at')::text,proposed->>'checked_at','unknown')=
           coalesce(private.opportunity_merge_precise_time(s->>'checked_at')::text,s->>'checked_at','unknown'))) then continue; end if;
   r:=r||jsonb_build_array(s);
 end loop;
 return r;
end $$;

create function pg_temp.v5_seed(path text,v jsonb,evidence jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare policy text:=private.opportunity_merge_policy(path); r jsonb:='{}'; k text; a jsonb; quote jsonb;
begin
 if policy='entities' and jsonb_typeof(v)='array' and v<>'[]' then
   for a in select value from jsonb_array_elements(v) loop
     r:=r||pg_temp.v5_seed(path||'/@'||private.opportunity_merge_pointer(private.opportunity_merge_entity_key(split_part(path,'/',2),a)),a,evidence);
   end loop;
 elsif policy='set' and jsonb_typeof(v)='array' and v<>'[]' then
   for a in select value from jsonb_array_elements(v) loop
     r:=r||pg_temp.v5_seed(path||'/@'||private.opportunity_merge_pointer(private.opportunity_canonical_set_key(path,a#>>'{}')),a,evidence);
   end loop;
 elsif policy='salary' and jsonb_typeof(v)='object' then
   select coalesce(jsonb_object_agg(key,value),'{}') into quote from jsonb_each(v) where key=any(array['amount','min','max','currency','period','gross','model']);
   r:=r||pg_temp.v5_seed('/salary/@quote',quote,evidence);
   for k,a in select * from jsonb_each(v-array['amount','min','max','currency','period','gross','model']) loop r:=r||pg_temp.v5_seed(path||'/'||private.opportunity_merge_pointer(k),a,evidence); end loop;
 elsif policy='recursive' and jsonb_typeof(v)='object' and v<>'{}' then
   for k,a in select * from jsonb_each(v) loop r:=r||pg_temp.v5_seed(path||'/'||private.opportunity_merge_pointer(k),a,evidence); end loop;
 else r:=jsonb_build_object(path,jsonb_build_object('value',v,'evidence',evidence,'verification',case when evidence='[]' then 'unknown' else 'imported' end));
 end if;
 return r;
end $$;

update canonical_v5_stage set payload=jsonb_set(payload,'{sources}',private.opportunity_merge_sources(payload->'sources'));

do $migrate$
declare row record; k text; v jsonb; assignments text; state jsonb; evidence jsonb; invalid_fields jsonb;
begin
 -- Validate every planned row before changing any row or removing old checks.
 for row in select * from canonical_v5_stage order by opportunity_id loop
   if not private.opportunity_payload_storage_valid(row.payload) then
     select jsonb_agg(key) into invalid_fields from jsonb_each(row.payload)
       where (private.opportunity_storage_schema()->'properties')?key
       and not private.opportunity_payload_schema_valid(value,private.opportunity_storage_schema()->'properties'->key,private.opportunity_storage_schema());
     raise exception 'Canonical migration validation failed for %: %',row.payload->>'opportunity_key',invalid_fields;
   end if;
 end loop;
 for row in select * from jsonb_array_elements((select before_checks from private.opportunity_payload_releases where release='canonical-opportunity-v5')) t(v) loop
   execute format('alter table public.opportunities drop constraint %I',row.v->>'name');
 end loop;
 select string_agg(format('%1$I=(jsonb_populate_record(null::public.opportunities,$1)).%1$I',attname),',') into assignments
   from pg_attribute where attrelid='public.opportunities'::regclass and attnum>0 and not attisdropped and attname<>'id';
 for row in select * from canonical_v5_stage order by opportunity_id loop
   execute 'update public.opportunities set '||assignments||' where id=$2' using row.payload,row.opportunity_id;
   state:='{}';
   for k,v in select * from jsonb_each(row.payload) where (private.opportunity_storage_schema()->'properties')?key and key<>'sources' loop
     evidence:=pg_temp.v5_evidence(row.opportunity_id,k,row.payload->'sources');
     state:=state||pg_temp.v5_seed('/'||k,v,evidence);
   end loop;
   insert into private.opportunity_search_merge_state(opportunity_id,fields) values(row.opportunity_id,state)
     on conflict(opportunity_id) do update set fields=excluded.fields;
   update private.opportunity_payload_archive set after_snapshot=row.payload,after_state=state where release='canonical-opportunity-v5' and opportunity_id=row.opportunity_id;
 end loop;
end $migrate$;

alter table public.opportunities alter column metadata_schema_version set default 5;
alter table public.opportunities alter column personal_fit set default '{"score":null,"scale_min":0,"scale_max":10,"summary":null}'::jsonb;
alter table public.opportunities alter column rd_career_potential set default '{"score":null,"scale_min":0,"scale_max":10,"summary":null}'::jsonb;
alter table public.opportunities alter column research_career_potential set default '{"score":null,"scale_min":0,"scale_max":10,"summary":null}'::jsonb;
alter table public.opportunities add constraint opportunities_payload_v5_check check (metadata_schema_version=5 and private.opportunity_payload_storage_valid(to_jsonb(opportunities)));

update private.opportunity_payload_releases set
 after_checksum=(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb)::text,'UTF8')),'hex') from public.opportunities o),
 after_identities=(select coalesce(jsonb_agg(to_jsonb(i) order by identity_key),'[]') from private.opportunity_search_identities i)
where release='canonical-opportunity-v5';

do $$ begin
 if (select count(*) from public.opportunities)<>(select record_count from private.opportunity_payload_releases where release='canonical-opportunity-v5')
   or exists(select 1 from private.opportunity_payload_archive a join public.opportunities o on o.id=a.opportunity_id
     where a.release='canonical-opportunity-v5' and (to_jsonb(o)->'created_at' is distinct from a.before_snapshot->'created_at' or to_jsonb(o)->'updated_at' is distinct from a.before_snapshot->'updated_at'))
   or private.opportunity_context_checksum()<>(select dependent_context_checksum from private.opportunity_payload_releases where release='canonical-opportunity-v5') then
   raise exception 'Canonical migration changed a record identity/count/timestamp or private review/application context.';
 end if;
end $$;

-- Retire the actual compatibility code after all records have been converted.
drop function if exists private.align_opportunity_search_catalogue();
drop function private.opportunity_search_normalize_record(jsonb);
drop function private.opportunity_search_merge_value(jsonb,jsonb);
drop function private.opportunity_merge_alias_conflicts(jsonb);
drop function private.opportunity_merge_checklist(jsonb,text,text,text);
drop function private.opportunity_merge_input_schema_v3();


create function private.rollback_opportunity_payload_v5(p_apply boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare release private.opportunity_payload_releases; r record; a jsonb; f jsonb; assignments text; blockers jsonb:='[]'; role_sql text;
begin
 if current_user<>'postgres' then raise exception 'Administrative SQL access is required.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('opportunity-search-catalogue-v1',0));
 select * into strict release from private.opportunity_payload_releases where opportunity_payload_releases.release='canonical-opportunity-v5' for update;
 if p_apply then lock table public.opportunities in share row exclusive mode; end if;
 if release.rolled_back_at is not null then return jsonb_build_object('applied',false,'already_rolled_back',true); end if;
 if exists(select 1 from public.opportunity_search_runs where status='running') then blockers:=blockers||'"active_search_run"'::jsonb; end if;
 if (select count(*) from public.opportunities)<>release.record_count or exists(
   select 1 from private.opportunity_payload_archive a left join public.opportunities o on o.id=a.opportunity_id
     left join private.opportunity_search_merge_state s on s.opportunity_id=a.opportunity_id
   where a.release=release.release and (to_jsonb(o) is distinct from a.after_snapshot or s.fields is distinct from a.after_state)) then
   blockers:=blockers||'"catalogue_or_evidence_changed_after_migration"'::jsonb;
 end if;
 if (select coalesce(jsonb_agg(to_jsonb(i) order by identity_key),'[]') from private.opportunity_search_identities i)<>release.after_identities then blockers:=blockers||'"identities_changed"'::jsonb; end if;
 if not p_apply then return jsonb_build_object('applied',false,'blockers',blockers,'records',release.record_count); end if;
 if blockers<>'[]' then raise exception 'Migration rollback blocked: %',blockers using errcode='40001'; end if;
 lock table public.opportunities in share row exclusive mode;
 alter table public.opportunities drop constraint opportunities_payload_v5_check;
 for f in select value from jsonb_array_elements(release.before_functions) loop
   execute f->>'definition';
   execute format('revoke all on function %s from public,anon,authenticated',f->>'signature');
   for a in select value from jsonb_array_elements(coalesce(f->'acl','[]')) loop
     role_sql:=case when a->>'grantee'='PUBLIC' then 'PUBLIC' else quote_ident(a->>'grantee') end;
     execute format('grant execute on function %s to %s%s',f->>'signature',role_sql,case when a->'grantable'='true' then ' with grant option' else '' end);
   end loop;
 end loop;
 for a in select value from jsonb_array_elements(release.before_defaults) loop
   execute format('alter table public.opportunities alter column %I set default %s',a->>'name',a->>'expression');
 end loop;
 select string_agg(format('%1$I=(jsonb_populate_record(null::public.opportunities,$1)).%1$I',attname),',') into assignments
   from pg_attribute where attrelid='public.opportunities'::regclass and attnum>0 and not attisdropped and attname<>'id';
 for r in select * from private.opportunity_payload_archive where opportunity_payload_archive.release=release.release order by opportunity_id loop
   execute 'update public.opportunities set '||assignments||' where id=$2' using r.before_snapshot,r.opportunity_id;
   if r.before_state is null then delete from private.opportunity_search_merge_state where opportunity_id=r.opportunity_id;
   else update private.opportunity_search_merge_state set fields=r.before_state where opportunity_id=r.opportunity_id; end if;
 end loop;
 for a in select value from jsonb_array_elements(release.before_checks) loop execute format('alter table public.opportunities add constraint %I %s',a->>'name',a->>'definition'); end loop;
 update private.opportunity_search_settings set active_protocol_version=release.previous_protocol where singleton;
 update private.opportunity_payload_releases set rolled_back_at=clock_timestamp() where opportunity_payload_releases.release=release.release;
 return jsonb_build_object('applied',true,'records',release.record_count,'protocol',release.previous_protocol);
end $$;

insert into private.opportunity_search_protocols(version,contract_version,protocol_hash,protocol_text,result_schema)
 select 'opportunity-search-v1-canonical-5',1,encode(sha256(convert_to(p||private.opportunity_search_result_schema()::text,'UTF8')),'hex'),p,private.opportunity_search_result_schema()
 from (select $protocol$OPPORTUNITY SEARCH — CANONICAL PAYLOAD 5
BOOTSTRAP AND QUERIES
Use bootstrap contract 1. Begin with a fresh stable run UUID via private.begin_opportunity_search(search_uuid,run_uuid). Require compatible=true, pin run.definition and this returned protocol/result_schema, and follow current criteria. Retain explicit manual queries and exclusions. Reuse the exact immutable query revision for the current template/protocol; when stale, generate focused queries from current criteria and save them with private.save_opportunity_search_queries(run_uuid,queries_json). Never execute remembered payload formats.
RESEARCH
Use official vacancy, institution/lab and graduate-school sources. Verify current status, research/methods, funding, salary/contract, eligibility, supervision/contact roles, required/optional/conditional documents and their application stages. Distinguish applicant interests from demonstrated qualifications. Preserve source wording and mark uncertainty; do not invent salaries, roles, deadline times/timezones, precise start dates or numerical assessments. Rating numbers use explicit scale_min=0/scale_max=10 with a reason; unknown ratings use score:null. Existing ratings were confirmed by the owner to use this scale. New recommendations require at least 72 hours until the official deadline at actual run time. For date-only deadlines calculate conservatively from 00:00 in the established local zone, without storing that assumed time as official. Explicitly verified rolling/open-until-filled vacancies without a fixed date are eligible. Known records may receive verified updates even when no longer eligible for a new recommendation.
ONE CURRENT SCHEMA
result_schema is the complete canonical-only input contract. Resolve its JSON Schema $defs/$ref definitions. Objects reject unknown properties. People use roles arrays; requirements/documents are arrays of {text,status,stage,conditions,...}; publications are flat objects; salary amounts and units are coherent quotes; research data uses named fields and structured {label,text,source_urls} notes. Sources use {url,kind,checked_at,precision,supports,notes}; retain date precision or explicit unknowns, never fabricate a check instant. No singular/plural aliases, grouped checklists, string entities, old salary keys or format-preservation wrappers are accepted. Entity/source IDs may be omitted for new entities and are assigned by the server; reuse inspected IDs when enriching existing entities. Current catalogue records are already canonical, so do not normalize them again or run migration helpers. Historical receipts/application snapshots remain archival data.
IDENTITY, EVIDENCE AND SAVE
Before each submission use a SEPARATE execute_sql call to private.inspect_opportunity_search_result(run_uuid,identity_json). Supply opportunity_key, institution-scoped vacancy_id and vacancy URLs as available; data may include only url_roles. Read snapshot (already canonical) and effective_fields. Do not merge ambiguous identities, distinct vacancy IDs or records sharing only listing/context/application pages. Sources must explicitly cover canonical field names or escaped JSON-pointer paths. Effective evidence is bound to stored values; aggregate historical sources do not authorize every field. Rejected fields never advance evidence. Named string sets and identity-aware lists retain unspecified members; objects merge per leaf; complete assessments and salary quotes replace coherently. Equal-time disagreement conflicts unless merge_control.corrections includes the exact inspected expected value and a specific reason. Use the actual same evidence time; do not invent a later one. Explicit collection replacement or clearing also requires compare-and-set correction. Different official authorities require a reasoned, non-stale correction. Never modify user reviews, frozen applications, checklist completions or history.
Generate each item UUID once. Submit one opportunity via private.submit_opportunity_search_result(run_uuid,item_uuid,opportunity_json). Inspect field_decisions and before/saved snapshots: a receipt does not mean every proposed field won. In a SEPARATE call use private.verify_opportunity_search_result(run_uuid,item_uuid). Claim persistence only for verified:true with matching run/item/canonical ID, and report only accepted verified fields. changed_since_save or rolled_back must be acknowledged. Reuse a saved item UUID only with the identical raw payload.
RECOVERY AND FINISH
On an unsaved result/verification failure preserve evidence and UUIDs. Once per run call private.refresh_opportunity_search_protocol(run_uuid), reconcile private.read_opportunity_search_run(run_uuid), adopt the returned schema/protocol and retry the pending operation once. Do not reuse saved item IDs for adapted payloads. Stop after an approval/security denial, failed refresh or failed retry; report verified partial progress. Never run DDL, migrations, catalogue backfills, direct table writes/deletes or rollback helpers as part of a search.
Complete with private.complete_opportunity_search(run_uuid,{"status":"complete","notes":"brief factual coverage","unresolvedCount":0}); use failed for incomplete work. Separately read private.read_opportunity_search_run(run_uuid) to verify terminal status/counts. Notify only new or materially changed strong matches; successful unchanged/empty recurring runs stay quiet. Scheduled runs may reconcile a changed cadence on the existing task and confirm only a real successful task update through private.confirm_opportunity_search_schedule. Do not create/replace scheduled tasks without an explicit scheduling request. A search run never sends applications or messages to employers.
SQL
Use only currently exposed Supabase connector execute_sql tools in this resolved project. Statements use SELECT private.helper(...) with explicit ::uuid/::jsonb arguments. Serialize JSON safely: escape every backslash and apostrophe in an E-string and reject NUL. Available helpers: begin_opportunity_search(uuid,uuid), save_opportunity_search_queries(uuid,jsonb), inspect_opportunity_search_result(uuid,jsonb), submit_opportunity_search_result(uuid,uuid,jsonb), verify_opportunity_search_result(uuid,uuid), refresh_opportunity_search_protocol(uuid), read_opportunity_search_run(uuid), complete_opportunity_search(uuid,jsonb), confirm_opportunity_search_schedule(uuid,uuid,text,jsonb).
$protocol$ p) text;
update private.opportunity_search_settings set active_protocol_version='opportunity-search-v1-canonical-5' where singleton;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
   and (p.proname like 'opportunity_%' or p.proname in ('validate_opportunity_search_result','submit_opportunity_search_result','inspect_opportunity_search_result','rollback_opportunity_payload_v5')) loop
   execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;

grant execute on function private.opportunity_storage_schema(),private.opportunity_search_result_schema() to authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace=pg_my_temp_schema() and p.proname like 'v5_%' loop
   execute format('drop function %s',f.signature);
 end loop;
end $$;


commit;
