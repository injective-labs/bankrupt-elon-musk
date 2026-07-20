// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationToastView } from "./OperationToast";

describe("OperationToastView", () => {
  it("shows trade receipt details and dismisses", () => {
    const dismiss = vi.fn();
    render(<OperationToastView locale="zh" assetName="狗狗币" feedback={{ id: 1, status: "success", kind: "trade", assetId: "doge", side: "BUY", quantity: "100", usdAmount: "7.22" }} onDismiss={dismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("买入成功");
    expect(screen.getByRole("status")).toHaveTextContent("狗狗币 ×100");
    expect(screen.getByRole("status")).toHaveTextContent("$7.22");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("uses an alert role and localized safe error text", () => {
    render(<OperationToastView locale="en" feedback={{ id: 2, status: "error", kind: "trade", assetId: "doge", side: "BUY", code: "INSUFFICIENT_CASH" }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Insufficient cash");
  });
});
