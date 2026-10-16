import { describe, expect, it } from "vitest";
import { isEditingShortcutTarget, resolveEditingCommand } from "./editing-shortcuts";

describe("resolveEditingCommand", () => {
  it("maps the primary-modifier editing combos on mac", () => {
    expect(resolveEditingCommand({ key: "a", metaKey: true }, true)).toBe("selectAll");
    expect(resolveEditingCommand({ key: "c", metaKey: true }, true)).toBe("copy");
    expect(resolveEditingCommand({ key: "v", metaKey: true }, true)).toBe("paste");
    expect(resolveEditingCommand({ key: "x", metaKey: true }, true)).toBe("cut");
    expect(resolveEditingCommand({ key: "z", metaKey: true }, true)).toBe("undo");
    expect(resolveEditingCommand({ key: "z", metaKey: true, shiftKey: true }, true)).toBe("redo");
  });

  it("maps the primary-modifier editing combos on non-mac", () => {
    expect(resolveEditingCommand({ key: "a", ctrlKey: true }, false)).toBe("selectAll");
    expect(resolveEditingCommand({ key: "c", ctrlKey: true }, false)).toBe("copy");
    expect(resolveEditingCommand({ key: "v", ctrlKey: true }, false)).toBe("paste");
    expect(resolveEditingCommand({ key: "x", ctrlKey: true }, false)).toBe("cut");
    expect(resolveEditingCommand({ key: "z", ctrlKey: true }, false)).toBe("undo");
    expect(resolveEditingCommand({ key: "y", ctrlKey: true }, false)).toBe("redo");
    expect(resolveEditingCommand({ key: "z", ctrlKey: true, shiftKey: true }, false)).toBe("redo");
  });

  it("matches uppercase key values from shifted events", () => {
    expect(resolveEditingCommand({ key: "Z", metaKey: true, shiftKey: true }, true)).toBe("redo");
  });

  it("requires the platform's primary modifier", () => {
    expect(resolveEditingCommand({ key: "c", ctrlKey: true }, true)).toBeNull();
    expect(resolveEditingCommand({ key: "c", metaKey: true }, false)).toBeNull();
    expect(resolveEditingCommand({ key: "c" }, true)).toBeNull();
    expect(resolveEditingCommand({ key: "c", metaKey: true, ctrlKey: true }, true)).toBeNull();
  });

  it("leaves cmd+y unmapped on mac", () => {
    expect(resolveEditingCommand({ key: "y", metaKey: true }, true)).toBeNull();
  });

  it("ignores combos with alt, shift on non-redo keys, or unrelated keys", () => {
    expect(resolveEditingCommand({ key: "v", metaKey: true, altKey: true }, true)).toBeNull();
    expect(resolveEditingCommand({ key: "a", metaKey: true, shiftKey: true }, true)).toBeNull();
    expect(resolveEditingCommand({ key: "k", metaKey: true }, true)).toBeNull();
    expect(resolveEditingCommand({ key: "Enter", metaKey: true }, true)).toBeNull();
  });

  it("ignores composing and already-handled events", () => {
    expect(resolveEditingCommand({ key: "a", metaKey: true, isComposing: true }, true)).toBeNull();
    expect(
      resolveEditingCommand({ key: "a", metaKey: true, defaultPrevented: true }, true),
    ).toBeNull();
  });
});

describe("isEditingShortcutTarget", () => {
  it("accepts textareas, text-like inputs, and contenteditable elements", () => {
    expect(isEditingShortcutTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditingShortcutTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditingShortcutTarget({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isEditingShortcutTarget({ tagName: "INPUT", type: "password" })).toBe(true);
    expect(isEditingShortcutTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("rejects non-text inputs and non-editable elements", () => {
    expect(isEditingShortcutTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditingShortcutTarget({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isEditingShortcutTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditingShortcutTarget({ tagName: "BODY" })).toBe(false);
    expect(isEditingShortcutTarget(null)).toBe(false);
    expect(isEditingShortcutTarget(undefined)).toBe(false);
    expect(isEditingShortcutTarget("not-an-element")).toBe(false);
  });

  it("rejects the terminal's hidden xterm textarea", () => {
    const xtermContainer = {};
    expect(
      isEditingShortcutTarget({
        tagName: "TEXTAREA",
        closest: (selector: string) => (selector === ".xterm" ? xtermContainer : null),
      }),
    ).toBe(false);
  });
});
