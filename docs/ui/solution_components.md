---
title: Solution UI Helper Components
description: "Catalog of reusable UI helper components by import and use case: fields, selectors, CRUD dialogs, headers, display, queues, images, and icons."
tags:
  - ui
  - components
  - solution-patterns
  - solution-development
related:
  - ui/overview.md
  - ui/operational_ui.md
  - ui/reusable_helpers.md
  - ui/page_templates.md
  - ui/mobile_capture_scanning.md
---

# Solution UI Helper Components

Catalog of helper components, one row each. Linked rows have a dedicated page;
otherwise the exported TypeScript props in the listed module are the contract.
Base components (`Button`, `Card`, `Input`, `Select`, `Tabs`, `ModalDialog`,
`DataTable`, `Typography`, ...) have their own `docs/ui/` pages. Routed pages
are in [Page Templates](./page_templates.md); guidance for dense screens is in
[Operational UI](./operational_ui.md).

Use a helper when it fits directly; otherwise compose `Data`, `Form`,
`ModalDialog`, and base components.

## Form And Field Helpers

Use these inside [Form](./form.md); they do not replace `Form` state or
validation.

| Component | Import | Use when |
| --- | --- | --- |
| [`FieldFormControl` + typed variants](./field_form_control.md) | `components/field_form_control` | Control chosen from a table field or field type. |
| `LabelOnTopFormField` | `components/label_on_top_form_field` | `Form.Field` with label above. |
| `LabelOnLeftFormField` / `LabelOnLeftFormFieldWrapper` | `components/label_on_left_form_field` | Compact label-left layout. |
| `FormCards` | `components/form_cards` | Repeated form relation as cards. |
| `FormLabel` / `FormHelperText` | `components/form_label`, `components/form_helper_text` | Labels/helper text for custom controls. |
| [`Slider`](./slider.md) | `components/slider` | Numeric range. |
| [`DurationInput` / `SplitDurationInput`](./duration_input.md) | `components/duration_input`, `components/split_duration_input` | Duration as one field or split units. |
| [`OneTimePasswordInput`](./one_time_password.md) | `components/one_time_password_input` | Segmented verification code. |

## Selection Helpers

Static options: [Select](./select.md). Search-backed inputs:
[Autocomplete](./autocomplete.md).

| Component | Import | Use when |
| --- | --- | --- |
| `QueryCombobox` | `components/query_combobox` | Searchable SQL-backed options or lookups. |
| `TableRecordSelect` | `components/table_record_select` | Pick one record from a table (default foreign-key control). |
| `EnumSelect` / `EnumLikeSelect` | `components/enum_select` | Enum variants with labels/colors from `system.enum_`. |
| `EachSelect` | `components/each_select` | Options iterated from a table, `<Each>`-style. |
| [`MultiSelectDropdown`](./multi_select_dropdown.md) | `components/multi_select_dropdown` | Zero-or-more items from selected/available SQL queries. |
| [`Radio` / `RadioGroup`](./radio.md) | `components/radio`, `components/radio_group` | Single choice as radio buttons. |
| [`CountrySelect`](./country_select.md) | `components/country_select` | Country enum picker. |
| [`SelectTimeZone`](./select_timezone.md) | `components/select_timezone` | IANA timezone picker. |
| [`DateRangeFilter` / `DateRangeCalendars`](./date_range.md) | `components/date_range` | Start/end date filters. |
| `ChipButton` | `components/chip_button` | Toggle chip bound to a scalar or record field. |

## CRUD Dialogs And Downloads

For bespoke multi-step mutations, write a [Form](./form.md) or use
[ActionButton](./action_button.md).

| Component | Import | Use when |
| --- | --- | --- |
| [`AutoInsertDialog`](./auto_dialogs.md), `AutoInsertButton`, `AutoInsertIconButton`, `AutoInsertMenuItem` | `components/auto_insert_dialog` | Generated create dialog for a table. |
| [`AutoUpdateDialog`](./auto_dialogs.md), `AutoUpdateButton`, `AutoUpdateIconButton`, `AutoUpdateMenuItem` | `components/auto_update_dialog` | Generated edit dialog for one record. |
| `DeleteRecordDialog`, `DeleteRecordButton`, `DeleteRecordIconButton`, `DeleteRecordMenuItem` | `components/delete_record_dialog` | Standard delete confirmation. |
| `ConfirmDangerDialog` | `components/confirm_danger_dialog` | Confirmation for destructive actions. |
| `DownloadButton` | `components/download_button` | CSV or generated-content download from a SQL query. |

Insert, update, and delete helpers resolve the current table/record context;
pass `table`, `recordId`, or parent fields explicitly outside a record context.

## Headers, Navigation, And Layout

| Component | Import | Use when |
| --- | --- | --- |
| [`Navbar` / `TransparentNavbar`](./navbar.md) | `components/navbar`, `components/transparent_navbar` | Top navigation (in-app / landing page). |
| [`Sidebar`](./sidebar.md) | `components/sidebar` | Multi-section app shell. |
| `Menu` | `components/menu` | Dropdown/action menu. |
| `ButtonGroup` | `components/button_group` | Related or segmented buttons. |
| [`Link`](./breadcrumbs.md#link) | `components/link` | Styled anchor; `backLink` returns to a list with its filters. |
| [`PageHeader`](./page_header.md) | `components/page_header` | Title, chips, actions header layout. |
| [`PageTitleHeader`](./page_header.md#pagetitleheader) | `components/page_header` | Title + actions header for custom pages. |
| `SuperSimpleHeader` | `components/super_simple_header` | Record title with optional Edit/Delete (current record context). |
| `DashboardHeader` | `components/dashboard_header` | Dashboard title/subheader with optional logo. |
| `AccountMenu` | `components/account_menu` | User/app switcher menu, optional compact mode. |
| `SplitView` | `components/split_view` | Main content plus collapsible, optionally resizable inspector. |
| `TwoColumnDisplayCard` / `TwoColumnFormLayout` | `components/two_column_display_card`, `components/two_column_form_layout` | Two-column detail pages or forms. |
| `CollapseControl` | `components/collapse_component` | Expand/collapse a section without route state. |
| `PageKeyboardShortcuts` | `components/keyboard_shortcuts` | Page-scoped keyboard shortcuts. |

## Display Helpers

| Component | Import | Use when |
| --- | --- | --- |
| `Stat` / `StatRow` | `components/stat_row` | Compact KPI metrics (see [Reporting](./reporting.md)). |
| `InlineRecordDisplay` / `InlineFieldDisplay` | `components/inline_record_display`, `components/inline_field_display` | Inline record references / typed field values. |
| [`BooleanIcon`, `FieldRow`, `BoolFieldRow`](./reusable_helpers.md#boolean-and-field-display) | `components/field_display` | Boolean icons and label/value rows for custom detail panels. |
| [`StatusChip`](./reusable_helpers.md#statuschip) | `components/status_chip` | Chip label/variant/color chosen by SQL conditions. |
| [`XmlPayloadModal`](./reusable_helpers.md#xmlpayloadmodal) | `components/xml_payload_viewer` | Inspect an XML payload from a SQL expression. |
| `MarkdownDisplay` | `components/markdown_display` | Render a markdown SQL string. |
| `NotesCard` | `components/notes_card` | Inline view/edit of a record's notes field. |
| `SimpleLinkRelationCard` | `components/simple_link_relation_card` | Related records with links. |
| `Report` / `ReportParameters` | `components/report` | One named report panel with optional parameters. |
| [`SimplePivotTable`](./simple_pivot_table.md) | `components/simple_pivot_table` | Pivot / cross-tab from a query. |
| `SingleColumnFixedRowsTable` | `components/single_column_fixed_rows_table` | Fixed labeled key/value rows. |
| `StateStatusSwitch` | `components/state_status_switch` | Switch between loading/error/success UI for a pending flow. |
| `TimeGreeting` / `CurrentUserName` / `CurrentUserFirstName` | `components/greeting` | Greeting and current user name. |
| `DocumentComparison` | `components/document_comparison` | Lexical document comparison with previous/current labels. |
| [`DocumentEditorWorkspace`](./document_editor_workspace.md) | `components/document_editor_workspace` | Document editor with live PDF preview and info tabs. |
| `VirtualizedChatTimeline` / `defineVirtualizedChatTimelineState` | `components/virtualized_chat_timeline` | Large chat/event history with virtualized scrolling, search, minimap. |
| `FileTypeIcon` / `fileTypeIconKindSql` | `components/file_type_icon` | File-kind icon from content type, filename, or drive item kind. |
| [`AddToCalendarButton`](./add_to_calendar.md) | `components/add_to_calendar` | Add event to Google/Outlook or download `.ics`. |
| `Confetti` / `TextReveal` | `components/confetti`, `components/text_reveal` | Success celebration / scroll-driven landing-page text reveal. |
| `Params` | `components/params` | Display/debug route or query parameters. |

## Queues, Capture, Images, And Loading

| Component | Import | Use when |
| --- | --- | --- |
| [`WorkQueue`](./operational_ui.md#workqueue) | `components/work_queue` | Keyboard-driven queue with selected-row footer. |
| [`QrScanner`](./mobile_capture_scanning.md) | `components/qr_scanner` | Camera QR scanning. |
| [`ExpandableImage`, `EditableImageThumbnail`, `ImageDialog`, `ImageGallery`](./images.md) | `components/expandable_image`, `components/editable_image_thumbnail`, `components/image_dialog`, `components/image_gallery` | Image thumbnails, `image_set` upload/replace, galleries. |
| [`PdfMarkupViewer` / `PdfMarkupEditor`](./pdf_markup.md) | `components/pdf_markup` | View or annotate PDFs. |
| `Skeleton` | `components/skeleton` | Loading placeholder; see [loading states](./operational_ui.md#loading-and-progressive-disclosure). |
| [`CircularProgress`](./progress.md) | `components/circular_progress` | Spinner (the default `Data` pending fallback). |

## Icons

`SvgIcon` (`components/svg_icon`) renders custom SVG icons with palette color
and font-size sizing. Brand icons built on it are imported one per module from
`components/icons/<name>`: `ClaudeIcon` (`claude`), `DeepSeekIcon`,
`DiscordIcon`, `EmailIcon`, `FacebookIcon`, `GeminiIcon`, `GithubIcon`,
`GmailIcon`, `GoogleIcon`, `GoogleCalendarIcon` (`google_calendar`),
`InstagramIcon`, `LinkedInIcon`, `MetaIcon`, `OpenAIIcon`,
`OutlookCalendarIcon` (`outlook_calendar`), `OutlookEmailIcon`
(`outlook_email`), `PostmarkIcon`, `SidebarIcon`, `TelegramIcon`, `TetherIcon`,
`XIcon`, `YolmIcon`, `YouTubeIcon`, `ZoomIcon`. Module names are the
lowercase brand name unless shown. Material icons: see [Icons](./icons.md).

## Enums And Field Groups

Generation-time helpers often used alongside these components:

| Helper | Import | Use when |
| --- | --- | --- |
| `countryEnum()` (also `countries`, `countryMap`) | `enums/country` | Country enum on a table, or country metadata. |
| `usStateEnum()` | `enums/us_state` | US state enum on a table. |
| `imageSetFieldGroup()` / `simpleImageSetFieldGroup()` | `field_groups/image_set` | Multi-variant image field group with upload/variant URL helpers. |
| `formatPhoneNumberStringValue()` | `components/phone_number_string` | `Sql` that formats a phone string (extensions, country-aware). |
