import Wizard from "@/components/Wizard";

/**
 * No wrapper, no overlay.
 *
 * A fixed-position "Case study" link used to sit here at top:16 right:18 —
 * directly on top of the Sepolia badge — and pointed at /case-study, a route
 * that no longer exists. The page was deleted in an earlier commit and the
 * link outlived it.
 *
 * The shell owns the viewport, so anything that needs to be in the masthead
 * belongs in the masthead, not floating above it on a z-index.
 */
export default function Home() {
  return <Wizard />;
}
