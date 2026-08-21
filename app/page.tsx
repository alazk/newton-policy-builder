import Wizard from "@/components/Wizard";

/**
 * No wrapper. The shell owns the viewport — `min-h-screen bg-white` here
 * fought it: a white page behind a #F1F1F1 console shows as a seam at the
 * bottom edge, and the extra min-height defeats the fixed-height layout the
 * console depends on.
 */
export default function Home() {
  return <Wizard />;
}
