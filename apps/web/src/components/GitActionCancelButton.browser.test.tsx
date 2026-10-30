import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { GitActionCancelButton } from "./GitActionCancelButton";

// Fork: Cancel on a running PR action in the thread details panel.
it("calls onCancel when Cancel is clicked", async () => {
  const onCancel = vi.fn();
  await using screen = await render(
    <GitActionCancelButton cancelling={false} onCancel={onCancel} />,
  );

  const button = screen.getByRole("button", { name: "Cancel" });
  await expect.element(button).toBeEnabled();
  await button.click();
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("is disabled while the cancel is in flight", async () => {
  const onCancel = vi.fn();
  await using screen = await render(<GitActionCancelButton cancelling onCancel={onCancel} />);

  await expect.element(screen.getByRole("button", { name: "Cancelling" })).toBeDisabled();
  expect(onCancel).not.toHaveBeenCalled();
});
