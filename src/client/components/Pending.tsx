import { usePrivatePool } from "@/lib/useAuth";

/**
 * 「這項資料還沒匯入」的說明:私人模式(自己在家用)才顯示要跑的指令;公開版的使用者只看到「準備中」。
 */
export function Pending({ what, cmd, className = "text-xs text-neutral-500" }: { what: string; cmd: string; className?: string }) {
  const pool = usePrivatePool();
  return (
    <p className={className}>
      {pool ? (
        <>
          還沒匯入{what}(家裡跑 <code>{cmd}</code>)。
        </>
      ) : (
        `${what}還在準備中。`
      )}
    </p>
  );
}
