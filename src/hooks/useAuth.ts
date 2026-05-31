import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastLoggedSession = useRef<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Log sign-in, deduplicate by access_token
      if (event === "SIGNED_IN" && session?.user && session.access_token !== lastLoggedSession.current) {
        lastLoggedSession.current = session.access_token;
        supabase.from("login_logs").insert({
          user_id: session.user.id,
          email: session.user.email || "",
          user_agent: navigator.userAgent,
        }).then(({ error }) => {
          if (error) console.error("Login log error:", error);
        });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    // First attempt sign in
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error && data.user) {
      // Check user's profile status
      const { data: profile } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", data.user.id)
        .single();

      const status = profile?.status ?? 'pending';

      if (status === 'pending') {
        // Sign out immediately since they're not approved
        await supabase.auth.signOut();
        return { error: new Error("تم استلام طلبك، جاري المراجعة من قبل الإدارة") };
      }

      if (status === 'rejected') {
        await supabase.auth.signOut();
        return { error: new Error("تم رفض طلب الانضمام") };
      }

      // status === 'active' — allow login
      return { error: null };
    }

    return { error };
  };

  const signOut = async () => {
    lastLoggedSession.current = null;
    await supabase.auth.signOut();
  };

  return { user, session, loading, signUp, signIn, signOut };
}
