import { createClient } from '@/lib/supabase/server';

export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  const admin = process.env.ADMIN_EMAIL?.toLowerCase();
  if (!user || !email || !admin || email !== admin) return null;
  return user;
}
