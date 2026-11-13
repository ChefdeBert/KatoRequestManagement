import { redirect } from 'next/navigation';
import { getCurrentUser, isStaff } from '@/lib/auth';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/signin');
  redirect(isStaff(user.role) ? '/admin/dashboard' : '/request');
}
