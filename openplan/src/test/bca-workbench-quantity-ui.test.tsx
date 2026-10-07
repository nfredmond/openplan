import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BcaQuantityBuilder } from "@/components/grants/bca-workbench/quantity-builder";
import { newBcaDocument } from "@/lib/bca/workbench/document";
it("preserves a person injury count instead of converting its label to crashes", () => {
  const onChange = vi.fn();
  render(
    <BcaQuantityBuilder
      doc={newBcaDocument("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("Quantity calculation"), {
    target: { value: "safety" },
  });
  fireEvent.change(screen.getByLabelText("Safety count unit"), {
    target: { value: "serious-injury" },
  });
  for (const [label, value] of [
    ["Observed serious-injury count", "20"],
    ["Observation years", "5"],
    ["Crash modification factor (not percent)", "0.8"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByText("Calculate and add annual stream"));
  expect(onChange).toHaveBeenCalledOnce();
  const doc = onChange.mock.calls[0][0];
  expect(doc.flows[0]).toMatchObject({
    unit: "serious-injury",
    noBuild: 4,
    build: 3.2,
    unitValue: null,
  });
  expect(doc.evidence[0].method).toContain("Count unit: serious-injury");
});
