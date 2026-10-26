"use client";

import { createContext, useContext } from "react";

/** Associates custom form controls with their visible ConfigField heading. */
export const FieldLabelContext = createContext<string | undefined>(undefined);
export function useFieldLabel() { return useContext(FieldLabelContext); }
