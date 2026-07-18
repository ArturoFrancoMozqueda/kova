import { afterEach, describe, expect, it, vi } from "vitest";
import { trapTabKey } from "./focusTrap";

function makeEvent(shiftKey = false) {
  return { key: "Tab", shiftKey, preventDefault: vi.fn() };
}

function mountContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  container.tabIndex = -1;
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("trapTabKey", () => {
  it("ignores keys other than Tab", () => {
    const container = mountContainer("<button>uno</button>");
    const event = { key: "Enter", shiftKey: false, preventDefault: vi.fn() };

    trapTabKey(event, container);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("wraps Tab from the last focusable element to the first", () => {
    const container = mountContainer("<button>uno</button><button>dos</button>");
    const [first, last] = Array.from(container.querySelectorAll("button"));
    last.focus();
    const event = makeEvent();

    trapTabKey(event, container);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it("lets Tab move naturally between inner elements", () => {
    const container = mountContainer("<button>uno</button><button>dos</button>");
    const [first] = Array.from(container.querySelectorAll("button"));
    first.focus();
    const event = makeEvent();

    trapTabKey(event, container);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    const container = mountContainer("<button>uno</button><button>dos</button>");
    const [first, last] = Array.from(container.querySelectorAll("button"));
    first.focus();
    const event = makeEvent(true);

    trapTabKey(event, container);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it("wraps Shift+Tab from the container itself to the last element", () => {
    const container = mountContainer("<button>uno</button><button>dos</button>");
    container.focus();
    const [, last] = Array.from(container.querySelectorAll("button"));
    const event = makeEvent(true);

    trapTabKey(event, container);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it("skips disabled controls when picking trap edges", () => {
    const container = mountContainer(
      "<button disabled>apagado</button><button>uno</button><button disabled>apagado</button>",
    );
    const enabled = container.querySelectorAll("button")[1];
    enabled.focus();
    const event = makeEvent();

    trapTabKey(event, container);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(enabled);
  });

  it("keeps focus on the container when it has no focusable children", () => {
    const container = mountContainer("<p>solo texto</p>");
    container.focus();
    const event = makeEvent();

    trapTabKey(event, container);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(container);
  });

  it("pulls focus back inside when focus escaped the container", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const container = mountContainer("<button>uno</button><button>dos</button>");
    outside.focus();
    const [first] = Array.from(container.querySelectorAll("button"));
    const event = makeEvent();

    trapTabKey(event, container);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });
});
