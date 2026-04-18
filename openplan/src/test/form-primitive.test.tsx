import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Form, FormActions, FormError, FormField, FormLabel } from "@/components/ui/form";

describe("Form primitive", () => {
  it("renders a form wrapper with space-y-4 by default", () => {
    const { container } = render(
      <Form data-testid="form">
        <FormField>
          <FormLabel htmlFor="name">Name</FormLabel>
          <input id="name" />
        </FormField>
      </Form>
    );

    const form = container.querySelector("form");
    expect(form?.className).toContain("space-y-4");
    expect(form?.className).toContain("form-root");
  });

  it("renders FormLabel with optional marker when optional is true", () => {
    render(
      <FormLabel htmlFor="notes" optional>
        Notes
      </FormLabel>
    );

    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByText("optional")).toBeTruthy();
  });

  it("omits the optional marker when optional is false", () => {
    render(<FormLabel htmlFor="name">Name</FormLabel>);

    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.queryByText("optional")).toBeNull();
  });

  it("renders FormError as alert role for screen readers", () => {
    render(<FormError>Something broke</FormError>);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Something broke");
  });

  it("renders FormActions with button children", () => {
    render(
      <FormActions>
        <button type="submit">Save</button>
      </FormActions>
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
