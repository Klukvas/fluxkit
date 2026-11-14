import type { ReactNode } from "react";
import type { HomeSection } from "../config/home";
import "./home-sections-motion.css";

/** Keep the unconfigured path node-for-node identical, including a section that renders null. */
export function homeSectionReveal(section: HomeSection, children: ReactNode): ReactNode {
  return section.reveal === undefined ? (
    children
  ) : (
    <div key={section.id} className="fk-home-reveal empty:hidden" data-home-reveal={section.reveal}>
      {children}
    </div>
  );
}
