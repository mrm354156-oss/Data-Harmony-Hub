import { useState } from "react";
import { X, Mail, Lock, LogIn, UserPlus, Info } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface AuthModalProps {
  onClose: () => void;
}

const AuthModal = ({ onClose }: AuthModalProps) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("برجاء ملء جميع الحقول");
      return;
    }
    if (password.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email.trim(), password);
        if (error) {
          toast.error(error.message === "Invalid login credentials"
            ? "بيانات الدخول غير صحيحة"
            : error.message);
        } else {
          toast.success("تم تسجيل الدخول بنجاح! 🎉");
          onClose();
        }
      } else {
        const { error } = await signUp(email.trim(), password);
        if (error) {
          toast.error(error.message);
        } else {
          toast.success("تم إنشاء الحساب بنجاح! 🎉");
          // After signup, show message about pending approval
          toast.info("حسابك يحتاج لموافقة الإدارة قبل استخدام النظام", { duration: 6000 });
          setIsLogin(true);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-6 animate-fade-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-cairo font-bold text-lg text-foreground">
            {isLogin ? "تسجيل الدخول" : "إنشاء حساب جديد"}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Mail className="absolute right-3 top-3 w-4 h-4 text-muted-foreground" />
            <input
              type="email"
              placeholder="البريد الإلكتروني"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full pr-10 pl-4 py-3 rounded-xl bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-cairo"
              dir="ltr"
              maxLength={255}
            />
          </div>
          <div className="relative">
            <Lock className="absolute right-3 top-3 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              placeholder="كلمة المرور"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full pr-10 pl-4 py-3 rounded-xl bg-secondary text-foreground text-sm border border-border focus:border-gold focus:outline-none font-cairo"
              dir="ltr"
              maxLength={128}
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl gradient-gold text-primary-foreground font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
          >
            {loading ? (
              <span className="animate-spin">⏳</span>
            ) : isLogin ? (
              <><LogIn className="w-4 h-4" /> دخول</>
            ) : (
              <><UserPlus className="w-4 h-4" /> إنشاء حساب</>
            )}
          </button>
        </form>

        {!isLogin && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400 font-cairo leading-relaxed">
              بعد إنشاء الحساب، سيتم مراجعة طلبك من قبل الإدارة. سيتم إشعارك عند الموافقة على حسابك.
            </p>
          </div>
        )}

        <button
          onClick={() => setIsLogin(!isLogin)}
          className="w-full text-center mt-4 text-sm text-muted-foreground hover:text-gold transition-colors font-cairo"
        >
          {isLogin ? "مش عندك حساب؟ سجل دلوقتي" : "عندك حساب؟ سجل دخول"}
        </button>
      </div>
    </div>
  );
};

export default AuthModal;
