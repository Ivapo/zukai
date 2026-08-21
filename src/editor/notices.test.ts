import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissNotice,
  getNotice,
  showNotice,
  subscribeNotices,
} from "./notices";

beforeEach(() => {
  dismissNotice();
});

describe("the notice store", () => {
  it("starts empty, so the banner draws nothing", () => {
    expect(getNotice()).toBeNull();
  });

  it("holds what was shown", () => {
    showNotice({ title: "Couldn't open the file", detail: "Not yet." });
    expect(getNotice()).toEqual({
      title: "Couldn't open the file",
      detail: "Not yet.",
    });
  });

  it("returns the same reference until something changes it", () => {
    // `useSyncExternalStore` re-renders forever if `getSnapshot` mints a new
    // value each call, so this identity is the banner's whole contract.
    showNotice({ title: "a", detail: "b" });
    expect(getNotice()).toBe(getNotice());
  });

  it("replaces rather than queues — §2.7 asks for one line", () => {
    showNotice({ title: "first", detail: "1" });
    showNotice({ title: "second", detail: "2" });
    expect(getNotice()?.title).toBe("second");
  });

  it("dismisses", () => {
    showNotice({ title: "a", detail: "b" });
    dismissNotice();
    expect(getNotice()).toBeNull();
  });

  it("tells subscribers about a show and a dismiss", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeNotices(seen);

    showNotice({ title: "a", detail: "b" });
    expect(seen).toHaveBeenCalledTimes(1);

    dismissNotice();
    expect(seen).toHaveBeenCalledTimes(2);

    unsubscribe();
    showNotice({ title: "c", detail: "d" });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("does not wake subscribers dismissing an empty store", () => {
    // Or every render that dismisses defensively would churn the tree.
    const seen = vi.fn();
    const unsubscribe = subscribeNotices(seen);
    dismissNotice();
    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });
});
