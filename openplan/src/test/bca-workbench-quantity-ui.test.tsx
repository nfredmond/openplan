import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BcaQuantityBuilder } from "@/components/grants/bca-workbench/quantity-builder";
import { BcaResults } from "@/components/grants/bca-workbench/results";
import { exampleBcaDocument, newBcaDocument } from "@/lib/bca/workbench/document";
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


it("plots zero dollars as zero width and scales nonzero annual cash flows proportionally", () => {
  const doc = exampleBcaDocument("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  render(<BcaResults doc={doc}/>);
  const chart = screen.getByRole("img", {name:"Annual benefits and costs, with exact values in the following table"});
  const widths = (year:string) => Array.from(chart.children).find(row => row.firstElementChild?.textContent === year)!.querySelectorAll<HTMLElement>("div[style]");
  expect(widths("2027")[0].style.width).toBe("0%");
  expect(widths("2027")[1].style.width).toBe("0%");
  expect(widths("2026")[1].style.width).toBe("100%");
  expect(parseFloat(widths("2028")[0].style.width)).toBeCloseTo(327000 / 2000000 * 100);
  expect(parseFloat(widths("2028")[1].style.width)).toBeCloseTo(5000 / 2000000 * 100);
});
