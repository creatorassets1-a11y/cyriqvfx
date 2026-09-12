import { requireAdmin } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AdminClient from '@/components/admin-client';
export default async function Admin(){const user=await requireAdmin();if(!user)redirect('/admin/login');return <AdminClient/>}
