---
title: Recording Polished Demo Videos
description: How Forge agents rehearse, record, and verify polished Playwright demonstrations.
tags:
  - ai
  - testing
  - playwright
  - demos
related:
  - testing/overview.md
  - ui/pdf_markup.md
  - api/files_blobs_exports.md
---

# Recording Polished Demo Videos

Read `docs/ai/forge_preview.md` first. Use `previewScript` to prove the exact
workflow, restore its opening state, and publish one `recordDemo` result.

The deliverable is one focused video artifact. The recorder also captures one
automatic `demo-final` screenshot for outcome verification. Exploration,
locator discovery, user selection, and fixture preparation belong in the
preview rehearsal. Treat the screenshot as internal verification evidence and
return the video artifact as the user-facing deliverable.

## Define the requested evidence

Translate the request into an opening state, a short action sequence, and one
visible final state:

- **Bug reproduction:** establish the expected starting conditions, perform
  the trigger, and keep the visible bug state on screen as the final evidence.
- **Proof of a fix:** repeat the original trigger and keep the corrected result
  on screen as the final evidence.
- **How-to demonstration:** begin on the ready-to-use screen, teach the shortest
  successful path, and finish on the completed result.

Use chapter titles that describe user goals and outcomes. A strong video lets a
viewer understand the workflow from the application state, pointer movement,
and chapter labels.

## Workflow

1. Start the preview and select the canonical domain.
2. Use the same verified `authUserId` planned for the business workflow. Use
   the visible selector when authentication or the selector is requested
   evidence.
3. Warm the required routes and rehearse the complete workflow with
   `previewScript` using the same version and domain planned for recording.
   Establish exact locators and visible completion evidence.
4. Verify the rehearsal result through browser state, `serverActivity`, and
   `queryPreview` when the flow writes data.
5. Restore the intended opening state and add compact prerequisite data when it
   makes the requested interaction reproducible.
6. Record the proven workflow in one `recordDemo` call.
7. Inspect the automatic `demo-final` screenshot and report the video artifact
   after every completion check passes.

Setup before the first `demo.chapter()` stays off camera. Use that time for
authentication, route compilation, fixture loading, and navigation to the
stable opening view. Chapters describe outcomes rather than individual clicks.
Confirm the authenticated destination URL and a destination-specific visible
control before starting the first chapter.

For proof of a fix, rehearse the reported trigger on the parent version, then
rehearse the corrected result on the changed version. Warm and record the
changed version's exact route. The parent-version run supplies before evidence;
the single published video demonstrates the fixed result.

## Template

The recorded function is serialized. Pass external values through
`options.args`.

```js
const demoResult = await recordDemo(
  {
    domain: "office.example.com",
    title: "Approve an order",
    authUserId,
    args: { orderId },
    timeoutMs: 300_000,
  },
  async ({ page, args, demo, yolm }) => {
    await yolm.goto(`/orders/${args.orderId}`);
    await yolm.waitForRuntime();
    const heading = page.getByRole("heading", { name: "Order review" });
    await heading.waitFor({ state: "visible" });

    await demo.chapter(
      "Review the order",
      "Confirm the customer and line-item totals.",
    );
    await demo.hold(450);

    const approve = page.getByRole("button", { name: "Approve" });
    await demo.focus(approve);
    await approve.click();
    const approved = page.getByText("Approved");
    await approved.waitFor({ state: "visible" });

    await demo.chapter(
      "Confirm approval",
      "The completed status is visible in the order header.",
    );
    await demo.hold(650);

    return { status: await approved.textContent() };
  },
);

if (demoResult.success && demoResult.recording?.artifactId) {
  text({ videoArtifactId: demoResult.recording.artifactId });
} else {
  throw new Error(
    typeof demoResult.error === "string"
      ? demoResult.error
      : demoResult.recordingError?.message ?? "Demo publishing failed",
  );
}
```

`demo.chapter(title, description?, durationMs?)` marks the beginning of a
section. `demo.hold(ms)` keeps an important state visible; 350–800 ms is usually
enough. `demo.focus(locator, durationMs?)` adds extra emphasis when a target
needs it. Call `demo.focus` immediately before each meaningful click, field,
menu, or drag target. It moves the visible pointer to the control and gives the
viewer time to follow the interaction. The recorder also marks Playwright
actions automatically.

## Synchronization and Interaction

- Use `yolm.goto()` for Yolm routes so cold compilation receives the remaining
  whole-script time budget. Keep first-time route compilation in setup before
  the first chapter.
- Call `yolm.waitForRuntime()` after each navigation, then wait for a heading or
  primary control unique to the destination.
- Use the visible application state as the readiness signal. Yolm live queries
  can keep connections open after the page is ready.
- After a mutation, wait for the saved, recalculated, or completed state.
- Use labels and roles for ordinary controls.
- Use `pressSequentially` when keystrokes drive application logic.
- Commit edited values through the interaction the app expects: blur, Enter, or
  Save.
- Resolve portal-rendered selects with `getByRole("option", { name })`.
- Use `dragTo` for semantic drag and drop. Rehearse custom pointer gestures with
  `previewScript` and verify their visible result.
- Upload files with in-memory payloads passed to `setInputFiles`.

Keep the completed state in view and close temporary menus or selection handles.

## Verification

Report success after all of these checks pass:

- `success === true`
- `verification.scriptCompleted`, `verification.recordingCreated`,
  `verification.finalScreenshotCaptured`, and
  `verification.serverActivitySucceeded` are all true
- `recording.artifactId` is present
- each relevant entry in `serverActivity.executions` reports success
- the automatic `demo-final` screenshot shows the requested outcome
- `queryPreview` confirms persisted changes when the workflow writes data

`timing.recordingDurationMs` measures the chapter-gated capture window;
`timing.setupExcludedMs` estimates how much script time remained off camera.
