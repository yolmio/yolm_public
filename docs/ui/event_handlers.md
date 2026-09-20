---
title: Event Handlers
description: Handle DOM events, window events, and document events in Yolm applications.
tags:
  - ui
  - events
  - handlers
  - dom
---

# Event Handlers

Yolm provides several ways to handle user interactions and browser events.

## Component Events

Most UI components accept event handler props:

```tsx
<Button
  onClick={(s) => {
    s.setScalar("clicked", sql.true);
    s.navigate(sql.lit`/next-page`);
  }}
>
  Click Me
</Button>

<Input
  value={sql`input_value`}
  onInput={(s) => {
    s.setScalar("input_value", sql`target_value`);
  }}
  onBlur={(s) => {
    s.setScalar("touched", sql.true);
  }}
  onFocus={(s) => {
    s.setScalar("focused", sql.true);
  }}
/>
```

## Event Object

Inside event handlers, you have access to event properties via SQL:

```tsx
<div
  onClick={(s) => {
    // Mouse position
    s.debugExpr(sql`event.client_x`);
    s.debugExpr(sql`event.client_y`);

    // Modifier keys
    s.if(sql`event.ctrl_key`, (s) => {
      s.debugExpr(sql.lit`Ctrl was held`);
    });
  }}
  onKeyDown={(s) => {
    // Key information
    s.if(sql`event.key = 'Enter'`, (s) => {
      s.statements(handleSubmit);
    });

    // Prevent default
    s.event.preventDefault();
  }}
/>
```

### Available Event Properties

| Property | Type | Description |
|----------|------|-------------|
| `event.key` | `string` | Key pressed (for keyboard events) |
| `event.code` | `string` | Physical key code |
| `event.client_x` | `number` | Mouse X coordinate |
| `event.client_y` | `number` | Mouse Y coordinate |
| `event.ctrl_key` | `boolean` | Ctrl key pressed |
| `event.shift_key` | `boolean` | Shift key pressed |
| `event.alt_key` | `boolean` | Alt key pressed |
| `event.meta_key` | `boolean` | Meta/Cmd key pressed |
| `target_value` | `string` | Input element value |
| `target_checked` | `boolean` | Checkbox/radio checked state |

## Event Methods

Control event behavior:

```tsx
<form
  onSubmit={(s) => {
    s.event.preventDefault();  // Prevent form submission
    s.event.stopPropagation(); // Stop event bubbling
    // Handle submission manually
  }}
>
  ...
</form>
```

## EventHandlers Component

Register global window and document event handlers:

```tsx
import { EventHandlers } from "std/ui";

<EventHandlers
  window={{
    resize: (s) => {
      s.window.getInnerWidth("window_width");
    },
    scroll: (s) => {
      s.window.getScrollY("scroll_y");
    },
  }}
  document={{
    keydown: (s) => {
      // Global keyboard shortcuts
      s.if(sql`event.key = 's' and (event.ctrl_key or event.meta_key)`, (s) => {
        s.event.preventDefault();
        // Save action
      });
    },
  }}
  mount={(s) => {
    // Called when component mounts
    s.debugExpr(sql.lit`Component mounted`);
  }}
/>
```

## useEventHandlers Hook

Alternative syntax for registering event handlers:

```tsx
function MyComponent() {
  useEventHandlers({
    window: {
      resize: (s) => {
        s.window.getInnerWidth("window_width");
        s.setScalar("is_mobile", sql`window_width < 768`);
      },
    },
    mount: (s) => {
      s.debugExpr(sql.lit`Mounted`);
    },
  });

  return <div>...</div>;
}
```

## Common Event Types

### Mouse Events

```tsx
<div
  onClick={(s) => { }}
  onDoubleClick={(s) => { }}
  onMouseDown={(s) => { }}
  onMouseUp={(s) => { }}
  onMouseEnter={(s) => { }}
  onMouseLeave={(s) => { }}
  onMouseMove={(s) => { }}
/>
```

### Keyboard Events

```tsx
<input
  onKeyDown={(s) => {
    s.if(sql`event.key = 'Escape'`, (s) => {
      s.setScalar("dialog_open", sql.false);
    });
    s.if(sql`event.key = 'Enter' and not event.shift_key`, (s) => {
      s.event.preventDefault();
      // Submit
    });
  }}
  onKeyUp={(s) => { }}
/>
```

### Form Events

```tsx
<input
  onInput={(s) => {
    s.setScalar("value", sql`target_value`);
  }}
  onChange={(s) => {
    // Fired on blur for inputs, immediately for checkboxes/selects
  }}
  onFocus={(s) => {
    s.setScalar("focused", sql.true);
  }}
  onBlur={(s) => {
    s.setScalar("focused", sql.false);
    s.setScalar("touched", sql.true);
  }}
/>

<form
  onSubmit={(s) => {
    s.event.preventDefault();
    // Handle form submission
  }}
/>
```

### Focus Events

```tsx
<div
  onFocusIn={(s) => {
    // Fired when element or any descendant gains focus
  }}
  onFocusOut={(s) => {
    // Fired when element or any descendant loses focus
  }}
/>
```

### Drag Events

```tsx
<div
  draggable
  onDragStart={(s) => {
    s.setScalar("dragging", sql.true);
  }}
  onDragEnd={(s) => {
    s.setScalar("dragging", sql.false);
  }}
  onDragOver={(s) => {
    s.event.preventDefault(); // Required to allow drop
  }}
  onDrop={(s) => {
    // Handle drop
  }}
/>
```

## Event Handler Objects

For more control, use an object instead of a function:

```tsx
<Button
  onClick={{
    procedure: (s) => {
      s.event.preventDefault();
      s.event.stopPropagation();
      s.debugExpr(sql.lit`Clicked`);
    },
    // Additional options
    detachedFromNode: false,
    disableAutoUiCommit: false,
  }}
>
  Click
</Button>
```

## Window/Document Events

Valid `window` / `document` handler names come from `EventHandlerName`
(`resize`, `scroll`, `beforeUnload`, `visibilityChange`, plus the standard
mouse/keyboard names). Read window geometry with `s.window` helpers
(`getInnerWidth`, `getScrollY`, …), not event properties.

### Window Events

```tsx
<EventHandlers
  window={{
    resize: (s) => {
      s.window.getInnerWidth("window_width");
    },
    scroll: (s) => {
      s.window.getScrollY("scroll_y");
    },
    beforeUnload: (s) => {
      // Warn before leaving page
      s.if(sql`has_unsaved_changes`, (s) => {
        s.event.preventDefault();
      });
    },
  }}
/>
```

### Document Events

```tsx
<EventHandlers
  document={{
    visibilityChange: (s) => {
      // Tab visibility changed
    },
  }}
/>
```

## Mount Handler

Execute code when a component mounts:

```tsx
<EventHandlers
  mount={(s) => {
    // Initialize data
    s.setScalar("initialized", sql.true);

    // Focus an element
    s.element(sql.lit`my-input-id`).focus();

    // Start a background task
    s.startTask((s) => {
      s.sleep(1000);
      s.setScalar("timer_complete", sql.true);
    });
  }}
/>

{/* Or on any element */}
<div
  onMount={(s) => {
    s.debugExpr(sql.lit`Div mounted`);
  }}
>
  Content
</div>
```

## Complete Example

```tsx
function SearchWithKeyboardShortcuts() {
  return (
    <Data procedure={(s) => {
      s.defScalar("search_open", sql.false);
      s.defScalar("search_query", sql.lit``);
    }}>
      <EventHandlers
        document={{
          keydown: (s) => {
            // Open search with Cmd/Ctrl+K
            s.if(sql`event.key = 'k' and (event.ctrl_key or event.meta_key)`, (s) => {
              s.event.preventDefault();
              s.setScalar("search_open", sql.true);
              s.element(sql.lit`search-input`).focus();
            });

            // Close search with Escape
            s.if(sql`event.key = 'Escape' and search_open`, (s) => {
              s.setScalar("search_open", sql.false);
              s.setScalar("search_query", sql.lit``);
            });
          },
        }}
      />

      <Show when={sql`search_open`}>
        <div className="search-overlay">
          <Input
            id="search-input"
            value={sql`search_query`}
            onInput={(s) => {
              s.setScalar("search_query", sql`target_value`);
            }}
            onKeyDown={(s) => {
              s.if(sql`event.key = 'Enter'`, (s) => {
                s.navigate(sql`'/search?q=' || search_query`);
                s.setScalar("search_open", sql.false);
              });
            }}
            placeholder="Search..."
          />
        </div>
      </Show>
    </Data>
  );
}
```
