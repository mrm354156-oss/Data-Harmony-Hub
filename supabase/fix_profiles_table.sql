-- =============================================================
-- إصلاح جدول profiles في Supabase
-- المشكلة: قيد UNIQUE على حقل status يمنع إدخال مستخدمين جدد
-- =============================================================

-- 1. إزالة القيد UNIQUE من حقل status (إذا كان موجوداً)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_key;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey CASCADE;

-- 2. التأكد أن id هو المفتاح الأساسي (مرتبط بـ auth.users)
ALTER TABLE public.profiles ADD PRIMARY KEY (id);

-- 3. توسيع حقل status (إذا كان varchar(10) يحد من القيم)
ALTER TABLE public.profiles ALTER COLUMN status TYPE VARCHAR(20) USING status::VARCHAR(20);
ALTER TABLE public.profiles ALTER COLUMN status SET DEFAULT 'pending';

-- 4. تفعيل Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 5. إنشاء policies للسماح بالإدراج والقراءة
--   - السماح لكل المستخدمين بقراءة profiles (للتسجيل)
--   - السماح للمستخدمين بإدراج صف خاص بهم فقط (id = auth.uid())
--   - السماح للمشرف بتحديث الحالة

-- سياسة القراءة: أي شخص مسجل يستطيع قراءة profiles
DROP POLICY IF EXISTS "Anyone can read profiles" ON public.profiles;
CREATE POLICY "Anyone can read profiles"
    ON public.profiles FOR SELECT
    USING (true);

-- سياسة الإدراج: المستخدم يستطيع إدراج صف خاص به فقط
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- سياسة التحديث: المستخدم يستطيع تحديث صف خاص به
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- سياسة الحذف: المستخدم يستطيع حذف صف خاص به
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
    ON public.profiles FOR DELETE
    USING (auth.uid() = id);

-- 6. إنشاء دالة تلقائية لإنشاء profile عند تسجيل مستخدم جديد
--    هذه الدالة تُنشَّأ تلقائياً عند تسجيل مستخدم عبر auth.signUp()
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, status, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.email),
        'pending',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- 7. تفعيل trigger لكي ينشأ profile تلقائياً عند كل تسجيل
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 8. تصحيح أي profiles موجودة بدون status
UPDATE public.profiles SET status = 'pending' WHERE status IS NULL;
UPDATE public.profiles SET updated_at = NOW() WHERE updated_at IS NULL;

-- =============================================================
-- إصلاح جدول daily_stats
-- المشكلة: قيد UNIQUE على (user_id, day) يمنع إدراج إحصائيات متعددة
-- =============================================================

-- 1. إزالة القيد UNIQUE (إذا كان موجوداً)
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS daily_stats_user_id_day_key;
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS daily_stats_pkey CASCADE;

-- 2. التأكد من id كمفتاح أساسي
ALTER TABLE public.daily_stats ADD PRIMARY KEY (id);

-- 3. تفعيل RLS
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;

-- 4. سياسات RLS لجدول daily_stats
DROP POLICY IF EXISTS "Anyone can read daily_stats" ON public.daily_stats;
CREATE POLICY "Anyone can read daily_stats"
    ON public.daily_stats FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can insert daily_stats" ON public.daily_stats;
CREATE POLICY "Users can insert daily_stats"
    ON public.daily_stats FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update daily_stats" ON public.daily_stats;
CREATE POLICY "Users can update daily_stats"
    ON public.daily_stats FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete daily_stats" ON public.daily_stats;
CREATE POLICY "Users can delete daily_stats"
    ON public.daily_stats FOR DELETE
    USING (auth.uid() = user_id);

-- =============================================================
-- تم الإصلاح الكامل ✅
-- =============================================================
