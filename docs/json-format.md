# Content and configuration JSON

The Versions panel has separate export and import actions for content and configuration.
Export the content file, edit its `data` object in another editor or context, then use
**Import content** to replace editable content in the selected CV version. You keep its version name,
design and other settings. The import removes public entries absent from the file.
Importing into the empty template opens an editable draft.

**Bypass privacy proxy** is off by default and applies to both content export and import.
With it off, exports apply contact samples, selected field-type masks, and manual wording
from **CV Studio → Privacy**, then omit hidden or privacy-excluded sections and entries.
Manual replacements apply last. Fields without a replacement continue to use the current
content and applicable automatic masking.

Content imports preserve the current version's original contacts, automatically protected
fields, protected sections and protected entries. For an existing manual replacement,
imported text updates the replacement while retaining its original CV field. Keep section
and item IDs stable so privacy settings follow the same content. If you remove a public section
that contains a private entry, the import keeps the section for that entry.
The import copies other editable text as written; exclamation punctuation has no privacy meaning.

With bypass enabled, exports contain all original content, including header/contact fields
and hidden sections/entries. Imports can overwrite those originals. The checkbox resets to
off when you switch versions and never changes configuration imports.

**Import configuration** replaces design and settings while retaining the CV's text,
entries and custom sections. Each action accepts only its matching format. Invalid files
leave the document unchanged. You cannot import the old `cv-builder/cv` format, raw state
objects, or browser-storage wrappers. Existing split `cv-builder/content` and `cv-builder/config` files remain valid imports; new exports use `cv-harness` names. There is no combined export.

Filenames use the selected version title, for example `engineering-2026-content-v7.json`
and `engineering-2026-config-v7.json`. Unsaved drafts use the `cv-backup` prefix.

## Content file

A minimal valid content file is:

```json
{
  "format": "cv-harness/content",
  "formatVersion": 1,
  "cvVersion": 7,
  "exportedAt": "2026-09-19T12:00:00.000Z",
  "data": {
    "contact": {
      "name": "Alex Example",
      "location": "",
      "role": "Software Engineer",
      "email": "",
      "phone": "",
      "website": "",
      "linkedin": "",
      "github": ""
    },
    "about": { "text": "Your updated introduction." },
    "education": [],
    "experience": { "jobs": [] },
    "languages": [],
    "hobbies": [],
    "customSections": [],
    "sidebarSections": [],
    "sectionNames": {}
  }
}
```

Keep the wrapper, required properties, and JSON types intact. Empty strings and arrays
are valid. Design, language, layout, visibility, completion and anonymization settings
do not belong in this file. The importer rejects unknown fields.

Each entry has a required nonempty `id`. Optional text properties are `name`, `title`,
`company`, `institution`, `sub`, `place`, `start`, `end`, `bullets`, `desc`, `thesis`,
`coursesText` and `level`. `state` may be `planned`, `ongoing` or `complete`; you can
edit and display it only in custom body sections.
`levelValue` is a finite number. Not every entry type displays every property.

Custom body sections have `id`, `name`, and `entries`; optional `entryMode` is `fields`
or `textarea`, `text` contains textarea content, and `fields` lists enabled content
fields (`title`, `institution`, `place`, `start`, `end`, `state`, `desc`). Sidebar
sections have `id`, `name`, `levelType` (`experience`, `years`, or `null`) and `items`.
`sectionNames` maps section IDs to custom labels.

Keep IDs stable when editing existing items or sections: layout, visibility and
privacy settings refer to those IDs. Give new entries unique IDs. Custom section IDs
must be unique and cannot use the built-in IDs `header`, `about`, `education`, `jobs`,
`languages`, or `hobbies`. Item IDs must be unique across the document and different
from section IDs. The import adds new sections to the layout and may discard settings
tied to removed IDs during normalization.

Unsafe web/email values remain text rather than active links. Privacy-respecting exports
keep other public content; automatic masks do not identify every private detail.
Use the Privacy editor to replace specific wording, such as changing "supervised by John Doe"
to "supervised by a qualified person", without changing the Content field.

## Configuration file

Configuration files use the same wrapper with `"format": "cv-harness/config"`.
Their `data` object contains exactly:

| Property | Meaning |
| --- | --- |
| `lang` | App language, `de` or `en` |
| `design` | Typography, fonts, colors, spacing and other design controls |
| `disabled` | Hidden section IDs |
| `completedSections` | Completed/locked section IDs |
| `keepTogetherSections` | Sections kept together during pagination |
| `anonymization` | Excluded section/item IDs, optional `proxyFields`, and sparse `fieldOverrides` |
| `sectionHeaderSizes` | Section ID to heading-size setting |
| `bodyOrder`, `sidebarOrder` | Section ordering |
| `hiddenItems` | Hidden item IDs |

Configuration files contain privacy replacement values, but do not copy original contacts,
CV text or entry contents. Section/item IDs can still carry user-chosen labels. Applying
configuration to different content preserves its originals and applies ID-specific settings
where IDs match. Unspecified design properties use the app defaults, replacing the
previous design values.

`anonymization.proxyFields` accepts `company`, `institution`, `place`, and `dates`; `dates`
covers both start and end values. `anonymization.fieldOverrides` is an optional object that
stores only fields whose privacy value differs from their original. An absent key uses the
current original and applicable automatic masking; an empty string is an intentional blank.
Resetting a replacement, or setting it equal to its original, removes the stored key. Changes
to other original fields do not create overrides.

Keys encode the field's identity as JSON; they do not use array positions:

```json
{
  "excludedSections": [],
  "excludedItems": [],
  "proxyFields": ["company", "dates"],
  "fieldOverrides": {
    "[\"about\",\"text\"]": "Worked under the supervision of a qualified person.",
    "[\"item\",\"job-1\",\"place\"]": "European region"
  }
}
```

Supported key forms are `["contact", field]`, `["about", "text"]`,
`["item", itemId, field]`, `["section", sectionId, "name" or "text"]`, and
`["heading", sectionId]`. Text replacements are strings; an item's `levelValue` can also
be a finite number, and `state` retains its supported enum values. The importer rejects
invalid keys and value types. Normalization removes overrides for deleted items and sections.
You can reorder or move an existing item without losing its override, which uses the stable item ID.
This map stays in local state and configuration backups; cloud snapshots contain only the
resolved privacy content, never the original-to-replacement map.

Both files are unencrypted JSON, limited to 5 MiB per import. For a complete backup,
enable bypass when exporting content and export configuration too. To restore everything,
enable bypass when importing content, then import configuration.

`design.contactLayout` accepts `side`, `below`, `sidebar`, or `footer`. Name and
professional title remain in the header. The other contact fields can appear in
a built-in, non-deletable sidebar section or repeat at the bottom of every PDF
page. They continue to use the same `contact` data and privacy substitutions;
the sidebar Contact section is not a custom section or a `sidebarOrder` entry.
Its visibility toggle stores `sidebar-contact` in `disabled`, independently of
the header's name and title.

`design.contactItemSpacing` controls the gap between contact details in every
contact layout. The Header design control ranges from 0 to 12 mm in 0.5 mm steps
and defaults to `"2mm"`.
