import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";
import { ReferenceFilters } from "./ReferenceFilters";

const defaultProps = () => ({
  versionOptions: [
    { raw: "1.0.0", major: 1, minor: 0, patch: 0 },
    { raw: "1.1.0", major: 1, minor: 1, patch: 0 },
    { raw: "1.2.0", major: 1, minor: 2, patch: 0 },
  ],
  currentTargetVersion: null as string | null,
  onVersionChange: vi.fn(),
  allTags: ["maths", "functional programming", "evaluation control"],
  selectedTags: new Set<string>(),
  onTagToggle: vi.fn(),
  onClearTags: vi.fn(),
});

describe("ReferenceFilters", () => {
  it("renders version dropdown with all options", () => {
    const props = defaultProps();
    render(() => <ReferenceFilters {...props} />);
    expect(screen.getByText("Show all firmware versions")).toBeTruthy();
    expect(screen.getByText(/v1\.0\.0/)).toBeTruthy();
    expect(screen.getByText(/v1\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/v1\.2\.0/)).toBeTruthy();
  });

  it("renders all tag buttons", () => {
    const props = defaultProps();
    render(() => <ReferenceFilters {...props} />);
    expect(screen.getByText("maths")).toBeTruthy();
    expect(screen.getByText("functional programming")).toBeTruthy();
    expect(screen.getByText("evaluation control")).toBeTruthy();
  });

  it("calls onVersionChange when version is selected", () => {
    const props = defaultProps();
    render(() => <ReferenceFilters {...props} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "1.1.0" } });
    expect(props.onVersionChange).toHaveBeenCalledWith("1.1.0");
  });

  it("calls onVersionChange with null when clearing version", () => {
    const props = defaultProps();
    props.currentTargetVersion = "1.1.0";
    render(() => <ReferenceFilters {...props} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "" } });
    expect(props.onVersionChange).toHaveBeenCalledWith(null);
  });

  it("calls onTagToggle when a tag is clicked", () => {
    const props = defaultProps();
    render(() => <ReferenceFilters {...props} />);
    fireEvent.click(screen.getByText("maths"));
    expect(props.onTagToggle).toHaveBeenCalledWith("maths");
  });

  it("applies 'selected' class to selected tags", () => {
    const props = defaultProps();
    props.selectedTags = new Set(["maths"]);
    const { container } = render(() => <ReferenceFilters {...props} />);
    const tags = container.querySelectorAll(".doc-tag");
    const mathsTag = Array.from(tags).find(
      (t) => t.textContent === "maths"
    );
    expect(mathsTag?.classList.contains("selected")).toBe(true);
  });

  it("disables clear tags button when no tags selected", () => {
    const props = defaultProps();
    render(() => <ReferenceFilters {...props} />);
    const clearBtn = screen.getByText("Clear tags") as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);
  });

  it("enables clear tags button when tags are selected", () => {
    const props = defaultProps();
    props.selectedTags = new Set(["maths"]);
    render(() => <ReferenceFilters {...props} />);
    const clearBtn = screen.getByText("Clear tags") as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
  });

  it("calls onClearTags when clear button is clicked", () => {
    const props = defaultProps();
    props.selectedTags = new Set(["maths"]);
    render(() => <ReferenceFilters {...props} />);
    fireEvent.click(screen.getByText("Clear tags"));
    expect(props.onClearTags).toHaveBeenCalledOnce();
  });

  it("shows (connected) marker for connected version", () => {
    const props = defaultProps();
    props.connectedVersionString = "1.2.0";
    render(() => <ReferenceFilters {...props} />);
    expect(screen.getByText(/\(connected\)/)).toBeTruthy();
  });
});
