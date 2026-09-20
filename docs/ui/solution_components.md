---
title: Solution UI Helper Components
description: "Solution-facing reference for reusable UI helpers: dialogs, comboboxes, enum selects, inputs, headers, cards, icons, queues, and image helpers."
tags:
  - ui
  - components
  - solution-patterns
  - solution-development
related:
  - ui/overview.md
  - ui/form_control.md
  - ui/autocomplete.md
  - ui/modal.md
  - ui/progress.md
  - ui/operational_ui.md
  - ui/mobile_capture_scanning.md
---

# Solution UI Helper Components

Common helper components by import and use case. For `Button`, `Card`, `Chip`,
`Input`, `Select`, `Checkbox`, `Tabs`, `Sidebar`, `ModalDialog`, `DataTable`,
and `Typography`, use their dedicated `docs/ui/` pages. Where a row below links
to a dedicated page, open that page for full prop tables.

## Form And Field Helpers

| Component | Import | Use when |
| --- | --- | --- |
| [`FieldFormControl` and typed variants](./field_form_control.md) | `components/field_form_control` | Render the correct form control for a table field or field type. |
| `LabelOnTopFormField` | `components/label_on_top_form_field` | `Form.Field` with label above the control. |
| `LabelOnLeftFormField` / `LabelOnLeftFormFieldWrapper` | `components/label_on_left_form_field` | Compact label-left field layout. |
| `FormCards` | `components/form_cards` | Repeated form relation as cards. |
| `FormLabel` / `FormHelperText` | `components/form_label`, `components/form_helper_text` | Standard labels and helper text for custom controls. |
| [`Slider`](./slider.md) | `components/slider` | Pick a numeric value from a range with a draggable track. |
| [`DurationInput` / `SplitDurationInput`](./duration_input.md) | `components/duration_input`, `components/split_duration_input` | Enter a time duration as one field or split unit fields. |
| [`OneTimePasswordInput`](./one_time_password.md) | `components/one_time_password_input` | Segmented one-time-password / verification code entry. |

Use these inside [Form](./form.md) flows. Do not use them as a substitute for
`Form` state or validation.

## Selection Helpers

| Component | Import | Use when |
| --- | --- | --- |
| `QueryCombobox` | `components/query_combobox` | Searchable SQL-backed options. |
| `TableRecordSelect` | `components/table_record_select` | Select one record from a table. |
| `EnumSelect` / `EnumLikeSelect` | `components/enum_select` | Select an enum or enum-like value. |
| `EachSelect` | `components/each_select` | Options are rendered from a table with `<Each>`-style iteration. |
| [`MultiSelectDropdown`](./multi_select_dropdown.md) | `components/multi_select_dropdown` | Pick zero-or-more items from a dropdown driven by selected/available SQL queries. |
| [`Radio` / `RadioGroup`](./radio.md) | `components/radio`, `components/radio_group` | Single-choice option as radio buttons, grouped with shared form state. |
| [`CountrySelect`](./country_select.md) | `components/country_select` | Searchable country picker backed by the country enum. |
| [`SelectTimeZone`](./select_timezone.md) | `components/select_timezone` | Searchable IANA timezone picker. |
| [`DateRangeFilter` / `DateRangeCalendars`](./date_range.md) | `components/date_range` | Start/end date range filters. |
| `ChipButton` | `components/chip_button` | Toggle/selectable chip bound to a scalar or record field. |

For simple static options, prefer [Select](./select.md). For search-backed
inputs, see [Autocomplete](./autocomplete.md).

## Action Dialogs

| Component | Import | Use when |
| --- | --- | --- |
| [`AutoInsertDialog`](./auto_dialogs.md), `AutoInsertButton`, `AutoInsertIconButton`, `AutoInsertMenuItem` | `components/auto_insert_dialog` | Generated create dialog for a table. |
| [`AutoUpdateDialog`](./auto_dialogs.md), `AutoUpdateButton`, `AutoUpdateIconButton`, `AutoUpdateMenuItem` | `components/auto_update_dialog` | Generated edit dialog for one record. |
| `DeleteRecordDialog`, `DeleteRecordButton`, `DeleteRecordIconButton`, `DeleteRecordMenuItem` | `components/delete_record_dialog` | Standard delete confirmation. |
| `ConfirmDangerDialog` | `components/confirm_danger_dialog` | Confirmation for destructive actions. |
| `DownloadButton` | `components/download_button` | CSV or generated-content downloads from a SQL query. |

Use these helpers for standard CRUD actions. For bespoke multi-step mutations,
write a normal [Form](./form.md) or event handler procedure.

## Layout, Navigation, And Display Helpers

| Component | Import | Use when |
| --- | --- | --- |
| [`Navbar` / `TransparentNavbar`](./navbar.md) | `components/navbar`, `components/transparent_navbar` | Top navigation (solid or transparent over a hero). |
| `Menu` | `components/menu` | Dropdown/action menu. |
| `ButtonGroup` | `components/button_group` | Group related buttons (or segmented toggle-style actions) as one unit. |
| `Link` | `components/link` | Styled navigation link. |
| [`PageHeader`](./page_header.md) | `components/page_header` | Title, chips, actions, and header layout. |
| [`PageTitleHeader`](./page_header.md) | `components/page_header` | Standard title/action header for custom pages. |
| `SuperSimpleHeader` | `components/super_simple_header` | Record-page title with optional Edit/Delete buttons (uses current table/record context). |
| `DashboardHeader` | `components/dashboard_header` | Dashboard title/subheader with an optional logo. |
| `TimeGreeting` / `CurrentUserName` / `CurrentUserFirstName` | `components/greeting` | Time-of-day greeting and current user name display. |
| `Stat` / `StatRow` | `components/stat_row` | Compact dashboard metrics. |
| `InlineRecordDisplay` / `InlineFieldDisplay` | `components/inline_record_display`, `components/inline_field_display` | Inline field/record display from table metadata. |
| `BooleanIcon`, `FieldRow`, `BoolFieldRow` | `components/field_display` | Compact boolean icons and label/value rows for custom detail panels. |
| `StatusChip` | `components/status_chip` | App-defined status labels and chip variants driven by SQL conditions. |
| `MarkdownDisplay` | `components/markdown_display` | Render a markdown SQL string as styled HTML. |
| `NotesCard` | `components/notes_card` | Inline view/edit card for a record's notes (or chosen) field. |
| `SimpleLinkRelationCard` | `components/simple_link_relation_card` | Card listing related records from another table with links. |
| `XmlPayloadModal` | `components/xml_payload_viewer` | Modal for inspecting XML payloads from a SQL expression. |
| `TwoColumnDisplayCard` / `TwoColumnFormLayout` | `components/two_column_display_card`, `components/two_column_form_layout` | Two-column detail pages or forms. |
| `Report` / `ReportParameters` | `components/report` | A single named report panel (with optional parameters) composed inside a report page. |
| [`SimplePivotTable`](./simple_pivot_table.md) | `components/simple_pivot_table` | Pivot / cross-tab table built from a query. |
| `SingleColumnFixedRowsTable` | `components/single_column_fixed_rows_table` | Fixed set of labeled rows in one column (key/value style detail table). |
| `StateStatusSwitch` | `components/state_status_switch` | Switch UI between loading/error/success states for an async/pending flow. |
| [`AddToCalendarButton`](./add_to_calendar.md) | `components/add_to_calendar` | Menu button to add an event to Google Calendar, Outlook, or download an `.ics`. |
| `Confetti` | `components/confetti` | Celebratory confetti animation on a success milestone. |
| `TextReveal` | `components/text_reveal` | Scroll-driven letter-by-letter text reveal animation for landing pages. |
| `Params` | `components/params` | Display/debug route or query parameters. |
| `AccountMenu` | `components/account_menu` | User/app switcher menu with optional compact mode and app links. |
| `SplitView` | `components/split_view` | Main content with a collapsible, optionally resizable inspector pane. |
| `DocumentComparison` | `components/document_comparison` | Show a Lexical document comparison with previous/current labels. |
| `FileTypeIcon` / `fileTypeIconKindSql` | `components/file_type_icon` | Render a file-kind icon from content type, filename, or drive item kind. |
| `VirtualizedChatTimeline` / `defineVirtualizedChatTimelineState` | `components/virtualized_chat_timeline` | Render a large chat/event history with virtualized scrolling, search, and minimap state. |

## Operational Helpers

| Component | Import | Use when |
| --- | --- | --- |
| `WorkQueue` | `components/work_queue` | Queue-like columns, rows, headers, and footers. |
| `QrScanner` | `components/qr_scanner` | Camera QR scanning. |
| [`ExpandableImage`](./images.md) | `components/expandable_image` | Thumbnail-to-large-image view. |
| [`EditableImageThumbnail`](./images.md) | `components/editable_image_thumbnail` | Thumbnail for an `image_set` field group with upload/replace controls. |
| [`ImageDialog`](./images.md) | `components/image_dialog` | Dialog to view, replace, or remove a record's `image_set` image. |
| [`ImageGallery`](./images.md) | `components/image_gallery` | Image/photo gallery. |
| [`PdfMarkupViewer` / `PdfMarkupEditor`](./pdf_markup.md) | `components/pdf_markup` | View or annotate PDF documents (pen, highlight, text). |
| `PageKeyboardShortcuts` | `components/keyboard_shortcuts` | Register page-scoped keyboard shortcuts for actions on a page. |
| `DownloadButton` | `components/download_button` | Download generated content. |
| `Skeleton` | `components/skeleton` | Loading placeholder. |
| [`CircularProgress`](./progress.md) | `components/circular_progress` | Circular loading/progress indicator. |
| `CollapseControl` | `components/collapse_component` | Expand/collapse section control. |

## Icons

`SvgIcon` (`components/svg_icon`) is the base wrapper for rendering custom SVG
icons with palette color and font-size sizing. The `components/icons/*` set is a
collection of brand icons built on `SvgIcon`; import each from its own module
(`components/icons/<name>`).

| Component | Import |
| --- | --- |
| `ClaudeIcon` | `components/icons/claude` |
| `DeepSeekIcon` | `components/icons/deepseek` |
| `DiscordIcon` | `components/icons/discord` |
| `EmailIcon` | `components/icons/email` |
| `FacebookIcon` | `components/icons/facebook` |
| `GeminiIcon` | `components/icons/gemini` |
| `GithubIcon` | `components/icons/github` |
| `GmailIcon` | `components/icons/gmail` |
| `GoogleIcon` | `components/icons/google` |
| `GoogleCalendarIcon` | `components/icons/google_calendar` |
| `InstagramIcon` | `components/icons/instagram` |
| `LinkedInIcon` | `components/icons/linkedin` |
| `MetaIcon` | `components/icons/meta` |
| `OpenAIIcon` | `components/icons/openai` |
| `OutlookCalendarIcon` | `components/icons/outlook_calendar` |
| `OutlookEmailIcon` | `components/icons/outlook_email` |
| `PostmarkIcon` | `components/icons/postmark` |
| `SidebarIcon` | `components/icons/sidebar` |
| `TelegramIcon` | `components/icons/telegram` |
| `TetherIcon` | `components/icons/tether` |
| `XIcon` | `components/icons/x` |
| `YolmIcon` | `components/icons/yolm` |
| `YouTubeIcon` | `components/icons/youtube` |
| `ZoomIcon` | `components/icons/zoom` |

## Enums And Field Groups

These are generation-time helpers, not UI components, but solution code reaches
for them alongside the components above.

| Helper | Import | Use when |
| --- | --- | --- |
| `countryEnum()` (also `countries`, `countryMap`) | `enums/country` | Add a country enum to a table, or look up country metadata. |
| `usStateEnum()` | `enums/us_state` | Add a US state enum to a table. |
| `imageSetFieldGroup()` / `simpleImageSetFieldGroup()` | `field_groups/image_set` | Add a multi-variant image field group (with upload/variant URL helpers) to a table. |
| `formatPhoneNumberStringValue()` | `components/phone_number_string` | Build an `Sql` expression that formats a phone-number string (handles extensions and country-aware formatting). |

## Rule Of Thumb

Use helpers when they fit directly. Otherwise use `Data`, `Form`, event
handlers, `ModalDialog`, and base components.

For queue screens, mobile scan/capture flows, and image evidence workflows, see
[Operational UI Components](./operational_ui.md) and
[Mobile Capture And Scanning](./mobile_capture_scanning.md).
