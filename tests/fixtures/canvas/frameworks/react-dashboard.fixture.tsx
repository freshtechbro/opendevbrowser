import { Button } from "@/components/ui/button";
import { AlarmClock } from "lucide-react";
import { motion } from "framer-motion";

export function DashboardHero() {
  return <main className="dashboard-shell">
    <section data-panel="hero">
      <Button>
        <AlarmClock />
        Launch
      </Button>
      <motion.div layout>
        <span>Ready</span>
      </motion.div>
    </section>
  </main>;
}
