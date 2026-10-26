"use client";
import { useI18n } from "./useI18n";
import { ACCESSIBLE_UI_ZH } from "@/lib/i18n/accessibility-copy";

export function useA11yText() {
  const { locale } = useI18n();
  return (source: string): string => locale === "en" ? source : ACCESSIBLE_UI_ZH[source] ?? source;
}
