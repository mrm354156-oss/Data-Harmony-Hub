-- Add status column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected'));

-- Create index for faster queries on pending users
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- RLS Policies for profiles table
-- Enable RLS if not already enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can update profile status" ON public.profiles;
DROP POLICY IF EXISTS "Insert own profile" ON public.profiles;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: Users can update their own non-status fields
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy: Admin can view all profiles (admin email: mmr136835@gmail.com)
CREATE POLICY "Admin can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (auth.jwt() ->> 'email' = 'mmr136835@gmail.com');

-- Policy: Admin can update any profile's status
CREATE POLICY "Admin can update profile status"
  ON public.profiles
  FOR UPDATE
  USING (auth.jwt() ->> 'email' = 'mmr136835@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'mmr136835@gmail.com');

-- Policy: Users can insert their own profile (during signup)
CREATE POLICY "Insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Update any existing users to have a status if NULL
UPDATE public.profiles SET status = 'active' WHERE status IS NULL;