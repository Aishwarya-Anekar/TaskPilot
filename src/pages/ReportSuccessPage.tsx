import { CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PageTransition } from "@/components/motion/PageTransition";

export default function ReportSuccessPage() {
  return (
    <PageTransition>
      <div className="flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="bg-card rounded-xl card-elevated p-10 text-center max-w-md w-full"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.2 }}
            className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <CheckCircle size={40} className="text-success" />
          </motion.div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Workflow Orchestrated Successfully</h1>
          <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
            Your event or task has been registered and assigned in the organization. Collaborators can now start working.
          </p>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              to="/dashboard"
              className="inline-block px-6 py-2.5 rounded-lg btn-gradient text-primary-foreground text-sm font-semibold shadow-md hover:shadow-lg transition-shadow"
            >
              Back to Dashboard
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </PageTransition>
  );
}
