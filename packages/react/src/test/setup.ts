import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("@light-dapp-kit/core", () => import("./fakeCore.js"));
vi.mock("@ckb-ccc/connector-react", () => import("./fakeConnector.js"));

afterEach(() => {
  cleanup();
});
