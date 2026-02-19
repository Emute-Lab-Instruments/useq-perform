import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";
import {
  Section,
  FormRow,
  TextInput,
  NumberInput,
  Checkbox,
  Select,
  RangeInput,
} from "./FormControls";

describe("Section", () => {
  it("renders title and children", () => {
    render(() => (
      <Section title="Test Section">
        <div data-testid="child">content</div>
      </Section>
    ));
    expect(screen.getByText("Test Section")).toBeTruthy();
    expect(screen.getByTestId("child").textContent).toBe("content");
  });

  it("applies panel-section class", () => {
    const { container } = render(() => (
      <Section title="S">
        <span>x</span>
      </Section>
    ));
    expect(container.querySelector(".panel-section")).toBeTruthy();
  });
});

describe("FormRow", () => {
  it("renders label and children", () => {
    render(() => (
      <FormRow label="My Label">
        <input data-testid="input" />
      </FormRow>
    ));
    expect(screen.getByText("My Label")).toBeTruthy();
    expect(screen.getByTestId("input")).toBeTruthy();
  });
});

describe("TextInput", () => {
  it("renders with value", () => {
    render(() => <TextInput value="hello" onChange={() => {}} />);
    const input = screen.getByDisplayValue("hello") as HTMLInputElement;
    expect(input.type).toBe("text");
  });

  it("calls onChange on input", () => {
    const onChange = vi.fn();
    render(() => <TextInput value="" onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "new" } });
    expect(onChange).toHaveBeenCalledWith("new");
  });

  it("renders placeholder", () => {
    render(() => (
      <TextInput value="" placeholder="Type here" onChange={() => {}} />
    ));
    expect(screen.getByPlaceholderText("Type here")).toBeTruthy();
  });
});

describe("NumberInput", () => {
  it("renders with numeric value", () => {
    render(() => <NumberInput value={42} onChange={() => {}} />);
    const input = screen.getByDisplayValue("42") as HTMLInputElement;
    expect(input.type).toBe("number");
  });

  it("applies min/max/step attributes", () => {
    render(() => (
      <NumberInput value={5} min={0} max={10} step={1} onChange={() => {}} />
    ));
    const input = screen.getByDisplayValue("5") as HTMLInputElement;
    expect(input.min).toBe("0");
    expect(input.max).toBe("10");
    expect(input.step).toBe("1");
  });

  it("applies disabled attribute", () => {
    render(() => (
      <NumberInput value={0} disabled={true} onChange={() => {}} />
    ));
    const input = screen.getByDisplayValue("0") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

describe("Checkbox", () => {
  it("renders checked state", () => {
    render(() => <Checkbox checked={true} onChange={() => {}} />);
    const input = screen.getByRole("checkbox") as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it("renders unchecked state", () => {
    render(() => <Checkbox checked={false} onChange={() => {}} />);
    const input = screen.getByRole("checkbox") as HTMLInputElement;
    expect(input.checked).toBe(false);
  });

  it("calls onChange on input", () => {
    const onChange = vi.fn();
    render(() => <Checkbox checked={false} onChange={onChange} />);
    const input = screen.getByRole("checkbox");
    fireEvent.input(input, { target: { checked: true } });
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Select", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];

  it("renders all options", () => {
    render(() => <Select value="a" options={options} onChange={() => {}} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("selects the correct initial value", () => {
    render(() => <Select value="b" options={options} onChange={() => {}} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("b");
  });

  it("calls onChange when selection changes", () => {
    const onChange = vi.fn();
    render(() => <Select value="a" options={options} onChange={onChange} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "c" } });
    expect(onChange).toHaveBeenCalledWith("c");
  });
});

describe("RangeInput", () => {
  it("renders range input with value", () => {
    render(() => (
      <RangeInput value={50} min={0} max={100} step={1} onChange={() => {}} />
    ));
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.value).toBe("50");
    expect(input.min).toBe("0");
    expect(input.max).toBe("100");
  });

  it("displays value text", () => {
    render(() => (
      <RangeInput value={75} min={0} max={100} step={1} onChange={() => {}} />
    ));
    expect(screen.getByText("75")).toBeTruthy();
  });

  it("uses formatValue when provided", () => {
    render(() => (
      <RangeInput
        value={0.5}
        min={0}
        max={1}
        step={0.1}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onChange={() => {}}
      />
    ));
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("applies disabled state", () => {
    const { container } = render(() => (
      <RangeInput
        value={0}
        min={0}
        max={100}
        step={1}
        disabled={true}
        onChange={() => {}}
      />
    ));
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(
      container.querySelector(".panel-range-wrapper--disabled")
    ).toBeTruthy();
  });

  it("updates display on input and only commits on change", () => {
    const onChange = vi.fn();
    render(() => (
      <RangeInput value={10} min={0} max={100} step={1} onChange={onChange} />
    ));

    const input = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "42" } });
    expect(screen.getByText("42")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });
});
