import { useState } from "react";
import { readSidebarCollapsed, storeSidebarCollapsed } from "./sidebar-preference";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(storeSidebarCollapsed(next) ? next : false);
  };
  return { collapsed, toggle };
}
