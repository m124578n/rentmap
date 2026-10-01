import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

/** 「這是付費功能」的提示 + 看方案的連結(只是顯示;限制在伺服器) */
export function PlanLock({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-1 text-xs text-amber-800 dark:text-amber-300 ${className}`}>
      <Lock size={12} className="shrink-0" />
      <span>{children}</span>
      <Link to="/account" hash="plan" className="underline">
        看方案
      </Link>
    </p>
  );
}
