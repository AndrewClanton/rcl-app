"use client";

import { createContext, useContext } from "react";
import * as actions from "../ops-actions";
import * as ranOut from "../ran-out-actions";

// The shift screens call the server through this, so a preview can run them
// against sample data. The register uses the real server actions.
export type OpsApi = Pick<
  typeof actions,
  | "getShiftStatus"
  | "startShift"
  | "endShift"
  | "setTaskDone"
  | "setTodoDone"
  | "undoTodoDone"
  | "getTaskRows"
  | "saveTask"
  | "setTaskActive"
  | "dismissReminder"
  | "saveReminder"
  | "setReminderActive"
  | "getParSheet"
  | "submitParCount"
  | "getShoppingList"
  | "saveParItem"
  | "setParItemActive"
  | "getOpsHistory"
  | "markBoothCardPrinted"
> &
  Pick<typeof ranOut, "getRanOutOptions" | "reportOutage" | "getOpenOutages" | "resolveOutage" | "markItemBack">;

export const OpsApiContext = createContext<OpsApi>({ ...actions, ...ranOut });
export const useOpsApi = () => useContext(OpsApiContext);
