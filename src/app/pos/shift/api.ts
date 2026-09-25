"use client";

import { createContext, useContext } from "react";
import * as actions from "../ops-actions";

// The shift screens call the server through this, so a preview can run them
// against sample data. The register uses the real server actions.
export type OpsApi = Pick<
  typeof actions,
  | "getShiftStatus"
  | "startShift"
  | "endShift"
  | "setTaskDone"
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
>;

export const OpsApiContext = createContext<OpsApi>(actions);
export const useOpsApi = () => useContext(OpsApiContext);
