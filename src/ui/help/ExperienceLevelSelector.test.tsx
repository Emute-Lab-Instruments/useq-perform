import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";
import { ExperienceLevelSelector } from "./ExperienceLevelSelector";

describe("ExperienceLevelSelector", () => {
  it("renders with the given level selected", () => {
    render(() => (
      <ExperienceLevelSelector level="beginner" onLevelChange={() => {}} />
    ));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("beginner");
  });

  it("renders both experience options", () => {
    render(() => (
      <ExperienceLevelSelector level="beginner" onLevelChange={() => {}} />
    ));
    expect(screen.getByText("Beginner")).toBeTruthy();
    expect(screen.getByText("Advanced")).toBeTruthy();
  });

  it("renders the label", () => {
    render(() => (
      <ExperienceLevelSelector level="beginner" onLevelChange={() => {}} />
    ));
    expect(screen.getByText(/Experience level/)).toBeTruthy();
  });

  it("calls onLevelChange when selection changes", () => {
    const onChange = vi.fn();
    render(() => (
      <ExperienceLevelSelector level="beginner" onLevelChange={onChange} />
    ));
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "advanced" } });
    expect(onChange).toHaveBeenCalledWith("advanced");
  });

  it("can render with advanced pre-selected", () => {
    render(() => (
      <ExperienceLevelSelector level="advanced" onLevelChange={() => {}} />
    ));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("advanced");
  });
});
