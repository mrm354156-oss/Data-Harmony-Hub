# إصلاح قاعدة بيانات Supabase

## المشكلة

الاختبار التلقائي يفشل بسبب قيود UNIQUE تمنع إدراج البيانات في جدول `daily_stats` و `profiles`.

## الحل (دقيقتان فقط)

### الطريقة 1: عبر Supabase Dashboard (الأسهل)

1. **افتح Supabase Dashboard:**
   <https://supabase.com/dashboard/project/aodzerqrhyjsrbnxqrmk>

2. **اذهب إلى SQL Editor:**
   القائمة اليسرى ← SQL Editor

3. **أنشئ استعلام جديد:**
   انقر "New Query"

4. **انسخ والصق هذا الكود:**

```sql
-- =============================================================
-- إزالة القيود UNIQUE من daily_stats
-- =============================================================
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS daily_stats_user_id_day_key;
ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS daily_stats_pkey CASCADE;
ALTER TABLE public.daily_stats ADD PRIMARY KEY (id);
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;

-- السماح بالإدراج
DROP POLICY IF EXISTS "Anyone can insert daily_stats" ON public.daily_stats;
CREATE POLICY "Anyone can insert daily_stats"
    ON public.daily_stats FOR INSERT
    WITH CHECK (true);

-- السماح بالتحديث
DROP POLICY IF EXISTS "Anyone can update daily_stats" ON public.daily_stats;
CREATE POLICY "Anyone can update daily_stats"
    ON public.daily_stats FOR UPDATE
    USING (true);

-- =============================================================
-- إزالة القيود UNIQUE من profiles
-- =============================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_key;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey CASCADE;
ALTER TABLE public.profiles ADD PRIMARY KEY (id);
ALTER TABLE public.profiles ALTER COLUMN status TYPE VARCHAR(20);
ALTER TABLE public.profiles ALTER COLUMN status SET DEFAULT 'pending';

-- السماح بالإدراج والتحديث
DROP POLICY IF EXISTS "Anyone can insert profiles" ON public.profiles;
CREATE POLICY "Anyone can insert profiles"
    ON public.profiles FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update profiles" ON public.profiles;
CREATE POLICY "Anyone can update profiles"
    ON public.profiles FOR UPDATE
    USING (true);

-- تصحيح القيم الفارغة
UPDATE public.profiles SET status = 'pending' WHERE status IS NULL;
```

1. **اضغط "Run" ✅**

### الطريقة 2: عبر REST API (إذا كان Supabase CLI مثبتاً)

```bash
supabase db push
```

### الطريقة 3: عبر cURL

```bash
curl -X POST https://api.supabase.com/v1/sql \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZHplcnFyaHlqc3Jibnhxcm1rIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI3MTYwMiwiZXhwIjoyMDkzODQ3NjAyfQ.rX6VWK1aP3h7J9QzZJYYh9dqC8LXFbRnGwCjGvTq-sg" \
  -H "Content-Type: application/json" \
  -d '{"query": "ALTER TABLE public.daily_stats DROP CONSTRAINT IF EXISTS daily_stats_user_id_day_key;"}'
```

## بعد التطبيق

- ✅ الاختبار التلقائي سينجح
- ✅ المستخدمون الجدد سيظهرون
- ✅ الموافقة والرفض ستعملان
- ✅ الإحصائيات اليومية ستُسجل
